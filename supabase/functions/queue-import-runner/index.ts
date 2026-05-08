// Backend bulk runner: processes discovery_queue in server-side batches.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { fetchOne } from "../_shared/fetch-one.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TEMP_ADMIN_USER_ID = "7b92654a-2b5d-438c-ad67-7ad5f6709483";

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80) || "podcast";
}

function backoffMin(attempts: number): number {
  // 30m * 2^min(n,6) capped at ~32h
  return Math.min(1920, Math.round(30 * Math.pow(2, Math.min(attempts, 6))));
}

async function importOne(admin: any, item: any) {
  const stamp = new Date().toISOString();
  const attempts = (item.import_attempts || 0) + 1;
  const setQueueFail = (patch: any) => admin.from("discovery_queue").update({
    ...patch,
    last_import_attempt_at: stamp,
    import_attempts: attempts,
    next_import_attempt_at: new Date(Date.now() + backoffMin(attempts) * 60_000).toISOString(),
  }).eq("id", item.id);
  const setQueueOk = (patch: any) => admin.from("discovery_queue").update({
    ...patch,
    last_import_attempt_at: stamp,
    import_attempts: attempts,
    next_import_attempt_at: null,
  }).eq("id", item.id);
  const base = { title: item.title, rss_url: item.rss_url, rank: item.candidate_rank };

  await admin.from("discovery_queue").update({ import_status: "importing", import_error: null }).eq("id", item.id);

  if (!item.rss_url || !item.title) {
    const reason = !item.rss_url ? "missing rss_url" : "missing title";
    await setQueueFail({ import_status: "failed", import_error: reason, status: "rejected" });
    return { ...base, status: "failed", reason };
  }

  const { data: dup } = await admin.from("podcasts").select("id").eq("rss_url", item.rss_url).maybeSingle();
  if (dup) {
    await setQueueOk({ import_status: "skipped_duplicate", import_error: "duplicate rss_url", status: "approved", imported_podcast_id: dup.id });
    return { ...base, status: "skipped_duplicate", reason: "duplicate rss_url", podcast_id: dup.id };
  }

  let slug = slugify(item.title);
  for (let a = 0; a < 6; a++) {
    const { data: ds } = await admin.from("podcasts").select("id").eq("slug", slug).maybeSingle();
    if (!ds) break;
    slug = `${slugify(item.title)}-${a + 1}`;
  }

  // Phase 4a: do NOT write legacy rank_label at INSERT. Leave NULL so Formula C v3 / stage4-persist assigns S/A/B/C/D/E.
  const { data: inserted, error: insErr } = await admin.from("podcasts").insert({
    title: item.title, slug,
    description: item.description, rss_url: item.rss_url,
    website_url: item.website_url, image_url: item.image_url,
    language: item.language || "en", category: item.category,
    source: "queue_bulk_import",
    rss_status: "not_checked",
    podiverzum_rank: item.candidate_rank,
    rank_reason: item.rank_reason,
  }).select("*").single();

  if (insErr || !inserted) {
    const reason = `insert failed: ${insErr?.message || "unknown"}`;
    await setQueueFail({ import_status: "failed", import_error: reason });
    return { ...base, status: "failed", reason };
  }

  const epCap = item.candidate_rank >= 8 ? 75 : item.candidate_rank >= 6 ? 50 : 30;
  let fetchRes: any = null; let fetchErr: string | null = null;
  try {
    fetchRes = await fetchOne(admin, inserted, { episodeCap: epCap });
  } catch (e: any) {
    fetchErr = e?.message || String(e);
  }

  if (fetchErr || !fetchRes?.ok) {
    const reason = `RSS fetch failed: ${fetchErr || fetchRes?.error || "unknown"}`;
    await setQueueOk({
      import_status: "imported_with_rss_error", import_error: reason,
      status: "approved", imported_podcast_id: inserted.id, imported_at: stamp,
    });
    return { ...base, status: "imported_with_rss_error", reason, podcast_id: inserted.id };
  }

  await setQueueOk({
    import_status: "imported", import_error: null,
    status: "approved", imported_podcast_id: inserted.id, imported_at: stamp,
  });
  return { ...base, status: "imported", podcast_id: inserted.id, new_episodes: fetchRes.new, duplicates: fetchRes.duplicates };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE);

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userId = userData.user.id;
    const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
    if (!roleRow && userId !== TEMP_ADMIN_USER_ID) {
      return new Response(JSON.stringify({ error: "Admin access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const minRank = Math.max(0, Math.min(10, Number(body.min_rank) ?? 4));
    const batchSize = Math.max(1, Math.min(50, Number(body.batch_size) || 25));
    const maxBatches = Math.max(1, Math.min(40, Number(body.max_batches) || 10));
    // Keep well under platform limits (150s free / 400s pro) and gateway timeouts.
    const TIME_BUDGET_MS = Math.max(30_000, Math.min(120_000, Number(body.time_budget_ms) || 105_000));

    const startedAt = Date.now();
    let processed = 0, imported = 0, rss_err = 0, skipped = 0, failed = 0;
    const perBatch: any[] = [];
    let stoppedReason = "completed";
    let batchesRun = 0;

    for (let b = 0; b < maxBatches; b++) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) { stoppedReason = "time_budget"; break; }

      const nowIso = new Date().toISOString();
      const { data: queue, error: qErr } = await admin
        .from("discovery_queue").select("*")
        .eq("status", "pending").gte("candidate_rank", minRank)
        .or(`next_import_attempt_at.is.null,next_import_attempt_at.lte.${nowIso}`)
        .order("candidate_rank", { ascending: false }).limit(batchSize);
      if (qErr) throw qErr;
      if (!queue || queue.length === 0) { stoppedReason = "no_more_items"; break; }

      let bImp = 0, bRss = 0, bSkip = 0, bFail = 0;
      for (const item of queue) {
        if (Date.now() - startedAt > TIME_BUDGET_MS) { stoppedReason = "time_budget"; break; }
        const r = await importOne(admin, item);
        processed++;
        if (r.status === "imported") { imported++; bImp++; }
        else if (r.status === "imported_with_rss_error") { rss_err++; bRss++; }
        else if (r.status === "skipped_duplicate") { skipped++; bSkip++; }
        else { failed++; bFail++; }
      }
      batchesRun++;
      perBatch.push({ batch: b + 1, size: queue.length, imported: bImp, imported_with_rss_error: bRss, skipped_duplicate: bSkip, failed: bFail });
      if (stoppedReason === "time_budget") break;
    }
    if (stoppedReason === "completed" && batchesRun >= maxBatches) stoppedReason = "max_batches";

    const { count: remaining } = await admin
      .from("discovery_queue").select("*", { count: "exact", head: true })
      .eq("status", "pending").gte("candidate_rank", minRank);

    return new Response(JSON.stringify({
      ok: true,
      processed, imported, imported_with_rss_error: rss_err,
      skipped_duplicate: skipped, failed,
      remaining_pending_rank4_plus: remaining ?? 0,
      stopped_reason: stoppedReason,
      batches_run: batchesRun,
      elapsed_ms: Date.now() - startedAt,
      per_batch_results: perBatch,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
