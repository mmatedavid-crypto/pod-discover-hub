// pipeline-watchdog: autonóm felügyelő minden AI-runner cost / error / liveness state-ére.
// Cron: 5 percenként. Olvassa app_settings.watchdog_state-et, evaluálja a rule-okat,
// dry_run=false esetén autonóm pause (*_controls.enabled=false), és Telegram alert minden eventnél.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: any, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const GATEWAY = "https://connector-gateway.lovable.dev/telegram";

type Runner = {
  name: string;
  controls_key: string;
  progress_key: string | null;
  spend_key: string | null;
  cadence_minutes: number;
};

type EvalResult = {
  rule: string;
  severity: "info" | "warn" | "critical";
  reason: string;
  detail: Record<string, any>;
  pause: boolean;
};

function num(x: any): number {
  if (typeof x === "number") return x;
  if (typeof x === "string") { const n = Number(x); return Number.isFinite(n) ? n : 0; }
  return 0;
}

function spendForRunner(byKind: any, spendKey: string | null): number {
  if (!spendKey || !byKind) return 0;
  const v = byKind[spendKey];
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "object" && v.spend_usd != null) return Number(v.spend_usd) || 0;
  return 0;
}

function evaluateRunner(
  runner: Runner,
  controls: any,
  progress: any,
  spendUsd: number,
  budgetOvershootRatio: number,
  staleLockMinutes: number,
): EvalResult[] {
  const results: EvalResult[] = [];
  if (!controls) return results;
  // Skip if explicitly disabled by operator
  if (controls.enabled === false) return results;

  const budget = num(controls.daily_budget_usd);

  // RULE 1: budget overshoot (critical → pause)
  if (budget > 0 && spendUsd > budget * budgetOvershootRatio) {
    results.push({
      rule: "budget_overshoot",
      severity: "critical",
      reason: `Spend ${spendUsd.toFixed(2)} USD > ${(budget * budgetOvershootRatio).toFixed(2)} (budget ${budget} × ${budgetOvershootRatio})`,
      detail: { spend_usd: spendUsd, budget_usd: budget, overshoot_ratio: budgetOvershootRatio },
      pause: true,
    });
  } else if (budget > 0 && spendUsd > budget) {
    // RULE 1b: over budget but under overshoot threshold (warn only)
    results.push({
      rule: "budget_exceeded",
      severity: "warn",
      reason: `Spend ${spendUsd.toFixed(2)} USD > budget ${budget} USD (under overshoot threshold)`,
      detail: { spend_usd: spendUsd, budget_usd: budget },
      pause: false,
    });
  }

  // RULE 2: API key expired / persistent errors (critical → pause)
  if (progress?.error_samples?.length) {
    const samples = progress.error_samples as any[];
    const apiKeyExpired = samples.some((s) => typeof s?.error === "string" && /API key expired|INVALID_ARGUMENT.*API key/i.test(s.error));
    if (apiKeyExpired) {
      results.push({
        rule: "api_key_expired",
        severity: "critical",
        reason: "Repeated 'API key expired' errors in last run",
        detail: { sample: samples[0]?.error?.slice(0, 240) },
        pause: true,
      });
    }
  }

  // RULE 3: high error rate (last run, only if progress present)
  if (progress) {
    const errors = num(progress.errors_last_run);
    const processed =
      num(progress.embedded_last_run) +
      num(progress.episodes_last_run) +
      num(progress.processed) +
      num(progress.written) +
      num(progress.chunks_last_run);
    if (errors > 0 && processed > 0) {
      const rate = errors / (errors + processed);
      if (rate > 0.5) {
        results.push({
          rule: "high_error_rate",
          severity: "critical",
          reason: `Error rate ${(rate * 100).toFixed(1)}% (${errors} errors / ${processed} processed)`,
          detail: { errors, processed, rate },
          pause: true,
        });
      } else if (rate > 0.2) {
        results.push({
          rule: "elevated_error_rate",
          severity: "warn",
          reason: `Error rate ${(rate * 100).toFixed(1)}% (${errors} errors / ${processed} processed)`,
          detail: { errors, processed, rate },
          pause: false,
        });
      }
    }
  }

  // RULE 4: stale runner (warn only — runner hasn't reported in cadence × 6)
  if (progress?.last_run_at) {
    const last = new Date(progress.last_run_at).getTime();
    const ageMin = (Date.now() - last) / 60000;
    const staleThreshold = Math.max(staleLockMinutes, runner.cadence_minutes * 6);
    if (ageMin > staleThreshold) {
      results.push({
        rule: "stale_runner",
        severity: "warn",
        reason: `Last run ${ageMin.toFixed(0)} min ago (threshold ${staleThreshold} min)`,
        detail: { last_run_at: progress.last_run_at, age_minutes: Math.round(ageMin), threshold_minutes: staleThreshold },
        pause: false,
      });
    }
  }

  return results;
}

async function sendTelegram(text: string): Promise<{ ok: boolean; error?: string }> {
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const tgKey = Deno.env.get("TELEGRAM_API_KEY");
  const chatId = Deno.env.get("TELEGRAM_ALERT_CHAT_ID");
  if (!lovableKey || !tgKey || !chatId) {
    return { ok: false, error: "missing_telegram_env" };
  }
  try {
    const r = await fetch(`${GATEWAY}/sendMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": tgKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (!r.ok) {
      const body = await r.text();
      return { ok: false, error: `tg_${r.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "tg_fetch_failed" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    // Load state
    const { data: stateRow } = await admin.from("app_settings").select("value").eq("key", "watchdog_state").maybeSingle();
    const state = (stateRow?.value || {}) as any;
    if (state.enabled === false) {
      return json({ ok: true, skipped: true, reason: "watchdog_disabled" });
    }
    const dryRun = state.dry_run !== false; // default to dry_run
    const dedupMin = Number(state.alert_dedup_minutes ?? 30);
    const overshoot = Number(state.budget_overshoot_ratio ?? 1.2);
    const staleLock = Number(state.stale_lock_minutes ?? 60);
    const runners: Runner[] = Array.isArray(state.runners) ? state.runners : [];

    // Today's spend
    const today = new Date().toISOString().slice(0, 10);
    const { data: spendRow } = await admin.from("ai_spend_daily").select("by_kind").eq("day", today).maybeSingle();
    const byKind = spendRow?.by_kind || {};

    // Bulk fetch all controls+progress keys
    const keys = new Set<string>();
    for (const r of runners) {
      keys.add(r.controls_key);
      if (r.progress_key) keys.add(r.progress_key);
    }
    const { data: settings } = await admin.from("app_settings").select("key, value").in("key", Array.from(keys));
    const settingsMap = new Map<string, any>();
    for (const s of settings || []) settingsMap.set(s.key, s.value);

    // Open events dedup
    const sinceIso = new Date(Date.now() - dedupMin * 60000).toISOString();
    const { data: openEvents } = await admin
      .from("watchdog_events")
      .select("runner, rule, created_at")
      .is("resolved_at", null)
      .gte("created_at", sinceIso);
    const openSet = new Set((openEvents || []).map((e: any) => `${e.runner}|${e.rule}`));

    const newEvents: any[] = [];
    const pausedRunners: string[] = [];
    const alerts: string[] = [];

    for (const runner of runners) {
      const controls = settingsMap.get(runner.controls_key);
      const progress = runner.progress_key ? settingsMap.get(runner.progress_key) : null;
      const spend = spendForRunner(byKind, runner.spend_key);
      const results = evaluateRunner(runner, controls, progress, spend, overshoot, staleLock);

      for (const r of results) {
        const dedupKey = `${runner.name}|${r.rule}`;
        if (openSet.has(dedupKey)) continue; // suppress

        const shouldPause = r.pause && !dryRun;
        newEvents.push({
          runner: runner.name,
          rule: r.rule,
          severity: r.severity,
          reason: r.reason,
          detail: r.detail,
          auto_paused: shouldPause,
          dry_run: dryRun,
        });

        if (shouldPause) {
          const next = { ...(controls || {}), enabled: false, auto_paused_reason: r.reason, auto_paused_at: new Date().toISOString(), auto_paused_by: "pipeline-watchdog" };
          await admin.from("app_settings").upsert({ key: runner.controls_key, value: next, updated_at: new Date().toISOString() }, { onConflict: "key" });
          pausedRunners.push(runner.name);
        }

        const icon = r.severity === "critical" ? "🚨" : r.severity === "warn" ? "⚠️" : "ℹ️";
        const tag = dryRun ? "[DRY_RUN]" : shouldPause ? "[PAUSED]" : "[ALERT]";
        const msg =
          `${icon} <b>${tag} ${runner.name}</b>\n` +
          `<b>Rule:</b> ${r.rule}\n` +
          `${r.reason}\n` +
          (r.detail && Object.keys(r.detail).length ? `<pre>${JSON.stringify(r.detail, null, 2).slice(0, 800)}</pre>\n` : "") +
          `<a href="https://podiverzum.hu/admin/pipeline-watchdog">Open admin</a>`;
        alerts.push(msg);
      }
    }

    // Insert events
    if (newEvents.length) {
      await admin.from("watchdog_events").insert(newEvents);
    }

    // Send Telegram alerts (one per event, max 10 per run to avoid floods)
    const tgResults: any[] = [];
    for (const msg of alerts.slice(0, 10)) {
      tgResults.push(await sendTelegram(msg));
    }

    // Update last_check
    await admin.from("app_settings").upsert({
      key: "watchdog_state",
      value: { ...state, last_check_at: new Date().toISOString(), last_events: newEvents.length, last_paused: pausedRunners },
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });

    return json({
      ok: true,
      dry_run: dryRun,
      checked: runners.length,
      new_events: newEvents.length,
      paused: pausedRunners,
      tg_sent: tgResults.filter((r) => r.ok).length,
      tg_errors: tgResults.filter((r) => !r.ok).map((r) => r.error),
    });
  } catch (e: any) {
    console.error("pipeline-watchdog error", e);
    return json({ error: e?.message || "error" }, 500);
  }
});
