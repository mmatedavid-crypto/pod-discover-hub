// pipeline-watchdog-admin: admin actions — toggle dry_run, manual resume, list events.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: any, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function isAdmin(admin: any, authHeader: string | null) {
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const { data: u } = await admin.auth.getUser(token);
  if (!u?.user) return false;
  const { data: r } = await admin.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin").maybeSingle();
  return !!r ? u.user.id : false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "status";

  try {
    if (action === "status") {
      const { data: stateRow } = await admin.from("app_settings").select("value").eq("key", "watchdog_state").maybeSingle();
      const state = (stateRow?.value || {}) as any;
      const runners = Array.isArray(state.runners) ? state.runners : [];

      // Fetch all controls so admin UI can show current enabled state + auto_paused_reason
      const keys = runners.map((r: any) => r.controls_key);
      const { data: ctrls } = await admin.from("app_settings").select("key, value").in("key", keys);
      const ctrlMap = new Map<string, any>();
      for (const c of ctrls || []) ctrlMap.set(c.key, c.value);

      const runnerStatus = runners.map((r: any) => {
        const c = ctrlMap.get(r.controls_key) || {};
        return {
          name: r.name,
          controls_key: r.controls_key,
          enabled: c.enabled !== false,
          auto_paused: !!c.auto_paused_reason,
          auto_paused_reason: c.auto_paused_reason || null,
          auto_paused_at: c.auto_paused_at || null,
          daily_budget_usd: c.daily_budget_usd ?? null,
        };
      });

      const { data: recent } = await admin
        .from("watchdog_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);

      return json({
        ok: true,
        state: {
          enabled: state.enabled !== false,
          dry_run: state.dry_run !== false,
          last_check_at: state.last_check_at || null,
          last_events: state.last_events || 0,
          alert_dedup_minutes: state.alert_dedup_minutes ?? 30,
          budget_overshoot_ratio: state.budget_overshoot_ratio ?? 1.2,
        },
        runners: runnerStatus,
        recent_events: recent || [],
      });
    }

    const userId = await isAdmin(admin, req.headers.get("Authorization"));
    if (!userId) return json({ error: "forbidden" }, 403);
    const body = await req.json().catch(() => ({}));

    if (action === "set_state") {
      const { data: stateRow } = await admin.from("app_settings").select("value").eq("key", "watchdog_state").maybeSingle();
      const state = { ...(stateRow?.value || {}) };
      if (typeof body.dry_run === "boolean") state.dry_run = body.dry_run;
      if (typeof body.enabled === "boolean") state.enabled = body.enabled;
      if (typeof body.alert_dedup_minutes === "number") state.alert_dedup_minutes = body.alert_dedup_minutes;
      if (typeof body.budget_overshoot_ratio === "number") state.budget_overshoot_ratio = body.budget_overshoot_ratio;
      await admin.from("app_settings").upsert({ key: "watchdog_state", value: state, updated_at: new Date().toISOString() }, { onConflict: "key" });
      return json({ ok: true, state });
    }

    if (action === "resume") {
      const controlsKey = String(body.controls_key || "");
      if (!controlsKey) return json({ error: "controls_key required" }, 400);
      const { data: row } = await admin.from("app_settings").select("value").eq("key", controlsKey).maybeSingle();
      const c = { ...(row?.value || {}), enabled: true };
      delete c.auto_paused_reason;
      delete c.auto_paused_at;
      delete c.auto_paused_by;
      await admin.from("app_settings").upsert({ key: controlsKey, value: c, updated_at: new Date().toISOString() }, { onConflict: "key" });

      // Resolve open events for this runner
      const runnerName = String(body.runner || "");
      if (runnerName) {
        await admin.from("watchdog_events")
          .update({ resolved_at: new Date().toISOString(), resolved_by: userId, resolved_note: body.note || "manual resume" })
          .eq("runner", runnerName)
          .is("resolved_at", null);
      }
      return json({ ok: true, controls: c });
    }

    if (action === "resolve_event") {
      const id = String(body.id || "");
      if (!id) return json({ error: "id required" }, 400);
      await admin.from("watchdog_events")
        .update({ resolved_at: new Date().toISOString(), resolved_by: userId, resolved_note: body.note || null })
        .eq("id", id);
      return json({ ok: true });
    }

    if (action === "run_now") {
      const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/pipeline-watchdog`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: "{}",
      });
      return new Response(await r.text(), { status: r.status, headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (action === "test_telegram") {
      const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/pipeline-watchdog?test=1`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ test_telegram: true }),
      });
      // For simplicity send directly here
      const lovableKey = Deno.env.get("LOVABLE_API_KEY");
      const tgKey = Deno.env.get("TELEGRAM_API_KEY");
      const chatId = Deno.env.get("TELEGRAM_ALERT_CHAT_ID");
      if (!lovableKey || !tgKey || !chatId) return json({ ok: false, error: "missing_telegram_env" }, 500);
      const tg = await fetch(`https://connector-gateway.lovable.dev/telegram/sendMessage`, {
        method: "POST",
        headers: { Authorization: `Bearer ${lovableKey}`, "X-Connection-Api-Key": tgKey, "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: "✅ <b>Pipeline watchdog Telegram teszt</b>\nHa ezt megkaptad, az értesítések működnek.", parse_mode: "HTML" }),
      });
      const txt = await tg.text();
      return json({ ok: tg.ok, status: tg.status, body: txt.slice(0, 200) });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e: any) {
    return json({ error: e?.message || "error" }, 500);
  }
});
