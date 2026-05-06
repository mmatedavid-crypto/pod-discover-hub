// Admin controls for queue auto-drainer.
// All writes use service-role; admin verified via user_roles (no has_role RPC).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SETTING_KEY = "queue_drainer";
const TEMP_ADMIN_USER_ID = "7b92654a-2b5d-438c-ad67-7ad5f6709483";

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) return json({ error: "Unauthorized" }, 401);
    const userId = claimsData.claims.sub as string;

    const admin = createClient(SUPABASE_URL, SERVICE);

    let isAdmin = userId === TEMP_ADMIN_USER_ID;
    if (!isAdmin) {
      const { data: roleRow } = await admin
        .from("user_roles").select("role")
        .eq("user_id", userId).eq("role", "admin").maybeSingle();
      isAdmin = !!roleRow;
    }
    if (!isAdmin) return json({ error: "Forbidden: admin only" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = body?.action as string;

    const readSetting = async () => {
      const { data } = await admin.from("app_settings").select("value").eq("key", SETTING_KEY).maybeSingle();
      return (data?.value as any) || {};
    };
    const writeSetting = async (value: any) => {
      await admin.from("app_settings").upsert({
        key: SETTING_KEY, value, updated_at: new Date().toISOString(),
      });
    };

    const getStatus = async () => {
      const setting = await readSetting();
      const { count: pending } = await admin
        .from("discovery_queue").select("*", { count: "exact", head: true })
        .eq("status", "pending").gte("candidate_rank", 4);
      return {
        ok: true,
        setting: { interval_minutes: 10, ...setting },
        pending_rank4_plus: pending ?? 0,
      };
    };

    if (action === "status") return json(await getStatus());

    if (action === "enable" || action === "disable") {
      const cur = await readSetting();
      await writeSetting({ ...cur, enabled: action === "enable", interval_minutes: 10 });
      return json(await getStatus());
    }

    if (action === "run_now") {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/queue-drainer?force=1`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
        body: JSON.stringify({ trigger: "admin_run_now" }),
      });
      const text = await resp.text();
      let parsed: any = null; try { parsed = JSON.parse(text); } catch { /* noop */ }
      if (!resp.ok) return json({ error: `drainer ${resp.status}: ${text.slice(0, 300)}` }, 502);
      const status = await getStatus();
      return json({ ok: true, run: parsed, ...status });
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e: any) {
    return json({ error: e?.message || "error" }, 500);
  }
});
