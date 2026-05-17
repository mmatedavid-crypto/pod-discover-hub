// stt-enqueue: enqueues `stt` jobs into ai_enrichment_jobs for HU episodes
// that don't yet have a transcript for the current model.
//
// Reads app_settings.stt_controls. Tier-prioritized (S=100, A=80, B=60, C=40).
// Skips episodes without audio_url. De-dupes by input_hash on the job table.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: any, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const tierPriority = (t: string | null | undefined) => {
  switch (t) {
    case "S": return 100;
    case "A": return 80;
    case "B": return 60;
    case "C": return 40;
    default: return 20;
  }
};

async function sha256Hex(s: string) {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const guard = await checkBackgroundJobsAllowed(admin, "stt-enqueue");
    if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });

    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(2000, Number(body.limit) || 500));

    const { data: ctrlRow } = await admin.from("app_settings").select("value").eq("key", "stt_controls").maybeSingle();
    const ctrl = (ctrlRow?.value || {}) as any;
    if (ctrl.enabled === false && !body.force) return json({ ok: true, paused: true });

    const model = String(body.model || ctrl.model || "google/gemini-2.5-flash");
    const tiers: string[] = Array.isArray(body.tiers) ? body.tiers : (ctrl.tiers || ["S", "A"]);

    // 1. Pull eligible HU podcasts by tier
    const { data: pods } = await admin
      .from("podcasts")
      .select("id, shadow_rank_tier")
      .eq("is_hungarian", true)
      .in("shadow_rank_tier", tiers)
      .eq("rss_status", "active")
      .limit(2000);

    const podIds = (pods || []).map((p: any) => p.id);
    if (!podIds.length) return json({ ok: true, eligible_podcasts: 0, enqueued: 0 });
    const tierByPod: Record<string, string> = {};
    for (const p of pods as any[]) tierByPod[p.id] = p.shadow_rank_tier;

    // 2. Pull eligible episodes (with audio_url) in chunks
    let enqueued = 0;
    let scanned = 0;
    let already_transcribed = 0;
    const CHUNK = 100;
    for (let i = 0; i < podIds.length && enqueued < limit; i += CHUNK) {
      const chunk = podIds.slice(i, i + CHUNK);
      const { data: eps } = await admin
        .from("episodes")
        .select("id, podcast_id, audio_url")
        .in("podcast_id", chunk)
        .not("audio_url", "is", null)
        .order("published_at", { ascending: false })
        .limit(limit - enqueued + 100);
      if (!eps || !eps.length) continue;
      scanned += eps.length;

      // Skip episodes already transcribed with this model
      const epIds = eps.map((e: any) => e.id);
      const { data: existing } = await admin
        .from("episode_transcripts")
        .select("episode_id")
        .in("episode_id", epIds)
        .eq("model", model);
      const haveSet = new Set((existing || []).map((r: any) => r.episode_id));
      already_transcribed += haveSet.size;

      const todo = (eps as any[]).filter(e => !haveSet.has(e.id)).slice(0, limit - enqueued);
      if (!todo.length) continue;

      const rows = [];
      for (const e of todo) {
        const hash = await sha256Hex(`${model}|${e.audio_url}`);
        rows.push({
          kind: "stt",
          target_type: "episode",
          target_id: e.id,
          input_hash: hash,
          priority: tierPriority(tierByPod[e.podcast_id]),
          status: "pending",
          model,
          result: { audio_url: e.audio_url, podcast_id: e.podcast_id },
        });
      }
      if (rows.length) {
        const { error: upErr, count } = await admin
          .from("ai_enrichment_jobs")
          .upsert(rows, { onConflict: "kind,target_type,target_id,input_hash", ignoreDuplicates: true, count: "exact" });
        if (upErr) console.error("upsert err", upErr.message);
        enqueued += count ?? rows.length;
      }
    }

    return json({
      ok: true, model, tiers, scanned, already_transcribed, enqueued,
    });
  } catch (e: any) {
    console.error("stt-enqueue error", e);
    return json({ error: e?.message || "error" }, 500);
  }
});
