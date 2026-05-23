// queue-health-controller: univerzális queue-alapú runner felügyelet.
//
// Szabályok (mindegyik runnerre):
//  1) pending == 0                                  → auto-pause (enabled=false, reason="queue_empty")
//  2) pending >= wake_threshold AND auto-paused     → auto-resume (enabled=true)  ha az utolsó pause oka queue_empty volt
//  3) pending_now == prev == prev_prev (stall_runs egymást követő futás), pending > 0,
//     ÉS a runner közben futott (we observed time passing) → auto-pause (reason="stall_detected") + Telegram
//
// Konfiguráció: app_settings.queue_health_state
//   { enabled, dry_run, runners: [ { name, controls_key, pending_kind, wake_threshold, stall_runs } ] }
//
// pending_kind dispatch: kód-szinten hard-coded SQL-fragment (nem fut user SQL).
//
// Telegram: minden pause/resume eventnél (alert_dedup_minutes szerint).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: any, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const GATEWAY = "https://connector-gateway.lovable.dev/telegram";

type RunnerCfg = {
  name: string;
  controls_key: string;
  pending_kind: string;
  wake_threshold?: number;
  stall_runs?: number;
};

// ---- Pending count dispatcher ----
// Új runner felvételéhez: ide adj hozzá egy ágat, és registry-be felvenni a queue_health_state-ben.
async function countPending(admin: any, kind: string): Promise<number | null> {
  try {
    switch (kind) {
      case "person_mentions_pending": {
        const { count } = await admin.from("episode_person_mentions").select("*", { count: "exact", head: true })
          .eq("ai_judge_status", "pending");
        return count ?? 0;
      }
      case "person_bio_pending": {
        const { count } = await admin.from("people").select("*", { count: "exact", head: true })
          .is("ai_bio", null).eq("is_public", true);
        return count ?? 0;
      }
      case "person_wiki_unchecked": {
        const { count } = await admin.from("people").select("*", { count: "exact", head: true })
          .eq("wikidata_status", "unchecked");
        return count ?? 0;
      }
      case "org_wiki_unchecked": {
        const { count } = await admin.from("organizations").select("*", { count: "exact", head: true })
          .eq("wikidata_status", "unchecked");
        return count ?? 0;
      }
      case "seo_enrich_pending": {
        const { count } = await admin.from("ai_jobs").select("*", { count: "exact", head: true })
          .eq("status", "pending").eq("kind", "seo_enrich");
        return count ?? 0;
      }
      case "episode_classifier_pending": {
        const { count } = await admin.from("episodes").select("*", { count: "exact", head: true })
          .is("ai_classified_at", null).eq("language", "hu");
        return count ?? 0;
      }
      case "entity_backfill_pending": {
        const { count } = await admin.from("episodes").select("*", { count: "exact", head: true })
          .lt("ai_entities_version", 3).eq("language", "hu");
        return count ?? 0;
      }
      case "topic_judge_pending": {
        const { count } = await admin.from("episode_topic_candidates").select("*", { count: "exact", head: true })
          .eq("ai_judge_status", "pending");
        return count ?? 0;
      }
      case "topic_candidates_pending": {
        const { count } = await admin.from("episodes").select("*", { count: "exact", head: true })
          .is("topic_candidates_at", null);
        return count ?? 0;
      }
      case "embed_episode_chunks_pending": {
        const { count } = await admin.from("episodes").select("*", { count: "exact", head: true })
          .eq("language", "hu").is("episode_chunks_embedded_at", null);
        return count ?? 0;
      }
      case "episode_clean_text_pending": {
        const { count } = await admin.from("episodes").select("*", { count: "exact", head: true })
          .eq("language", "hu").is("clean_text_at", null);
        return count ?? 0;
      }
      case "organizations_backfill_pending": {
        // Cursor-driven; nézzük a v3-as feldolgozandó epizódok számát
        const { count } = await admin.from("episodes").select("*", { count: "exact", head: true })
          .gte("ai_entities_version", 3).is("organizations_backfilled_at", null);
        return count ?? 0;
      }
      case "deep_hydrate_pending": {
        const { count } = await admin.from("podcasts").select("*", { count: "exact", head: true })
          .eq("language", "hu").is("deep_hydrated_at", null);
        return count ?? 0;
      }
      case "pi_dump_pending": {
        const { count } = await admin.from("pi_dump_episodes").select("*", { count: "exact", head: true })
          .eq("status", "pending");
        return count ?? 0;
      }
      default:
        return null;
    }
  } catch (e) {
    console.warn("countPending failed", kind, e);
    return null;
  }
}

async function sendTelegram(text: string): Promise<{ ok: boolean; error?: string }> {
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const tgKey = Deno.env.get("TELEGRAM_API_KEY");
  const chatId = Deno.env.get("TELEGRAM_ALERT_CHAT_ID");
  if (!lovableKey || !tgKey || !chatId) return { ok: false, error: "missing_telegram_env" };
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
    if (!r.ok) return { ok: false, error: `tg_${r.status}` };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "tg_failed" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const { data: stateRow } = await admin.from("app_settings").select("value").eq("key", "queue_health_state").maybeSingle();
    const state = (stateRow?.value || {}) as any;
    if (state.enabled === false) return json({ ok: true, skipped: true, reason: "disabled" });

    const dryRun = state.dry_run === true;
    const runners: RunnerCfg[] = Array.isArray(state.runners) ? state.runners : [];
    const history: Record<string, { p1?: number; p2?: number; updated_at?: string }> = state.history || {};

    const results: any[] = [];
    const alerts: string[] = [];

    for (const r of runners) {
      const wake = r.wake_threshold ?? 5;
      const stallRuns = r.stall_runs ?? 2;

      const pending = await countPending(admin, r.pending_kind);
      if (pending == null) {
        results.push({ runner: r.name, action: "skip", reason: "unknown_pending_kind:" + r.pending_kind });
        continue;
      }

      const { data: ctrlRow } = await admin.from("app_settings").select("value").eq("key", r.controls_key).maybeSingle();
      const ctrl = (ctrlRow?.value || {}) as any;
      const prev = history[r.name] || {};
      const p1 = prev.p1; // most recent prev
      const p2 = prev.p2; // older prev

      let action: "noop" | "pause_empty" | "resume" | "pause_stall" = "noop";
      let reason = "";

      const wasAutoPaused = ctrl.auto_paused_by === "queue-health-controller" || ctrl.auto_paused_by === "pipeline-watchdog";

      if (pending === 0 && ctrl.enabled !== false) {
        action = "pause_empty";
        reason = `pending=0 → idle pause`;
      } else if (pending >= wake && ctrl.enabled === false && ctrl.auto_paused_by === "queue-health-controller" && ctrl.auto_paused_reason === "queue_empty") {
        action = "resume";
        reason = `pending=${pending} ≥ wake_threshold=${wake} → resume`;
      } else if (
        ctrl.enabled !== false &&
        pending > 0 &&
        p1 != null && p2 != null &&
        pending === p1 && p1 === p2
      ) {
        // pending nem csökken stall_runs (=3 sample) egymás után → stall
        action = "pause_stall";
        reason = `stall: pending stuck at ${pending} for ${stallRuns + 1} runs`;
      }

      // Update controls
      if (action !== "noop" && !dryRun) {
        if (action === "pause_empty") {
          const next = { ...ctrl, enabled: false, auto_paused_by: "queue-health-controller", auto_paused_reason: "queue_empty", auto_paused_at: new Date().toISOString() };
          await admin.from("app_settings").upsert({ key: r.controls_key, value: next, updated_at: new Date().toISOString() }, { onConflict: "key" });
        } else if (action === "resume") {
          const next = { ...ctrl, enabled: true, auto_paused_by: null, auto_paused_reason: null, auto_paused_at: null, auto_resumed_at: new Date().toISOString(), auto_resumed_reason: "queue_refilled" };
          await admin.from("app_settings").upsert({ key: r.controls_key, value: next, updated_at: new Date().toISOString() }, { onConflict: "key" });
        } else if (action === "pause_stall") {
          const next = { ...ctrl, enabled: false, auto_paused_by: "queue-health-controller", auto_paused_reason: "stall_detected", auto_paused_at: new Date().toISOString(), auto_paused_detail: { pending, p1, p2 } };
          await admin.from("app_settings").upsert({ key: r.controls_key, value: next, updated_at: new Date().toISOString() }, { onConflict: "key" });
        }
      }

      // Log event for pause/resume (not for noop, not for pause_empty which is too noisy)
      if (action === "pause_stall" || action === "resume") {
        await admin.from("queue_health_events").insert({
          runner: r.name,
          action,
          reason,
          pending_now: pending,
          pending_prev: p1 ?? null,
          pending_prev_prev: p2 ?? null,
          detail: { dry_run: dryRun, wake_threshold: wake, stall_runs: stallRuns, controls_key: r.controls_key },
        });

        const icon = action === "pause_stall" ? "🛑" : "▶️";
        const tag = dryRun ? "[DRY]" : "[LIVE]";
        alerts.push(
          `${icon} <b>${tag} queue-health: ${r.name}</b>\n` +
          `<b>Action:</b> ${action}\n${reason}\n` +
          `<a href="https://podiverzum.hu/admin/queue-health">Open admin</a>`
        );
      }

      // Update rolling history (shift: p2 <- p1, p1 <- pending)
      history[r.name] = { p1: pending, p2: p1, updated_at: new Date().toISOString() };

      results.push({ runner: r.name, pending, p1, p2, wake, stallRuns, action, reason });
    }

    // Persist state + history
    await admin.from("app_settings").upsert({
      key: "queue_health_state",
      value: { ...state, history, last_check_at: new Date().toISOString(), last_results: results },
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });

    const tg: any[] = [];
    for (const a of alerts.slice(0, 10)) tg.push(await sendTelegram(a));

    return json({ ok: true, dry_run: dryRun, checked: runners.length, results, tg_sent: tg.filter((x) => x.ok).length });
  } catch (e: any) {
    console.error("queue-health-controller error", e);
    return json({ error: e?.message || "error" }, 500);
  }
});
