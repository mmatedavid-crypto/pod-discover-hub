// Caller check for background / admin-only edge functions.
//
// A request is trusted only when it carries one of:
//   1. `x-internal-token` equal to the function's own row in
//      `internal_job_tokens`, or to the shared `scheduler` row (sent by pg_cron
//      commands; the table is service-role only),
//   2. the service-role key as Bearer token (edge function → edge function),
//   3. a signed-in user's JWT whose user has the `admin` role in `user_roles`.
// The public anon key alone is never enough, because it ships with the website.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export const SCHEDULER_TOKEN_JOB = "scheduler";

function sameToken(a: string, b: string) {
  if (a.length < 32 || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

let cachedAdmin: ReturnType<typeof createClient> | null = null;
function adminClient() {
  if (!cachedAdmin) {
    cachedAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cachedAdmin;
}

export async function isTrustedCaller(req: Request, job: string): Promise<boolean> {
  const admin = adminClient();
  const given = req.headers.get("x-internal-token") || "";
  if (given) {
    const { data } = await admin
      .from("internal_job_tokens")
      .select("job,token")
      .in("job", [job, SCHEDULER_TOKEN_JOB]);
    for (const row of (data || []) as Array<{ token: string }>) {
      if (sameToken(String(row?.token || ""), given)) return true;
    }
  }
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return false;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (service && sameToken(service, jwt)) return true;
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (anon && jwt === anon) return false;
  try {
    const { data: u } = await admin.auth.getUser(jwt);
    const uid = u?.user?.id;
    if (!uid) return false;
    const { data: role } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", uid)
      .eq("role", "admin")
      .maybeSingle();
    return !!role;
  } catch {
    return false;
  }
}

/** Returns a 403 response for untrusted callers, or null when the caller may proceed. */
export async function denyUntrustedCaller(req: Request, job: string): Promise<Response | null> {
  if (req.method === "OPTIONS") return null;
  if (await isTrustedCaller(req, job)) return null;
  return new Response(JSON.stringify({ error: "forbidden" }), {
    status: 403,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
