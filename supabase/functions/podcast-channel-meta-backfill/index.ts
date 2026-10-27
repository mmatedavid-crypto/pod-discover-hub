// podcast-channel-meta-backfill — one-off / on-demand fill of podcast_channel_meta (feed header
// author / owner / copyright / link) for Hungarian podcasts that have no row yet. Free: reads only the
// feed head, no AI, no episode writes. Regular fetches keep the table fresh via fetch-one.
// Starts only with its per-job internal token, the service role, or a signed-in admin.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { parseChannelMeta } from "../_shared/podcast-channel-meta.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-token" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const TIME_BUDGET_MS = 100_000;
const JOB = "podcast-channel-meta-backfill";

function sameToken(a: string, b: string) {
  if (a.length < 32 || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function authorized(admin: any, req: Request) {
  const given = req.headers.get("x-internal-token") || "";
  if (given) {
    const { data } = await admin.from("internal_job_tokens").select("token").eq("job", JOB).maybeSingle();
    if (sameToken(String(data?.token || ""), given)) return true;
  }
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return false;
  if (jwt === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return true;
  const { data: u } = await admin.auth.getUser(jwt).catch(() => ({ data: null as any }));
  if (!u?.user?.id) return false;
  const { data: role } = await admin.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin").maybeSingle();
  return !!role;
}

async function readHead(url: string): Promise<string> {
  const r = await fetch(url, { headers: { "User-Agent": "Podiverzum/1.0 (+https://podiverzum.hu)" }, signal: AbortSignal.timeout(12_000), redirect: "follow" });
  if (!r.ok || !r.body) return "";
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let txt = "";
  while (txt.length < 80_000) {
    const { done, value } = await reader.read();
    if (done) break;
    txt += dec.decode(value, { stream: true });
    if (/<item\b|<entry\b/i.test(txt)) break;
  }
  try { await reader.cancel(); } catch { /* noop */ }
  return txt;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const started = Date.now();
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if (!(await authorized(admin, req))) return json({ error: "forbidden" }, 403);
  const body = await req.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(400, Number(body.limit) || 250));

  const have = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data } = await admin.from("podcast_channel_meta").select("podcast_id").range(from, from + 999);
    for (const r of data || []) have.add(String((r as any).podcast_id));
    if (!data || data.length < 1000) break;
  }
  const todo: { id: string; rss_url: string }[] = [];
  for (let from = 0; todo.length < limit; from += 1000) {
    const { data } = await admin.from("podcasts").select("id, rss_url")
      .eq("language_decision", "accept_hungarian").not("rss_url", "is", null).order("id").range(from, from + 999);
    for (const r of (data || []) as any[]) if (!have.has(r.id) && todo.length < limit) todo.push(r);
    if (!data || data.length < 1000) break;
  }

  let i = 0, stored = 0, empty = 0, failed = 0;
  const worker = async () => {
    while (i < todo.length && Date.now() - started < TIME_BUDGET_MS) {
      const p = todo[i++];
      try {
        const meta = parseChannelMeta(await readHead(p.rss_url));
        if (!(meta.author || meta.owner_name || meta.copyright || meta.channel_link || meta.owner_email_domain)) { empty++; continue; }
        const { error } = await admin.from("podcast_channel_meta").upsert({ podcast_id: p.id, ...meta, updated_at: new Date().toISOString() }, { onConflict: "podcast_id" });
        if (error) failed++; else stored++;
      } catch { failed++; }
    }
  };
  await Promise.all(Array.from({ length: 16 }, worker));
  return json({ ok: true, candidates: todo.length, stored, empty, failed, remaining_unvisited: Math.max(0, todo.length - i), runtime_ms: Date.now() - started });
});
