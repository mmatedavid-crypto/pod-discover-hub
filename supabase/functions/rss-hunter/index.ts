// Proactive RSS Hunter
// Picks candidates likely to have a stale/migrated RSS URL, queries Podcast Index,
// verifies via title sim + GUID overlap, auto-recovers on high confidence,
// queues medium-confidence for manual review, logs everything.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RECHECK_DAYS_NOT_FOUND = 7;
const REVERIFY_DAYS_RECOVERED = 7;
// Hard cap: after this many failed hunt attempts we stop polling the feed.
// Prevents wasted PI/RSS calls on permanently dead podcasts.
const MAX_HUNT_ATTEMPTS = 10;
const GIVE_UP_PARK_DAYS = 365;
// Attempt-weighted backoff days: base * 2^min(attempts,4)
function huntBackoffDays(baseDays: number, attempts: number): number {
  return baseDays * Math.pow(2, Math.min(attempts, 4));
}

function norm(s: string) {
  return (s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
function sim(a: string, b: string) {
  const A = new Set(norm(a).split(" ").filter(Boolean));
  const B = new Set(norm(b).split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0; A.forEach((t) => { if (B.has(t)) inter++; });
  return inter / Math.max(A.size, B.size);
}
function host(u?: string | null) { try { return u ? new URL(u).hostname.replace(/^www\./, "") : ""; } catch { return ""; } }

async function piSearch(title: string) {
  const key = Deno.env.get("PODCAST_INDEX_API_KEY")!;
  const sec = Deno.env.get("PODCAST_INDEX_API_SECRET")!;
  const ts = Math.floor(Date.now() / 1000).toString();
  const data = new TextEncoder().encode(key + sec + ts);
  const buf = await crypto.subtle.digest("SHA-1", data);
  const hash = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const u = `https://api.podcastindex.org/api/1.0/search/byterm?q=${encodeURIComponent(title)}&max=8`;
  const r = await fetch(u, {
    headers: { "User-Agent": "Podiverzum/1.0", "X-Auth-Date": ts, "X-Auth-Key": key, Authorization: hash },
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) return [];
  const j = await r.json().catch(() => ({}));
  return (j.feeds || []) as any[];
}

function extractGuids(xml: string): string[] {
  const out: string[] = [];
  const re = /<item\b[\s\S]*?<\/item>/gi;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(xml)) !== null && i < 5) {
    const g = m[0].match(/<guid[^>]*>([\s\S]*?)<\/guid>/i);
    if (g?.[1]) out.push(g[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim());
    i++;
  }
  return out;
}

async function verifyFeed(url: string, expectedTitle: string) {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Podiverzum/1.0" },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return { ok: false, sim: 0, feedTitle: "", guids: [] as string[] };
    const xml = (await r.text()).slice(0, 80_000);
    const m = xml.match(/<title[^>]*>\s*(?:<!\[CDATA\[)?([^<\]]+)/i);
    const feedTitle = m ? m[1].trim() : "";
    const hasItems = /<item[\s>]/i.test(xml);
    return { ok: hasItems, sim: sim(feedTitle, expectedTitle), feedTitle, guids: extractGuids(xml) };
  } catch { return { ok: false, sim: 0, feedTitle: "", guids: [] as string[] }; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const __guard = await checkBackgroundJobsAllowed(supabase, "rss-hunter");
    if (__guard.blocked) return new Response(JSON.stringify({ ok: true, skipped: true, reason: __guard.reason }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });

    // Kill switch
    const { data: ctrlRow } = await supabase.from("app_settings").select("value").eq("key", "rss_hunter_controls").maybeSingle();
    const ctrl = (ctrlRow?.value as any) || {};
    if (ctrl.enabled === false) {
      return new Response(JSON.stringify({ ok: true, skipped: "disabled" }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(50, Number(body.limit) || 20));
    const TIME_BUDGET_MS = Math.max(20_000, Math.min(110_000, Number(body.time_budget_ms) || 80_000));
    const startedAt = Date.now();

    // Build candidate set with priorities
    const nowIso = new Date().toISOString();
    const dueOrNull = `next_rss_hunt_at.is.null,next_rss_hunt_at.lte.${nowIso}`;

    // P0: confirmed problems (failed/stale, high quality)
    const { data: p0 } = await supabase.from("podcasts")
      .select("id, title, rss_url, website_url, rank_label, ai_quality_score, ai_spam_score, shadow_rank_components, rss_hunt_attempts, last_rss_hunt_at, next_rss_hunt_at, consecutive_failure_count, rss_status")
      .or("rss_status.eq.failed,consecutive_failure_count.gte.5")
      .gte("ai_quality_score", 5)
      .lt("rss_hunt_attempts", MAX_HUNT_ATTEMPTS)
      .or(dueOrNull)
      .limit(limit);

    // P1: S/A/B with host(website) != host(rss) — migration suspects
    const { data: p1raw } = await supabase.from("podcasts")
      .select("id, title, rss_url, website_url, rank_label, ai_quality_score, ai_spam_score, shadow_rank_components, rss_hunt_attempts, last_rss_hunt_at, next_rss_hunt_at, consecutive_failure_count, rss_status")
      .in("rank_label", ["S", "A", "B"])
      .not("website_url", "is", null)
      .not("rss_url", "is", null)
      .lt("rss_hunt_attempts", MAX_HUNT_ATTEMPTS)
      .or(dueOrNull)
      .limit(limit * 4);
    const p1 = (p1raw || []).filter((p: any) => {
      const wh = host(p.website_url), rh = host(p.rss_url);
      return wh && rh && wh !== rh && !rh.endsWith(wh) && !wh.endsWith(rh);
    });

    // P2: previously recovered, re-verify weekly
    const reverifyBefore = new Date(Date.now() - REVERIFY_DAYS_RECOVERED * 86400_000).toISOString();
    const { data: p2 } = await supabase.from("podcasts")
      .select("id, title, rss_url, website_url, rank_label, ai_quality_score, ai_spam_score, shadow_rank_components, rss_hunt_attempts, last_rss_hunt_at, next_rss_hunt_at, consecutive_failure_count, rss_status")
      .eq("shadow_rank_components->>health_state", "recovered_rss_url")
      .lt("rss_hunt_attempts", MAX_HUNT_ATTEMPTS)
      .or(`last_rss_hunt_at.is.null,last_rss_hunt_at.lt.${reverifyBefore}`)
      .limit(limit);

    const seen = new Set<string>();
    const queue: any[] = [];
    const tag = (arr: any[] | null, prio: string) => (arr || []).forEach((p) => {
      if (seen.has(p.id)) return;
      seen.add(p.id);
      queue.push({ ...p, _prio: prio });
    });
    tag(p0, "P0"); tag(p1, "P1"); tag(p2, "P2");
    const list = queue.slice(0, limit);

    const results: any[] = [];
    let recovered = 0, manualReview = 0, notFound = 0, errors = 0, reverified = 0, gaveUp = 0;

    for (const p of list) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) break;
      try {
        // Get current feed's recent guids (for overlap check) — best effort
        let currentGuids: string[] = [];
        try {
          const { data: eps } = await supabase.from("episodes")
            .select("guid").eq("podcast_id", p.id).not("guid", "is", null)
            .order("published_at", { ascending: false }).limit(5);
          currentGuids = (eps || []).map((e: any) => e.guid).filter(Boolean);
        } catch { /* noop */ }

        const feeds = await piSearch(p.title);
        let best: { url: string; conf: number; feedTitle?: string; guidOverlap: number; piSim: number; verifySim: number } | null = null;
        for (const f of feeds.slice(0, 5)) {
          if (!f.url) continue;
          const sameUrl = f.url === p.rss_url;
          const v = await verifyFeed(f.url, p.title);
          const piSim = sim(f.title || "", p.title);
          const overlap = currentGuids.length && v.guids.length
            ? v.guids.filter((g) => currentGuids.includes(g)).length / Math.min(currentGuids.length, v.guids.length)
            : 0;
          // Confidence: GUID overlap is strongest, then verify title sim, then PI sim
          const conf = Math.min(1,
            0.55 * overlap + 0.30 * v.sim + 0.15 * piSim + (v.ok ? 0.05 : 0)
          );
          if (sameUrl && p._prio === "P2") {
            // re-verify path: same URL still works
            if (v.ok && (overlap >= 0.4 || v.sim >= 0.7)) {
              reverified++;
              results.push({ id: p.id, title: p.title, prio: p._prio, action: "reverified", url: f.url });
              best = null; break;
            }
            continue;
          }
          if (sameUrl) continue;
          if (!best || conf > best.conf) best = { url: f.url, conf, feedTitle: v.feedTitle, guidOverlap: overlap, piSim, verifySim: v.sim };
        }

        const oldUrl = p.rss_url;
        const comp = (p.shadow_rank_components as any) || {};
        const attempts = (p.rss_hunt_attempts || 0) + 1;
        const reverifyDays = huntBackoffDays(REVERIFY_DAYS_RECOVERED, attempts - 1);
        const recheckDays = huntBackoffDays(RECHECK_DAYS_NOT_FOUND, attempts - 1);
        const updateBase: any = {
          rss_hunt_attempts: attempts,
          last_rss_hunt_at: new Date().toISOString(),
        };

        const giveUp = attempts >= MAX_HUNT_ATTEMPTS;

        if (!best) {
          // No usable candidate (or P2 reverify already settled)
          if (results.length && results[results.length - 1]?.id === p.id) {
            await supabase.from("podcasts").update({
              ...updateBase,
              next_rss_hunt_at: new Date(Date.now() + (giveUp ? GIVE_UP_PARK_DAYS : reverifyDays) * 86400_000).toISOString(),
            }).eq("id", p.id);
            continue;
          }
          if (giveUp) {
            comp.health_state = "rss_url_unrecoverable";
            comp.rss_hunt = {
              ...(comp.rss_hunt || {}),
              at: updateBase.last_rss_hunt_at,
              result: "gave_up",
              attempts,
            };
          } else {
            comp.health_state = comp.health_state || "rss_url_not_found";
            comp.rss_hunt = { ...(comp.rss_hunt || {}), at: updateBase.last_rss_hunt_at, result: "not_found" };
          }
          await supabase.from("podcasts").update({
            ...updateBase,
            shadow_rank_components: comp,
            next_rss_hunt_at: new Date(Date.now() + (giveUp ? GIVE_UP_PARK_DAYS : recheckDays) * 86400_000).toISOString(),
          }).eq("id", p.id);
          if (giveUp) gaveUp++; else notFound++;
          results.push({ id: p.id, title: p.title, prio: p._prio, action: giveUp ? "gave_up" : "not_found", attempts });
          continue;
        }

        // Strong identity: confidence >= 0.85 AND (GUID overlap >= 0.4 OR verify title sim >= 0.85)
        const strongIdentity = best.guidOverlap >= 0.4 || best.verifySim >= 0.85;
        if (best.conf >= 0.85 && strongIdentity) {
          comp.health_state = "recovered_rss_url";
          comp.rss_hunt = {
            at: updateBase.last_rss_hunt_at, result: "recovered",
            confidence: best.conf, guid_overlap: best.guidOverlap,
            verify_sim: best.verifySim, pi_sim: best.piSim, old_url: oldUrl,
          };
          await supabase.from("podcasts").update({
            ...updateBase,
            rss_url: best.url,
            rss_status: "not_checked",
            consecutive_failure_count: 0,
            last_fetch_error: null,
            shadow_rank_components: comp,
            next_rss_hunt_at: new Date(Date.now() + reverifyDays * 86400_000).toISOString(),
          }).eq("id", p.id);
          await supabase.from("rss_url_history").insert({
            podcast_id: p.id, old_url: oldUrl, new_url: best.url,
            reason: `proactive_hunt confidence=${best.conf.toFixed(2)} guid_overlap=${best.guidOverlap.toFixed(2)} prio=${p._prio}`,
          });
          // Trigger light hydration (best-effort, non-blocking)
          try {
            await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/fetch-rss`, {
              method: "POST",
              headers: { "Content-Type": "application/json", apikey: Deno.env.get("SUPABASE_ANON_KEY")! },
              body: JSON.stringify({ podcast_id: p.id }),
            }).catch(() => {});
          } catch { /* noop */ }
          recovered++;
          results.push({ id: p.id, title: p.title, prio: p._prio, action: "recovered", confidence: best.conf, guid_overlap: best.guidOverlap, new_url: best.url });
        } else if (best.conf >= 0.65) {
          // Skip re-proposing the same candidate URL within recheck window
          const prevCand = (comp.rss_hunt_candidate || {}) as any;
          const sameAsBefore = prevCand.url && prevCand.url === best.url;
          comp.health_state = "needs_manual_rss_review";
          comp.rss_hunt_candidate = {
            url: best.url, confidence: best.conf, guid_overlap: best.guidOverlap,
            verify_sim: best.verifySim, pi_sim: best.piSim, at: updateBase.last_rss_hunt_at, prio: p._prio,
          };
          // Cooldown longer when proposing same URL repeatedly
          const cooldownDays = sameAsBefore ? recheckDays * 2 : recheckDays;
          await supabase.from("podcasts").update({
            ...updateBase,
            shadow_rank_components: comp,
            next_rss_hunt_at: new Date(Date.now() + cooldownDays * 86400_000).toISOString(),
          }).eq("id", p.id);
          manualReview++;
          results.push({ id: p.id, title: p.title, prio: p._prio, action: "manual_review", confidence: best.conf, guid_overlap: best.guidOverlap, candidate: best.url, repeat: !!sameAsBefore });
        } else {
          comp.rss_hunt = { at: updateBase.last_rss_hunt_at, result: "low_confidence", confidence: best.conf };
          await supabase.from("podcasts").update({
            ...updateBase,
            shadow_rank_components: comp,
            next_rss_hunt_at: new Date(Date.now() + recheckDays * 86400_000).toISOString(),
          }).eq("id", p.id);
          notFound++;
          results.push({ id: p.id, title: p.title, prio: p._prio, action: "no_change", confidence: best.conf });
        }
      } catch (e) {
        errors++;
        results.push({ id: p.id, title: p.title, prio: p._prio, action: "error", error: String(e) });
      }
    }

    // Estimate due count for adaptive scheduling
    let due_count = 0;
    try {
      const { count } = await supabase.from("podcasts")
        .select("id", { count: "exact", head: true })
        .or("rss_status.eq.failed,consecutive_failure_count.gte.5")
        .or(`next_rss_hunt_at.is.null,next_rss_hunt_at.lte.${nowIso}`);
      due_count = count || 0;
    } catch { /* noop */ }

    // Adaptive cadence based on hunting backlog (due_count) and error rate.
    let recommended: string;
    if (errors > 0) recommended = "0 */6 * * *";
    else if (due_count > 500) recommended = "*/30 * * * *";
    else if (due_count >= 100) recommended = "0 */2 * * *";
    else if (due_count >= 1) recommended = "0 */6 * * *";
    else recommended = "0 6 * * *";

    let applied: string | null = null;
    try {
      await supabase.rpc("set_rss_hunter_schedule", { _schedule: recommended });
      applied = recommended;
    } catch (e) {
      console.warn("set_rss_hunter_schedule failed:", (e as any)?.message);
    }

    const summary = {
      started_at: new Date(startedAt).toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      checked: results.length, recovered, manual_review: manualReview,
      not_found: notFound, reverified, errors, gave_up: gaveUp,
      pool: { p0: p0?.length || 0, p1: p1.length, p2: p2?.length || 0 },
      due_count, recommended_schedule: recommended, applied_schedule: applied,
    };
    await supabase.from("app_settings").upsert({
      key: "rss_hunter", value: { last_run: summary, recent: results.slice(0, 20) } as any,
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });

    return new Response(JSON.stringify({ ok: true, ...summary, results }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
