// Auto-drainer: runs on a schedule, processes up to 10 Rank>=4 queue items,
// honors enable flag + lock in app_settings.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { fetchOne } from "../_shared/fetch-one.ts";
import { slugify as slugifyShared } from "../_shared/slug.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SETTING_KEY = "queue_drainer";
const TIME_BUDGET_MS = 105_000;
const BATCH_SIZE = 10;
const MIN_RANK = 4;
const LOCK_MS = 5 * 60 * 1000;

function slugify(s: string) {
  return slugifyShared(s, "podcast");
}

function lightCap(rank: number) {
  if (rank >= 8) return 30;
  if (rank >= 6) return 25;
  return 15;
}

function initialPublicRank(candidateRank: number) {
  // candidate_rank is operational import priority only; it must never create A/S public quality.
  const n = Number(candidateRank);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(3.5, n));
}

function initialRankLabel(score: number) {
  if (score >= 4) return "C";
  if (score >= 2.5) return "D";
  return "E";
}

async function importOne(admin: any, item: any) {
  const stamp = new Date().toISOString();
  const setQueue = (patch: any) =>
    admin.from("discovery_queue").update({ ...patch, last_import_attempt_at: stamp }).eq("id", item.id);
  const base = { title: item.title, rss_url: item.rss_url, rank: item.candidate_rank };

  await setQueue({ import_status: "importing", import_error: null });

  if (!item.rss_url || !item.title) {
    const reason = !item.rss_url ? "missing rss_url" : "missing title";
    await setQueue({ import_status: "failed", import_error: reason, status: "rejected" });
    return { ...base, status: "failed", reason };
  }

  const { data: dup } = await admin.from("podcasts").select("id").eq("rss_url", item.rss_url).maybeSingle();
  if (dup) {
    await setQueue({ import_status: "skipped_duplicate", import_error: "duplicate rss_url", status: "approved", imported_podcast_id: dup.id });
    return { ...base, status: "skipped_duplicate", podcast_id: dup.id };
  }

  let slug = slugify(item.title);
  for (let a = 0; a < 6; a++) {
    const { data: ds } = await admin.from("podcasts").select("id").eq("slug", slug).maybeSingle();
    if (!ds) break;
    slug = `${slugify(item.title)}-${a + 1}`;
  }

  const publicRank = initialPublicRank(item.candidate_rank);
  const { data: inserted, error: insErr } = await admin.from("podcasts").insert({
    title: item.title, slug,
    description: item.description, rss_url: item.rss_url,
    website_url: item.website_url, image_url: item.image_url,
    language: item.language || "en", category: item.category,
    source: "queue_drainer",
    rss_status: "not_checked",
    podiverzum_rank: publicRank,
    rank_label: initialRankLabel(publicRank),
    rank_reason: {
      formula: "import_public_rank_v1",
      source: "queue_drainer",
      candidate_rank: item.candidate_rank,
      candidate_rank_reason: item.rank_reason || null,
      note: "candidate_rank is import priority only; HU_v1/editorial quality must promote this podcast.",
    },
    rank_updated_at: stamp,
  }).select("*").single();

  if (insErr || !inserted) {
    const reason = `insert failed: ${insErr?.message || "unknown"}`;
    await setQueue({ import_status: "failed", import_error: reason });
    return { ...base, status: "failed", reason };
  }

  const cap = lightCap(item.candidate_rank);
  let fetchRes: any = null; let fetchErr: string | null = null;
  try { fetchRes = await fetchOne(admin, inserted, { episodeCap: cap }); }
  catch (e: any) { fetchErr = e?.message || String(e); }

  if (fetchErr || !fetchRes?.ok) {
    const reason = `RSS fetch failed: ${fetchErr || fetchRes?.error || "unknown"}`;
    await setQueue({
      import_status: "imported_with_rss_error", import_error: reason,
      status: "approved", imported_podcast_id: inserted.id, imported_at: stamp,
    });
    return { ...base, status: "imported_with_rss_error", reason, podcast_id: inserted.id };
  }

  await setQueue({
    import_status: "imported", import_error: null,
    status: "approved", imported_podcast_id: inserted.id, imported_at: stamp,
  });
  return { ...base, status: "imported", podcast_id: inserted.id };
}

async function readSetting(admin: any) {
  const { data } = await admin.from("app_settings").select("value").eq("key", SETTING_KEY).maybeSingle();
  return (data?.value as any) || {};
}

async function writeSetting(admin: any, value: any) {
  await admin.from("app_settings").upsert({ key: SETTING_KEY, value, updated_at: new Date().toISOString() });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE);
    const __guard = await checkBackgroundJobsAllowed(admin, "queue-drainer");
    if (__guard.blocked) return new Response(JSON.stringify({ ok: true, skipped: true, reason: __guard.reason }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });

    const setting = await readSetting(admin);
    const force = (() => { try { return new URL(req.url).searchParams.get("force") === "1"; } catch { return false; } })();

    if (!setting.enabled && !force) {
      return new Response(JSON.stringify({ ok: true, status: "disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = Date.now();
    const lockUntil = setting.lock_until ? new Date(setting.lock_until).getTime() : 0;
    if (lockUntil > now) {
      return new Response(JSON.stringify({ ok: true, status: "already_running", lock_until: setting.lock_until }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Acquire lock
    await writeSetting(admin, {
      ...setting,
      lock_started_at: new Date(now).toISOString(),
      lock_until: new Date(now + LOCK_MS).toISOString(),
    });

    const { count: pendingBefore } = await admin
      .from("discovery_queue").select("*", { count: "exact", head: true })
      .eq("status", "pending").gte("candidate_rank", MIN_RANK);

    if (!pendingBefore) {
      const result = {
        ...setting,
        lock_started_at: null, lock_until: null,
        last_run: {
          finished_at: new Date().toISOString(),
          processed: 0, imported: 0, imported_with_rss_error: 0,
          skipped_duplicate: 0, failed: 0, remaining: 0,
          stopped_reason: "no_more_items", elapsed_ms: 0,
        },
      };
      await writeSetting(admin, result);
      return new Response(JSON.stringify({ ok: true, status: "noop", remaining: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const startedAt = Date.now();
    let processed = 0, imported = 0, rss_err = 0, skipped = 0, failed = 0;
    let stopped = "completed";

    const { data: queue } = await admin
      .from("discovery_queue").select("*")
      .eq("status", "pending").gte("candidate_rank", MIN_RANK)
      .order("candidate_rank", { ascending: false }).limit(BATCH_SIZE);

    for (const item of queue || []) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) { stopped = "time_budget"; break; }
      const r = await importOne(admin, item);
      processed++;
      if (r.status === "imported") imported++;
      else if (r.status === "imported_with_rss_error") rss_err++;
      else if (r.status === "skipped_duplicate") skipped++;
      else failed++;
    }

    const { count: remaining } = await admin
      .from("discovery_queue").select("*", { count: "exact", head: true })
      .eq("status", "pending").gte("candidate_rank", MIN_RANK);

    const last_run = {
      started_at: new Date(startedAt).toISOString(),
      finished_at: new Date().toISOString(),
      processed, imported, imported_with_rss_error: rss_err,
      skipped_duplicate: skipped, failed,
      remaining: remaining ?? 0,
      stopped_reason: stopped,
      elapsed_ms: Date.now() - startedAt,
    };

    const fresh = await readSetting(admin);
    await writeSetting(admin, {
      ...fresh,
      lock_started_at: null, lock_until: null,
      last_run,
      total_imported: (fresh.total_imported || 0) + imported,
    });

    return new Response(JSON.stringify({ ok: true, status: "ran", ...last_run }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
