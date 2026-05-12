// Process unprocessed staging rows: score, decide (auto_add/queue/hide), hydrate via RSS.
// Body (optional): { import_id?, batch?: number (default 100) }
// Caps per call: 100 staging rows scored, 5 auto-adds (subject to settings.max_auto_add_per_run).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { fetchOne } from "../_shared/fetch-one.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80) || "podcast";
}

function scoreRow(r: any, maxAge: number) {
  const reasons: { delta: number; note: string }[] = [];
  let s = 1; reasons.push({ delta: 1, note: "base" });
  if (r.rss_url) { s += 2; reasons.push({ delta: 2, note: "has RSS" }); }
  if (r.image_url) { s += 1; reasons.push({ delta: 1, note: "has image" }); }
  if (r.description) { s += 1; reasons.push({ delta: 1, note: "has description" }); }
  const last = r.newest_item_at ? new Date(r.newest_item_at).getTime() : 0;
  const ageDays = last ? (Date.now() - last) / 86400000 : 9999;
  if (ageDays <= 14) { s += 2; reasons.push({ delta: 2, note: "fresh ≤14d" }); }
  else if (ageDays <= maxAge) { s += 1; reasons.push({ delta: 1, note: `≤${maxAge}d` }); }
  else { s -= 3; reasons.push({ delta: -3, note: `stale >${maxAge}d` }); }
  if ((r.episode_count || 0) >= 100) { s += 2; reasons.push({ delta: 2, note: "100+ episodes" }); }
  else if ((r.episode_count || 0) >= 30) { s += 1; reasons.push({ delta: 1, note: "30+ episodes" }); }
  const lang = (r.language || "").toLowerCase();
  const aiLang = (r.ai_detected_language || "").toLowerCase().trim();
  // HU-only mode: prefer Hungarian. Tolerate unknown/und/mul.
  if (lang.startsWith("hu") || aiLang.startsWith("hu")) { s += 2; reasons.push({ delta: 2, note: "Hungarian" }); }
  else if (!lang || lang === "mul" || lang === "und") { reasons.push({ delta: 0, note: "lang unknown" }); }
  else { s -= 2; reasons.push({ delta: -2, note: `non-HU:${lang}` }); }
  if (r.dead) { s -= 5; reasons.push({ delta: -5, note: "dead" }); }
  if (r.last_http_status === 404) { s -= 5; reasons.push({ delta: -5, note: "HTTP 404" }); }
  return { score: Math.max(1, Math.min(10, Math.round(s))), reasons, ageDays };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    let body: any = {};
    try { body = req.method === "POST" ? await req.json() : {}; } catch { /* */ }
    const foundation: boolean = !!body.foundation;
    // Lightweight processor: cap episodes per podcast hard at 5 (was 30–75).
    // Deep hydration is deferred to deep-hydrate-runner via deep_hydration_status='not_started'.
    const LIGHT_EPISODE_CAP = Math.max(1, Math.min(10, Number(body.light_episode_cap) || 5));
    const batchSize = Math.max(1, Math.min(foundation ? 250 : 200, Number(body.batch) || (foundation ? 250 : 100)));
    const importId: string | undefined = body.import_id;

    const { data: settingsRow } = await supabase.from("app_settings").select("value").eq("key", "growth").maybeSingle();
    const settings: any = settingsRow?.value || {};
    // Daily mode keeps the strict promotion threshold; foundation lowers the import threshold to Rank >= 4
    // (index-only — public promotion gates remain Rank >= 6 in the UI).
    const dailyMinRank = settings.min_rank_for_auto_add || 8;
    const minRankImport = foundation ? 1 : (settings.min_rank_for_auto_add_hu || 3);
    const maxAge = settings.max_episode_age_days || 90;
    const HARD_MAX_AUTO_ADD = 5;
    // Foundation mode lifts the per-call auto-add cap (technical batching only).
    const maxAutoAdd = foundation ? batchSize : Math.min(HARD_MAX_AUTO_ADD, settings.max_auto_add_per_run || HARD_MAX_AUTO_ADD);

    const nowIso = new Date().toISOString();
    let q = supabase.from("pi_feed_staging").select("*").eq("processed", false)
      .or(`next_process_attempt_at.is.null,next_process_attempt_at.lte.${nowIso}`)
      .limit(batchSize);
    if (importId) q = q.eq("import_id", importId);
    const { data: rows, error } = await q;
    if (error) throw error;

    // Resolve import sources for tagging podcasts.source correctly
    const importIdsForRows = Array.from(new Set((rows || []).map((r: any) => r.import_id).filter(Boolean)));
    const importSourceMap: Record<string, string> = {};
    if (importIdsForRows.length) {
      const { data: imps } = await supabase.from("pi_dump_imports").select("id, source").in("id", importIdsForRows);
      (imps || []).forEach((i: any) => { importSourceMap[i.id] = i.source || "pi_dump"; });
    }

    const counters = {
      scanned: 0, accepted: 0, rejected: 0, auto_added: 0, queued: 0,
      hidden_low_rank: 0, failed_rss_tests: 0, skipped_duplicates: 0,
      episodes_imported_light: 0, deep_hydration_pending: 0,
    };
    let autoAddedThisRun = 0;
    const start = Date.now();
    // Lightweight: keep a tighter budget to avoid 546.
    const TIME_BUDGET = 60_000;

    const stagingBackoffMin = (n: number) => Math.min(2880, Math.round(15 * Math.pow(2, Math.min(n, 6))));

    for (const r of rows || []) {
      if (Date.now() - start > TIME_BUDGET) break;
      try {
      counters.scanned++;
      const updates: any = { processed: true, processed_at: new Date().toISOString() };

      // HU-only mode: very lax. Reject only obvious non-HU, dead feeds, or AI-flagged spam.
      const lang = (r.language || "").toLowerCase();
      const aiLang = (r.ai_detected_language || "").toLowerCase().trim();
      const huOk = lang.startsWith("hu") || aiLang.startsWith("hu") || (!aiLang || aiLang === "mul" || aiLang === "und");
      const langTagOk = !lang || lang === "mul" || lang === "und" || lang.startsWith("hu");
      const spamScore = Number(r.ai_spam_score) || 0;
      if (r.dead) { updates.decision = "rejected"; updates.reject_reason = "dead"; counters.rejected++; }
      else if (spamScore >= 0.75) { updates.decision = "rejected"; updates.reject_reason = `ai_spam:${spamScore}`; counters.rejected++; }
      else if (aiLang && !aiLang.startsWith("hu") && aiLang !== "mul" && aiLang !== "und") {
        // AI is sure it's not HU
        updates.decision = "rejected"; updates.reject_reason = `ai_lang:${aiLang}`; counters.rejected++;
      }
      else if (!huOk && !langTagOk) {
        updates.decision = "rejected"; updates.reject_reason = `non-HU:${lang}`; counters.rejected++;
      }
      else {
        const { score, reasons, ageDays } = scoreRow(r, maxAge);
        updates.score = score;
        // No stale rejection for HU — small market, keep everything that's not dead.
        {
          // dedup check (re-check podcasts in case it was added meanwhile)
          const { data: existing } = await supabase.from("podcasts").select("id").eq("rss_url", r.rss_url).maybeSingle();
          if (existing) { updates.decision = "rejected"; updates.reject_reason = "already imported"; counters.skipped_duplicates++; }
          else if (score >= minRankImport && autoAddedThisRun < maxAutoAdd) {
            // Insert podcast + hydrate RSS
            const slugBase = slugify(r.title || "podcast");
            let slug = slugBase;
            for (let a = 0; a < 5; a++) {
              const { data: dup } = await supabase.from("podcasts").select("id").eq("slug", slug).maybeSingle();
              if (!dup) break;
              slug = `${slugBase}-${a + 1}`;
            }
            // Phase 4a: do NOT write legacy rank_label at INSERT. Leave NULL so Formula C v3 / stage4-persist assigns S/A/B/C/D/E.
            const { data: inserted, error: insErr } = await supabase.from("podcasts").insert({
              title: r.title || "Untitled",
              slug,
              description: r.description,
              rss_url: r.rss_url,
              website_url: r.website_url,
              image_url: r.image_url,
              language: r.language || (aiLang.startsWith("hu") ? "hu" : "hu"),
              source: importSourceMap[r.import_id] || "pi_dump",
              rss_status: "not_checked",
              podiverzum_rank: score,
              rank_reason: { factors: reasons, source: importSourceMap[r.import_id] || "pi_dump" },
              // Mark for deferred deep hydration — handled by deep-hydrate-runner.
              deep_hydration_status: "not_started",
              deep_hydration_target: score >= 8 ? 100 : score >= 6 ? 75 : 40,
            }).select("id").maybeSingle();

            if (insErr || !inserted) {
              updates.decision = "failed";
              updates.reject_reason = insErr?.message || "insert failed";
              counters.failed_rss_tests++;
            } else {
              autoAddedThisRun++;
              counters.auto_added++; counters.accepted++;
              counters.deep_hydration_pending++;
              updates.decision = "imported";
              try {
                // LIGHT IMPORT ONLY: at most 5 newest episodes for instant visibility.
                // Full hydration is deferred to deep-hydrate-runner.
                const fr = await fetchOne(
                  supabase,
                  { id: inserted.id, rss_url: r.rss_url, image_url: r.image_url },
                  { episodeCap: LIGHT_EPISODE_CAP },
                );
                if (!fr.ok) counters.failed_rss_tests++;
                else counters.episodes_imported_light += (fr.new || 0);
              } catch { counters.failed_rss_tests++; }
            }
          } else if (!foundation && score >= 6) {
            // Daily mode: rank 6–7 goes to approval queue.
            await supabase.from("discovery_queue").upsert({
              pi_id: r.pi_id,
              title: r.title,
              rss_url: r.rss_url,
              website_url: r.website_url,
              image_url: r.image_url,
              description: r.description,
              language: r.language,
              author: r.author,
              episode_count: r.episode_count,
              last_episode_at: r.newest_item_at,
              candidate_rank: score,
              rank_reason: { factors: reasons, source: importSourceMap[r.import_id] || "pi_dump" },
              status: "pending",
              source: importSourceMap[r.import_id] || "pi_dump",
              updated_at: new Date().toISOString(),
            }, { onConflict: "rss_url" });
            updates.decision = "queued";
            counters.queued++; counters.accepted++;
          } else {
            updates.decision = "hidden";
            updates.reject_reason = foundation ? "rank ≤ 3" : "rank ≤ 5";
            counters.hidden_low_rank++;
          }
        }
      }
      await supabase.from("pi_feed_staging").update(updates).eq("id", r.id);
      } catch (rowErr) {
        // Per-row failure: stamp backoff so we don't loop on the same row
        const attempts = (r.process_attempts || 0) + 1;
        await supabase.from("pi_feed_staging").update({
          process_attempts: attempts,
          next_process_attempt_at: new Date(Date.now() + stagingBackoffMin(attempts) * 60_000).toISOString(),
          reject_reason: `process_error: ${rowErr instanceof Error ? rowErr.message : String(rowErr)}`.slice(0, 500),
        }).eq("id", r.id);
        counters.failed_rss_tests++;
      }
    }

    // Roll up into the import row (if any rows belong to a single import)
    const importIds = Array.from(new Set((rows || []).map((r: any) => r.import_id).filter(Boolean)));
    for (const id of importIds) {
      const { data: cur } = await supabase.from("pi_dump_imports").select("*").eq("id", id).single();
      if (!cur) continue;
      await supabase.from("pi_dump_imports").update({
        feeds_scanned: (cur.feeds_scanned || 0) + counters.scanned,
        candidates_accepted: (cur.candidates_accepted || 0) + counters.accepted,
        candidates_rejected: (cur.candidates_rejected || 0) + counters.rejected,
        auto_added: (cur.auto_added || 0) + counters.auto_added,
        queued: (cur.queued || 0) + counters.queued,
        hidden_low_rank: (cur.hidden_low_rank || 0) + counters.hidden_low_rank,
        skipped_duplicates: (cur.skipped_duplicates || 0) + counters.skipped_duplicates,
        failed_rss_tests: (cur.failed_rss_tests || 0) + counters.failed_rss_tests,
        updated_at: new Date().toISOString(),
      }).eq("id", id);

      // Mark done if no unprocessed rows remain for this import
      const { count } = await supabase.from("pi_feed_staging").select("id", { count: "exact", head: true })
        .eq("import_id", id).eq("processed", false);
      if ((count || 0) === 0) {
        await supabase.from("pi_dump_imports").update({ status: "done" }).eq("id", id);
      }
    }

    // Adaptive self-scheduling: re-tune cron based on remaining backlog.
    let nextSchedule: string | null = null;
    try {
      const { count: pending } = await supabase.from("pi_feed_staging")
        .select("id", { count: "exact", head: true }).eq("processed", false);
      const { data: sched } = await supabase.rpc("set_pi_dump_process_schedule", { pending_count: pending || 0 });
      nextSchedule = (sched as string) || null;
    } catch (e) {
      console.warn("adaptive schedule failed:", e instanceof Error ? e.message : e);
    }

    return new Response(JSON.stringify({ ok: true, processed: counters.scanned, counters, auto_added_cap: maxAutoAdd, next_schedule: nextSchedule }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
