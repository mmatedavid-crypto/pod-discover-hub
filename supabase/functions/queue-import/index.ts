// Bulk import from discovery_queue using service-role to bypass RLS.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { fetchOne } from "../_shared/fetch-one.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80) || "podcast";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE);

    // Auth check
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
    const TEMP_ADMIN_USER_ID = "7b92654a-2b5d-438c-ad67-7ad5f6709483";
    if (!roleRow && userId !== TEMP_ADMIN_USER_ID) {
      return new Response(JSON.stringify({ error: "Admin access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(2000, Number(body.limit) || 5));
    const minRank = Math.max(0, Math.min(10, Number(body.min_rank) ?? 4));
    const ids: string[] | undefined = Array.isArray(body.ids) ? body.ids : undefined;

    const nowIso = new Date().toISOString();
    let q = admin.from("discovery_queue").select("*").eq("status", "pending");
    if (ids && ids.length) q = q.in("id", ids);
    else q = q.gte("candidate_rank", minRank).or(`next_import_attempt_at.is.null,next_import_attempt_at.lte.${nowIso}`);
    const { data: queue, error: qErr } = await q.order("candidate_rank", { ascending: false }).limit(limit);
    if (qErr) throw qErr;

    const backoffMin = (n: number) => Math.min(1920, Math.round(30 * Math.pow(2, Math.min(n, 6))));

    const results: any[] = [];
    let imported = 0, rss_err = 0, skipped = 0, failed = 0;

    for (const item of queue || []) {
      const stamp = new Date().toISOString();
      const attempts = (item.import_attempts || 0) + 1;
      const setQueueFail = (patch: any) => admin.from("discovery_queue").update({
        ...patch, last_import_attempt_at: stamp, import_attempts: attempts,
        next_import_attempt_at: new Date(Date.now() + backoffMin(attempts) * 60_000).toISOString(),
      }).eq("id", item.id);
      const setQueueOk = (patch: any) => admin.from("discovery_queue").update({
        ...patch, last_import_attempt_at: stamp, import_attempts: attempts, next_import_attempt_at: null,
      }).eq("id", item.id);

      const base = { title: item.title, rss_url: item.rss_url, rank: item.candidate_rank };

      await admin.from("discovery_queue").update({ import_status: "importing", import_error: null }).eq("id", item.id);

      if (!item.rss_url || !item.title) {
        const reason = !item.rss_url ? "missing rss_url" : "missing title";
        await setQueueFail({ import_status: "failed", import_error: reason, status: "rejected" });
        failed++; results.push({ ...base, status: "failed", reason }); continue;
      }

      const { data: dup } = await admin.from("podcasts").select("id").eq("rss_url", item.rss_url).maybeSingle();
      if (dup) {
        await setQueueOk({ import_status: "skipped_duplicate", import_error: "duplicate rss_url", status: "approved", imported_podcast_id: dup.id });
        skipped++; results.push({ ...base, status: "skipped_duplicate", reason: "duplicate rss_url", podcast_id: dup.id }); continue;
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
        failed++; results.push({ ...base, status: "failed", reason }); continue;
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
        rss_err++; results.push({ ...base, status: "imported_with_rss_error", reason, podcast_id: inserted.id }); continue;
      }

      await setQueueOk({
        import_status: "imported", import_error: null,
        status: "approved", imported_podcast_id: inserted.id, imported_at: stamp,
      });
      imported++;
      results.push({ ...base, status: "imported", podcast_id: inserted.id, new_episodes: fetchRes.new, duplicates: fetchRes.duplicates });
    }

    return new Response(JSON.stringify({
      ok: true,
      processed: (queue || []).length,
      imported, imported_with_rss_error: rss_err, skipped_duplicate: skipped, failed,
      per_item_results: results,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
