// Promotes passed clean-text candidates into the live episode_clean_text table.
// Only changed rows are promoted; unchanged candidates are marked separately.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

type AdminClient = ReturnType<typeof createClient>;

type CandidateRow = {
  episode_id: string;
  cleaner_method: string;
  source_hash: string;
  cleaned_text: string;
  removed_categories: string[] | null;
};

type CleanRow = {
  episode_id: string;
  source_hash: string;
  cleaned_text: string;
};

async function isAdmin(admin: AdminClient, authHeader: string | null) {
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (token && token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return true;
  const { data: u } = await admin.auth.getUser(token);
  if (!u?.user) return false;
  const { data: r } = await admin.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin").maybeSingle();
  return !!r;
}

async function updateEpisodesAfterPromotion(admin: AdminClient, ids: string[]) {
  if (!ids.length) return;
  const update = {
    clean_text_status: "done",
    ai_entities_version: 0,
    ai_enrich_input_hash: null,
    ai_enrich_prompt_version: null,
  };
  for (let i = 0; i < ids.length; i += 40) {
    const slice = ids.slice(i, i + 40);
    const { error } = await admin.from("episodes").update(update).in("id", slice);
    if (!error) continue;

    const message = String(error.message || "");
    if (!message.includes("ai_enrich_input_hash") && !message.includes("ai_enrich_prompt_version")) throw error;
    const fallback = { clean_text_status: "done", ai_entities_version: 0 };
    const retry = await admin.from("episodes").update(fallback).in("id", slice);
    if (retry.error) throw retry.error;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const ok = await isAdmin(admin, req.headers.get("Authorization"));
    if (!ok) return json({ ok: false, error: "forbidden" }, 403);

    const guard = await checkBackgroundJobsAllowed(admin, "episode-clean-text-candidate-promoter");
    if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });

    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(500, Number(body.limit || 100)));
    const dryRun = body.dry_run === true;

    const { data: candidates, error: candErr } = await admin
      .from("episode_clean_text_candidates")
      .select("episode_id,cleaner_method,source_hash,cleaned_text,removed_categories")
      .eq("quality_status", "passed")
      .is("promoted_at", null)
      .order("quality_score", { ascending: false, nullsFirst: false })
      .order("updated_at", { ascending: true })
      .limit(limit);
    if (candErr) throw candErr;

    const rowsByEpisode = new Map<string, CandidateRow>();
    for (const row of (candidates || []) as CandidateRow[]) {
      if (!rowsByEpisode.has(row.episode_id)) rowsByEpisode.set(row.episode_id, row);
    }
    const rows = Array.from(rowsByEpisode.values());
    const ids = rows.map((r) => r.episode_id);
    if (!ids.length) return json({ ok: true, promoted: 0, unchanged: 0, dry_run: dryRun });

    const { data: liveRows, error: liveErr } = await admin
      .from("episode_clean_text")
      .select("episode_id,source_hash,cleaned_text")
      .in("episode_id", ids);
    if (liveErr) throw liveErr;

    const liveById = new Map(((liveRows || []) as CleanRow[]).map((r) => [r.episode_id, r]));
    const changed = rows.filter((r) => {
      const live = liveById.get(r.episode_id);
      return !live || live.source_hash !== r.source_hash || live.cleaned_text !== r.cleaned_text;
    });
    const unchanged = rows.filter((r) => !changed.some((c) => c.episode_id === r.episode_id));

    if (dryRun) {
      return json({
        ok: true,
        dry_run: true,
        scanned: rows.length,
        promotable: changed.length,
        unchanged: unchanged.length,
        sample_episode_ids: changed.slice(0, 20).map((r) => r.episode_id),
      });
    }

    if (changed.length) {
      const now = new Date().toISOString();
      const upsertRows = changed.map((r) => ({
        episode_id: r.episode_id,
        source_hash: r.source_hash,
        cleaned_text: r.cleaned_text,
        removed_categories: r.removed_categories || [],
        cleaner_method: r.cleaner_method,
        updated_at: now,
      }));
      const { error: upErr } = await admin.from("episode_clean_text").upsert(upsertRows, { onConflict: "episode_id" });
      if (upErr) throw upErr;

      await updateEpisodesAfterPromotion(admin, changed.map((r) => r.episode_id));

      for (let i = 0; i < changed.length; i += 150) {
        const slice = changed.slice(i, i + 150).map((r) => r.episode_id);
        const { error } = await admin
          .from("episode_clean_text_candidates")
          .update({ promoted_at: now, quality_status: "promoted", updated_at: now })
          .in("episode_id", slice)
          .eq("quality_status", "passed");
        if (error) throw error;
      }
    }

    if (unchanged.length) {
      const now = new Date().toISOString();
      for (let i = 0; i < unchanged.length; i += 150) {
        const slice = unchanged.slice(i, i + 150).map((r) => r.episode_id);
        const { error } = await admin
          .from("episode_clean_text_candidates")
          .update({ quality_status: "unchanged", updated_at: now })
          .in("episode_id", slice)
          .eq("quality_status", "passed");
        if (error) throw error;
      }
    }

    await admin.from("app_settings").upsert({
      key: "episode_clean_text_candidate_promotion_progress",
      value: {
        last_run_at: new Date().toISOString(),
        runtime_ms: Date.now() - startedAt,
        scanned: rows.length,
        promoted: changed.length,
        unchanged: unchanged.length,
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });

    return json({
      ok: true,
      scanned: rows.length,
      promoted: changed.length,
      unchanged: unchanged.length,
      promoted_episode_ids: changed.map((r) => r.episode_id),
    });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "error" }, 500);
  }
});
