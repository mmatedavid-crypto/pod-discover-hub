// Admin controls + scheduler for automatic deep hydration.
// Service-role writes; admin verified via user_roles. Cron-callable (anon apikey)
// will hit action="scheduled_run" which is allowed without admin.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SETTING_KEY = "deep_hydration";
const TEMP_ADMIN_USER_ID = "7b92654a-2b5d-438c-ad67-7ad5f6709483";

const DEFAULTS = {
  enabled: false,
  batch_size: 5,
  schedule_mode: "nightly",
};

function json(b: any, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE);

    const body = await req.json().catch(() => ({}));
    const action = body?.action as string;

    const readSetting = async () => {
      const { data } = await admin.from("app_settings").select("value").eq("key", SETTING_KEY).maybeSingle();
      return { ...DEFAULTS, ...((data?.value as any) || {}) };
    };
    const writeSetting = async (value: any) => {
      await admin.from("app_settings").upsert({ key: SETTING_KEY, value, updated_at: new Date().toISOString() });
    };

    const counts = async () => {
      const [ns, ip, cp, fl, el] = await Promise.all([
        admin.from("podcasts").select("id", { count: "exact", head: true }).eq("deep_hydration_status", "not_started").gte("podiverzum_rank", 4),
        admin.from("podcasts").select("id", { count: "exact", head: true }).eq("deep_hydration_status", "in_progress"),
        admin.from("podcasts").select("id", { count: "exact", head: true }).eq("deep_hydration_status", "completed"),
        admin.from("podcasts").select("id", { count: "exact", head: true }).eq("deep_hydration_status", "failed"),
        admin.from("podcasts").select("id", { count: "exact", head: true }).gte("podiverzum_rank", 4).in("rss_status", ["active", "not_checked"]).in("deep_hydration_status", ["not_started", "failed"]),
      ]);
      return {
        not_started: ns.count || 0, in_progress: ip.count || 0,
        completed: cp.count || 0, failed: fl.count || 0, eligible: el.count || 0,
      };
    };

    const getStatus = async () => {
      const setting = await readSetting();
      return { ok: true, setting, counts: await counts() };
    };

    // Scheduled-run endpoint: callable without admin (cron uses anon apikey)
    if (action === "scheduled_run") {
      const setting = await readSetting();
      if (!setting.enabled) return json({ ok: true, skipped: true, reason: "disabled" });
      const limit = Math.max(1, Math.min(20, Number(setting.batch_size) || 5));
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/deep-hydrate-runner`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
        body: JSON.stringify({ limit, trigger: "scheduled" }),
      });
      const text = await resp.text();
      let parsed: any = null; try { parsed = JSON.parse(text); } catch { /* noop */ }
      if (!resp.ok) return json({ error: `runner ${resp.status}: ${text.slice(0, 300)}` }, 502);
      return json({ ok: true, ran: parsed });
    }

    // All other actions require admin
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
    const userId = userData.user.id;
    let isAdmin = userId === TEMP_ADMIN_USER_ID;
    if (!isAdmin) {
      const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
      isAdmin = !!roleRow;
    }
    if (!isAdmin) return json({ error: "Forbidden: admin only" }, 403);

    if (action === "status") return json(await getStatus());

    if (action === "enable" || action === "disable") {
      const cur = await readSetting();
      await writeSetting({ ...cur, enabled: action === "enable" });
      return json(await getStatus());
    }

    if (action === "set_batch_size") {
      const cur = await readSetting();
      const n = Math.max(1, Math.min(20, Number(body.batch_size) || 5));
      await writeSetting({ ...cur, batch_size: n });
      return json(await getStatus());
    }

    if (action === "clear_lock") {
      const cur = await readSetting();
      await writeSetting({ ...cur, lock_started_at: null, lock_until: null });
      return json(await getStatus());
    }

    if (action === "run_now") {
      const cur = await readSetting();
      const limit = Math.max(1, Math.min(20, Number(body.limit) || cur.batch_size || 5));
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/deep-hydrate-runner`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
        body: JSON.stringify({ limit, trigger: "manual_admin", force: true }),
      });
      const text = await resp.text();
      let parsed: any = null; try { parsed = JSON.parse(text); } catch { /* noop */ }
      if (!resp.ok) return json({ error: `runner ${resp.status}: ${text.slice(0, 300)}` }, 502);
      return json({ ok: true, ran: parsed, ...(await getStatus()) });
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e: any) {
    return json({ error: e?.message || "error" }, 500);
  }
});
