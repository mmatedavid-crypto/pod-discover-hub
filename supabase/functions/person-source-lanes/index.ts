// person-source-lanes — free, AI-free person evidence lanes (no paid API is ever called here).
//  role_label: explicit "Vendég:/Műsorvezető:" lines in the episode's own title/description/page
//              (rule in _shared/person-role-label.ts); every hit is re-verified and applied only through
//              apply_person_role_label_v1 (identity anchor, homonym/flag blockers, footer check, CAS,
//              audit in person_pair_lane_audit, undo via undo_person_role_label_v1).
//  page_fetch: the publisher's own episode page meta for pairs lacking an episode-level source,
//              cached in episode_public_page_evidence (internal only), daily cap.
// Starts only from the scheduler (per-job token), the service role, or a signed-in admin.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { denyUntrustedCaller } from "../_shared/internal-auth.ts";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { runLog } from "../_shared/runner-run-log.ts";
import { safePublicFetch } from "../_shared/safe-public-fetch.ts";
import { findRoleLabelHits, ROLE_LABEL_RULE_VERSION } from "../_shared/person-role-label.ts";
import { parseEpisodePageMeta } from "../_shared/episode-page-meta.ts";
import { checkProcessingPriority } from "../_shared/processing-priority.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-token" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const JOB = "person-source-lanes";
const CONTROLS_KEY = "person_source_lanes_controls";
const CURSOR_KEY = "person_role_label_cursor";
const TIME_BUDGET_MS = 100_000;
const UA = "PodiverzumBot/1.0 (+https://podiverzum.hu; episode page meta for person evidence)";
const MAX_HTML = 600_000;

async function contentHash(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_HTML) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value); total += value.length;
  }
  try { await reader.cancel(); } catch { /* closed */ }
  const buf = new Uint8Array(Math.min(total, MAX_HTML));
  let o = 0;
  for (const c of chunks) { const take = Math.min(c.length, buf.length - o); buf.set(c.subarray(0, take), o); o += take; if (o >= buf.length) break; }
  return new TextDecoder("utf-8", { fatal: false }).decode(buf);
}

async function roleLabelLane(admin: any, ctrl: any, body: any, started: number, dryRun: boolean) {
  const perRun = Math.max(1, Math.min(20000, Number(body.pairs ?? ctrl.role_label_per_run ?? 2000)));
  const { data: cur } = await admin.from("app_settings").select("value").eq("key", CURSOR_KEY).maybeSingle();
  let after = { p: cur?.value?.last_person ?? null, e: cur?.value?.last_episode ?? null };
  let passes = Number(cur?.value?.passes_completed ?? 0);
  const counts: Record<string, number> = {};
  const bump = (k: string) => { counts[k] = (counts[k] || 0) + 1; };
  const applied: any[] = [];
  let scannedTotal = 0;
  while (scannedTotal < perRun && Date.now() - started < TIME_BUDGET_MS) {
    const { data, error } = await admin.rpc("person_role_label_candidates_v1", { _after_person: after.p, _after_episode: after.e, _limit: 1000 });
    if (error) throw new Error(`candidates: ${error.message}`);
    const rows = (data?.rows || []) as any[];
    const scanned = Number(data?.scanned || 0);
    scannedTotal += scanned;
    const results: any[] = [];
    const items: any[] = [];
    for (const r of rows) {
      // Blocked pairs are not recorded: a cleared flag or resolved homonym must be re-checked next pass.
      if (r.block) { bump(`blocked_${r.block}`); continue; }
      if (!r.has_label) { results.push({ ...base(r), outcome: "no_label" }); bump("no_label"); continue; }
      const res = findRoleLabelHits({ episode_title: r.title, episode_description: r.description, episode_page: r.page_description }, r.name, r.aliases || []);
      if (res.outcome !== "hit") { results.push({ ...base(r), outcome: res.outcome }); bump(res.outcome); continue; }
      const h = res.hits[0];
      items.push({ person_id: r.person_id, episode_id: r.episode_id, role: h.role, field: h.field, quote: h.quote, snippet: h.snippet,
        matched_name: h.matched_name, descriptor: h.descriptor, source_hash: r.source_hash, _r: r });
    }
    if (dryRun) {
      for (const it of items) { bump("would_apply_check"); applied.push({ person_id: it.person_id, episode_id: it.episode_id, role: it.role, field: it.field, snippet: it.snippet, descriptor: it.descriptor }); }
    } else {
      for (let i = 0; i < items.length; i += 100) {
        const chunk = items.slice(i, i + 100);
        const { data: out, error: aErr } = await admin.rpc("apply_person_role_label_v1", { _items: chunk.map(({ _r, ...x }) => x) });
        if (aErr) throw new Error(`apply: ${aErr.message}`);
        for (const o of (out || []) as any[]) {
          const src = chunk.find((c) => c.person_id === o.person_id && c.episode_id === o.episode_id);
          bump(o.outcome);
          if (o.outcome === "applied") applied.push({ audit_id: o.audit_id, role: o.role, anchor: o.anchor, snippet: src?.snippet });
          if (src && !RECHECK_OUTCOMES.test(o.outcome)) results.push({ ...base(src._r), outcome: o.outcome, detail: { role: src.role, field: src.field, snippet: src.snippet, ...o } });
        }
      }
      for (let i = 0; i < results.length; i += 500) {
        const { error: rErr } = await admin.rpc("record_person_role_label_results_v1", { _rows: results.slice(i, i + 500) });
        if (rErr) throw new Error(`record: ${rErr.message}`);
      }
    }
    if (scanned < 1000 || !data?.last_person) { after = { p: null, e: null }; passes += 1; break; }
    after = { p: data.last_person, e: data.last_episode };
  }
  if (!dryRun) {
    await admin.from("app_settings").upsert({ key: CURSOR_KEY, value: { last_person: after.p, last_episode: after.e, passes_completed: passes,
      rule_version: ROLE_LABEL_RULE_VERSION, last_run_at: new Date().toISOString(), last_counts: counts } }, { onConflict: "key" });
  }
  return { scanned: scannedTotal, counts, applied: applied.slice(0, 40), applied_total: applied.length, passes_completed: passes };
}
const RECHECK_OUTCOMES = /^(source_changed|blocked_|identity_unanchored|mention_state_changed|busy_retry)/;
const base = (r: any) => ({ person_id: r.person_id, episode_id: r.episode_id, source_hash: r.source_hash });

async function pageFetchLane(admin: any, ctrl: any, body: any, started: number, dryRun: boolean) {
  const cap = Math.max(0, Math.min(5000, Number(ctrl.page_fetch_daily_cap ?? 1500)));
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const { count: today } = await admin.from("episode_public_page_evidence").select("episode_id", { count: "exact", head: true }).gte("fetched_at", since.toISOString());
  const left = Math.max(0, cap - Number(today || 0));
  const limit = Math.min(left, Math.max(1, Math.min(100, Number(body.pages ?? ctrl.page_fetch_per_run ?? 40))));
  if (limit <= 0) return { skipped: "daily_cap_reached", today };
  const { data: targets, error } = await admin.rpc("person_page_fetch_targets_v1", { _limit: limit, _skip_domains: ctrl.skip_domains || [] });
  if (error) throw new Error(`targets: ${error.message}`);
  const counts: Record<string, number> = {};
  const rows: any[] = [];
  const queue = [...(targets || [])] as any[];
  const worker = async () => {
    while (queue.length && Date.now() - started < TIME_BUDGET_MS) {
      const t = queue.shift();
      let row: any = { episode_id: t.episode_id, url: t.url };
      try {
        const res = await safePublicFetch(t.url, { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" }, signal: AbortSignal.timeout(8000) });
        const ctype = res.headers.get("content-type") || "";
        if (!res.ok) { row = { ...row, status: "http_error", http_status: res.status }; try { await res.body?.cancel(); } catch { /* */ } }
        else if (!/html/i.test(ctype)) { row = { ...row, status: "no_meta", http_status: res.status, error: `content-type ${ctype.slice(0, 60)}` }; try { await res.body?.cancel(); } catch { /* */ } }
        else {
          const html = await readCapped(res);
          const meta = parseEpisodePageMeta(html, t.rss_description, t.podcast_description);
          row = { ...row, status: meta.status, http_status: res.status, page_title: meta.title, page_description: meta.description,
            content_hash: meta.description ? await contentHash(meta.description) : null };
        }
      } catch (e) {
        const msg = String((e as Error)?.message || e);
        row = { ...row, status: /not allowed|private|blocked|unsafe/i.test(msg) ? "blocked" : "fetch_error", error: msg.slice(0, 200) };
      }
      counts[row.status] = (counts[row.status] || 0) + 1;
      rows.push(row);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  if (!dryRun && rows.length) {
    const { error: wErr } = await admin.rpc("record_episode_page_evidence_v1", { _rows: rows });
    if (wErr) throw new Error(`record pages: ${wErr.message}`);
  }
  return { fetched: rows.length, counts, today_before: today, sample: dryRun ? rows.slice(0, 5).map((r) => ({ url: r.url, status: r.status, page_description: String(r.page_description || "").slice(0, 200) })) : undefined };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const denied = await denyUntrustedCaller(req, JOB);
  if (denied) return denied;
  const started = Date.now();
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({} as any));
  const action = String(body.action || "status");
  const { data: cRow } = await admin.from("app_settings").select("value").eq("key", CONTROLS_KEY).maybeSingle();
  const ctrl = (cRow?.value || {}) as any;
  if (action === "status") {
    const { data: cur } = await admin.from("app_settings").select("value").eq("key", CURSOR_KEY).maybeSingle();
    return json({ ok: true, controls: ctrl, role_label_cursor: cur?.value ?? null });
  }
  if (!["role_label", "page_fetch"].includes(action)) return json({ error: "unknown_action" }, 400);
  const dryRun = body.dry_run === true;
  if (!dryRun) {
    const guard = await checkBackgroundJobsAllowed(admin, JOB);
    if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });
    if (ctrl.enabled !== true) return json({ ok: true, paused: true, reason: "disabled_by_controls" });
    if (action === "role_label" && ctrl.role_label_enabled !== true) return json({ ok: true, paused: true, reason: "role_label_disabled" });
    if (action === "page_fetch" && ctrl.page_fetch_enabled !== true) return json({ ok: true, paused: true, reason: "page_fetch_disabled" });
    const blocker = await checkProcessingPriority(admin, "person_source_lanes");
    if (blocker) return json({ ok: true, skipped: true, reason: blocker });
  }
  const lane = `person_${action}`;
  const { data: token, error: lErr } = await admin.rpc("acquire_person_source_lane_v1", { _lane: lane, _seconds: 180 });
  if (lErr) return json({ error: `lease: ${lErr.message}` }, 500);
  if (!token) return json({ ok: true, skipped: true, reason: "lane_busy" });
  const log = runLog(admin, `${JOB}:${action}`);
  await log.start({ action, dry_run: dryRun });
  try {
    const out = action === "role_label" ? await roleLabelLane(admin, ctrl, body, started, dryRun) : await pageFetchLane(admin, ctrl, body, started, dryRun);
    await log.finish("ok", { action, dry_run: dryRun, ...out, applied: undefined, sample: undefined });
    return json({ ok: true, action, dry_run: dryRun, ...out, ms: Date.now() - started });
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    await log.finish("error", { action }, msg);
    return json({ ok: false, error: msg.slice(0, 300) }, 500);
  } finally {
    await admin.rpc("release_person_source_lane_v1", { _lane: lane, _token: token });
  }
});
