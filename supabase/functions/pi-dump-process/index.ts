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
  if (lang.startsWith("en")) { s += 1; reasons.push({ delta: 1, note: "English" }); }
  else { s -= 4; reasons.push({ delta: -4, note: "non-English" }); }
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
    const batchSize = Math.max(1, Math.min(foundation ? 250 : 200, Number(body.batch) || (foundation ? 250 : 100)));
    const importId: string | undefined = body.import_id;

    const { data: settingsRow } = await supabase.from("app_settings").select("value").eq("key", "growth").maybeSingle();
    const settings: any = settingsRow?.value || {};
    const minRank = settings.min_rank_for_auto_add || 8;
    const maxAge = settings.max_episode_age_days || 90;
    const HARD_MAX_AUTO_ADD = 5;
    // Foundation mode lifts the per-call auto-add cap (technical batching only).
    const maxAutoAdd = foundation ? batchSize : Math.min(HARD_MAX_AUTO_ADD, settings.max_auto_add_per_run || HARD_MAX_AUTO_ADD);

    let q = supabase.from("pi_feed_staging").select("*").eq("processed", false).limit(batchSize);
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
    };
    let autoAddedThisRun = 0;
    const start = Date.now();
    const TIME_BUDGET = 100_000;

    for (const r of rows || []) {
      if (Date.now() - start > TIME_BUDGET) break;
      counters.scanned++;
      const updates: any = { processed: true, processed_at: new Date().toISOString() };

      // Hard reject: non-English, dead, stale
      const lang = (r.language || "").toLowerCase();
      if (!lang.startsWith("en")) { updates.decision = "rejected"; updates.reject_reason = "non-English"; counters.rejected++; }
      else if (r.dead) { updates.decision = "rejected"; updates.reject_reason = "dead"; counters.rejected++; }
      else {
        const { score, reasons, ageDays } = scoreRow(r, maxAge);
        updates.score = score;
        if (ageDays > maxAge) { updates.decision = "rejected"; updates.reject_reason = "stale"; counters.rejected++; }
        else {
          // dedup check (re-check podcasts in case it was added meanwhile)
          const { data: existing } = await supabase.from("podcasts").select("id").eq("rss_url", r.rss_url).maybeSingle();
          if (existing) { updates.decision = "rejected"; updates.reject_reason = "already imported"; counters.skipped_duplicates++; }
          else if (score >= minRank && autoAddedThisRun < maxAutoAdd) {
            // Insert podcast + hydrate RSS
            const slugBase = slugify(r.title || "podcast");
            let slug = slugBase;
            for (let a = 0; a < 5; a++) {
              const { data: dup } = await supabase.from("podcasts").select("id").eq("slug", slug).maybeSingle();
              if (!dup) break;
              slug = `${slugBase}-${a + 1}`;
            }
            const { data: inserted, error: insErr } = await supabase.from("podcasts").insert({
              title: r.title || "Untitled",
              slug,
              description: r.description,
              rss_url: r.rss_url,
              website_url: r.website_url,
              image_url: r.image_url,
              language: r.language || "en",
              source: importSourceMap[r.import_id] || "pi_dump",
              rss_status: "not_checked",
              podiverzum_rank: score,
              rank_label: score >= 8 ? "Excellent" : "Strong",
              rank_reason: { factors: reasons, source: importSourceMap[r.import_id] || "pi_dump" },
              rank_updated_at: new Date().toISOString(),
            }).select("id").maybeSingle();

            if (insErr || !inserted) {
              updates.decision = "failed";
              updates.reject_reason = insErr?.message || "insert failed";
              counters.failed_rss_tests++;
            } else {
              autoAddedThisRun++;
              counters.auto_added++; counters.accepted++;
              updates.decision = "imported";
              try {
                const fr = await fetchOne(supabase, { id: inserted.id, rss_url: r.rss_url, image_url: r.image_url });
                if (!fr.ok) counters.failed_rss_tests++;
              } catch { counters.failed_rss_tests++; }
            }
          } else if (score >= 6) {
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
            updates.reject_reason = "rank ≤ 5";
            counters.hidden_low_rank++;
          }
        }
      }
      await supabase.from("pi_feed_staging").update(updates).eq("id", r.id);
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

    return new Response(JSON.stringify({ ok: true, processed: counters.scanned, counters, auto_added_cap: maxAutoAdd }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
