// Database Quality Fast Lane.
// Top-level orchestrator for same-day catalog quality repair. It runs
// no-AI, non-destructive repairs aggressively and lets AI workers run only
// behind their own budget/dedupe/quality gates.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Controls = {
  enabled?: boolean;
  no_ai_dry_run?: boolean;
  run_data_repair?: boolean;
  data_repair_limit?: number;
  run_entity_quality?: boolean;
  entity_quality_limit?: number;
  run_youtube_pairer?: boolean;
  run_article_pairer?: boolean;
  article_pairer_limit?: number;
  run_best_text_source?: boolean;
  best_text_source_limit?: number;
  run_clean_text?: boolean;
  run_entity_backfill?: boolean;
  entity_backfill_batch?: number;
  entity_backfill_concurrency?: number;
  run_person_entity_extractor?: boolean;
  person_entity_limit?: number;
  run_organizations_backfill?: boolean;
  organizations_backfill_batch?: number;
  run_topic_extractor?: boolean;
  topic_batch?: number;
  max_runtime_ms?: number;
  auto_stop_at_errors?: number;
  consecutive_errors?: number;
};

const DEFAULT_CONTROLS: Required<Controls> = {
  enabled: true,
  no_ai_dry_run: false,
  run_data_repair: true,
  data_repair_limit: 500,
  run_entity_quality: true,
  entity_quality_limit: 500,
  run_youtube_pairer: false,
  run_article_pairer: true,
  article_pairer_limit: 120,
  run_best_text_source: true,
  best_text_source_limit: 1000,
  run_clean_text: true,
  run_entity_backfill: true,
  entity_backfill_batch: 400,
  entity_backfill_concurrency: 24,
  run_person_entity_extractor: true,
  person_entity_limit: 10000,
  run_organizations_backfill: true,
  organizations_backfill_batch: 1000,
  run_topic_extractor: true,
  topic_batch: 40,
  max_runtime_ms: 145000,
  auto_stop_at_errors: 5,
  consecutive_errors: 0,
};

async function callFunction(name: string, body: Record<string, unknown>) {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/${name}`;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, apikey: key },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${name} ${res.status}: ${text.slice(0, 400)}`);
  return data;
}

function isTransientWorkerError(message: string): boolean {
  return (
    /\b(503|502|504|546)\b/.test(message) ||
    /SUPABASE_EDGE_RUNTIME_SERVICE_DEGRADED|WORKER_RESOURCE_LIMIT|temporarily unavailable|CPU Time exceeded|context canceled/i.test(message)
  );
}

async function loadControls(admin: ReturnType<typeof createClient>) {
  const { data } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "database_quality_fast_lane")
    .maybeSingle();
  return { ...DEFAULT_CONTROLS, ...((data?.value as Record<string, unknown>) || {}) } as Controls;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const guard = await checkBackgroundJobsAllowed(admin, "database-quality-fast-lane");
    if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });

    const body = await req.json().catch(() => ({}));
    const trigger = String(body.trigger || "cron");
    const controls = await loadControls(admin);
    if (controls.enabled === false) {
      return json({ ok: true, skipped: true, trigger, reason: "disabled" });
    }

    const noAiDryRun = controls.no_ai_dry_run !== false;
    const maxRuntimeMs = Math.max(30000, Math.min(170000, Number(controls.max_runtime_ms || DEFAULT_CONTROLS.max_runtime_ms)));
    const results: Record<string, unknown> = {};
    const errors: string[] = [];

    const runStep = async (key: string, fn: () => Promise<unknown>) => {
      if (Date.now() - startedAt > maxRuntimeMs - 12000) {
        results[key] = { ok: true, skipped: true, reason: "runtime_budget_exhausted" };
        return;
      }
      try {
        results[key] = await fn();
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        results[key] = { ok: false, error: message };
        errors.push(`${key}: ${message}`);
      }
    };

    if (controls.run_data_repair !== false) {
      await runStep("data_repair", () => callFunction("data-repair-apply-runner", {
        action: "neutralize_legacy_episode_rank",
        limit: Math.max(1, Math.min(500, Number(controls.data_repair_limit || DEFAULT_CONTROLS.data_repair_limit))),
        dry_run: noAiDryRun,
      }));
    }

    if (controls.run_entity_quality !== false) {
      await runStep("entity_quality", () => callFunction("entity-quality-autopilot", {
        trigger: "database_quality_fast_lane",
      }));
    }

    if (controls.run_youtube_pairer === true) {
      await runStep("youtube_pairer", () => callFunction("youtube-episode-pairer", {
        trigger: "database_quality_fast_lane",
      }));
    }

    if (controls.run_article_pairer === true) {
      await runStep("article_pairer", () => callFunction("episode-article-pairer", {
        trigger: "database_quality_fast_lane",
        limit: Math.max(10, Math.min(500, Number(controls.article_pairer_limit || DEFAULT_CONTROLS.article_pairer_limit))),
      }));
    }

    if (controls.run_best_text_source !== false) {
      await runStep("best_text_source", async () => {
        const requestedLimit = Math.max(100, Math.min(5000, Number(controls.best_text_source_limit || DEFAULT_CONTROLS.best_text_source_limit)));
        try {
          return await callFunction("episode-best-text-source-runner", {
            trigger: "database_quality_fast_lane",
            limit: requestedLimit,
          });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          if (!/WORKER_RESOURCE_LIMIT|CPU Time exceeded|546/i.test(message) || requestedLimit <= 1000) throw e;
          const retryLimit = Math.max(500, Math.min(1000, Math.floor(requestedLimit / 5)));
          const retry = await callFunction("episode-best-text-source-runner", {
            trigger: "database_quality_fast_lane_retry",
            limit: retryLimit,
          });
          return {
            ok: true,
            retried_after_worker_limit: true,
            original_limit: requestedLimit,
            retry_limit: retryLimit,
            first_error: message,
            retry,
          };
        }
      });
    }

    if (controls.run_clean_text !== false) {
      await runStep("clean_text", () => callFunction("clean-text-autopilot", {
        trigger: "database_quality_fast_lane",
      }));
    }

    if (controls.run_entity_backfill !== false) {
      await runStep("entity_backfill", () => callFunction("entity-backfill-runner", {
        trigger: "database_quality_fast_lane",
        batch: Math.max(1, Math.min(600, Number(controls.entity_backfill_batch || DEFAULT_CONTROLS.entity_backfill_batch))),
        concurrency: Math.max(1, Math.min(48, Number(controls.entity_backfill_concurrency || DEFAULT_CONTROLS.entity_backfill_concurrency))),
      }));
    }

    if (controls.run_person_entity_extractor !== false) {
      await runStep("person_entity_extractor", () => callFunction("person-entity-extractor", {
        trigger: "database_quality_fast_lane",
        limit: Math.max(100, Math.min(20000, Number(controls.person_entity_limit || DEFAULT_CONTROLS.person_entity_limit))),
      }));
    }

    if (controls.run_organizations_backfill !== false) {
      await runStep("organizations_backfill", () => callFunction("organizations-backfill-runner", {
        trigger: "database_quality_fast_lane",
        batch: Math.max(50, Math.min(2000, Number(controls.organizations_backfill_batch || DEFAULT_CONTROLS.organizations_backfill_batch))),
      }));
    }

    if (controls.run_topic_extractor !== false) {
      await runStep("topic_extractor", () => callFunction("episode-topic-extractor", {
        trigger: "database_quality_fast_lane",
        batch: Math.max(1, Math.min(40, Number(controls.topic_batch || DEFAULT_CONTROLS.topic_batch))),
      }));
    }

    const hardErrors = errors.filter((message) => !isTransientWorkerError(message));
    const nextControls = {
      ...controls,
      consecutive_errors: hardErrors.length ? Number(controls.consecutive_errors || 0) + 1 : 0,
      last_run_at: new Date().toISOString(),
      last_trigger: trigger,
      last_runtime_ms: Date.now() - startedAt,
      last_results: results,
      last_errors: errors,
      last_hard_errors: hardErrors,
    };
    if (Number(nextControls.consecutive_errors || 0) >= Number(controls.auto_stop_at_errors || DEFAULT_CONTROLS.auto_stop_at_errors)) {
      nextControls.enabled = false;
    }

    await admin.from("app_settings").upsert({
      key: "database_quality_fast_lane",
      value: nextControls,
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });

    return json({
      ok: errors.length === 0,
      trigger,
      no_ai_dry_run: noAiDryRun,
      results,
      errors,
      enabled: nextControls.enabled,
      consecutive_errors: nextControls.consecutive_errors,
      runtime_ms: nextControls.last_runtime_ms,
    }, errors.length ? 500 : 200);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "error" }, 500);
  }
});
