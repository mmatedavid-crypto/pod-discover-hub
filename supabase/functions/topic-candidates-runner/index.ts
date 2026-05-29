// Generates candidate episode↔topic pairs from cheap signals (hints + vector + map + search-gap).
// Inserts rows into episode_topic_relevance_reviews with status='needs_review' (or 'rejected' if
// negative-hint hits and no positive evidence). Pre-judge dedupe via source_hash.
//
// Body: { topic_id?: uuid, topic_slug?: string, limit?: number }
//   If neither topic_id nor topic_slug given, iterates priority_topics from app_settings.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { callLovableEmbedding } from "../_shared/lovable-ai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const TIME_BUDGET_MS = 50_000;

async function embed(text: string): Promise<number[] | null> {
  try {
    const res = await callLovableEmbedding({
      model: "google/gemini-embedding-001",
      input: text,
      dimensions: 768,
      job_type: "topic_candidates_embedding",
      target_type: "topic_anchor",
      prompt_version: "topic-candidates-embedding-v2",
      min_input_chars: 20,
    });
    return res.embedding;
  } catch { return null; }
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function anyHit(haystack: string, needles: string[]): boolean {
  if (!needles?.length) return false;
  const h = haystack.toLowerCase();
  return needles.some((n) => n && h.includes(String(n).toLowerCase()));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const t0 = Date.now();
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const guard = await checkBackgroundJobsAllowed(admin, "topic-candidates-runner");
  if (guard.blocked) {
    return new Response(JSON.stringify({ skipped: true, reason: guard.reason }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any = {};
  try { body = await req.json(); } catch {}
  const perTopicLimit: number = Math.min(Number(body.limit) || 300, 600);

  // Resolve topics to process
  let topics: any[] = [];
  if (body.topic_id || body.topic_slug) {
    const q = admin.from("topics").select("id, slug, name, positive_hints, negative_hints");
    const { data } = body.topic_id ? await q.eq("id", body.topic_id).limit(1)
                                   : await q.eq("slug", body.topic_slug).limit(1);
    topics = data || [];
  } else {
    const { data: cfg } = await admin.from("app_settings").select("value").eq("key", "episode_topic_judge_controls").maybeSingle();
    const slugs: string[] = (cfg?.value as any)?.priority_topics || [];
    if (slugs.length) {
      const { data } = await admin.from("topics").select("id, slug, name, positive_hints, negative_hints").in("slug", slugs);
      topics = data || [];
    }
  }

  const report: any[] = [];

  for (const t of topics) {
    if (Date.now() - t0 > TIME_BUDGET_MS) break;
    const candidates = new Map<string, { source: string; text: string }>();

    // (1) positive-hint ILIKE — sample over hints
    const pos: string[] = t.positive_hints || [];
    for (const hint of pos.slice(0, 8)) {
      const { data } = await admin
        .from("episodes")
        .select("id, title, description, ai_summary, search_text, podcast_id, podcasts!inner(is_hungarian, language_decision)")
        .eq("podcasts.is_hungarian", true)
        .eq("podcasts.language_decision", "accept_hungarian")
        .or(`title.ilike.%${hint}%,description.ilike.%${hint}%,ai_summary.ilike.%${hint}%,search_text.ilike.%${hint}%`)
        .limit(40);
      for (const e of (data || [])) {
        const text = `${e.title || ""}\n${e.ai_summary || e.description || ""}`;
        if (!candidates.has(e.id)) candidates.set(e.id, { source: "keyword", text });
      }
      if (candidates.size >= perTopicLimit) break;
    }

    // (2) vector match — HU-gated nearest episodes to topic anchor
    if (candidates.size < perTopicLimit) {
      const anchor = `${t.name} — ${pos.slice(0, 8).join(", ")}`;
      const emb = await embed(anchor);
      if (emb) {
        const { data: matches } = await admin.rpc("match_hu_episodes_by_embedding", {
          query_embedding: emb as any,
          match_count: 80,
          min_similarity: 0.72,
        } as any);
        const matchIds = (matches || []).map((m: any) => m.episode_id);
        if (matchIds.length) {
          const { data: eps } = await admin
            .from("episodes")
            .select("id, title, description, ai_summary, podcast_id")
            .in("id", matchIds);
          for (const e of (eps || [])) {
            const text = `${e.title || ""}\n${e.ai_summary || e.description || ""}`;
            if (!candidates.has(e.id)) candidates.set(e.id, { source: "vector", text });
            if (candidates.size >= perTopicLimit) break;
          }
        }
      }
    }

    // (3) existing episode_topic_map
    {
      const { data } = await admin
        .from("episode_topic_map")
        .select("episode_id, episodes!inner(id, title, description, ai_summary, podcast_id, podcasts!inner(is_hungarian, language_decision))")
        .eq("topic_id", t.id)
        .eq("episodes.podcasts.is_hungarian", true)
        .eq("episodes.podcasts.language_decision", "accept_hungarian")
        .limit(200);
      for (const r of (data || [])) {
        const e: any = (r as any).episodes;
        if (!e) continue;
        const text = `${e.title || ""}\n${e.ai_summary || e.description || ""}`;
        if (!candidates.has(e.id)) candidates.set(e.id, { source: "current_map", text });
      }
    }

    // (4) podcast_topic_map → episodes (last 365d)
    if (candidates.size < perTopicLimit) {
      const { data: pmap } = await admin.from("podcast_topic_map").select("podcast_id").eq("topic_id", t.id).limit(20);
      const pids = (pmap || []).map((r: any) => r.podcast_id).filter(Boolean);
      if (pids.length) {
        const sinceISO = new Date(Date.now() - 365 * 86400_000).toISOString();
        const { data } = await admin
          .from("episodes")
          .select("id, title, description, ai_summary, podcast_id, podcasts!inner(is_hungarian, language_decision)")
          .in("podcast_id", pids)
          .gt("published_at", sinceISO)
          .eq("podcasts.is_hungarian", true)
          .eq("podcasts.language_decision", "accept_hungarian")
          .limit(120);
        for (const e of (data || [])) {
          const text = `${e.title || ""}\n${e.ai_summary || e.description || ""}`;
          if (!candidates.has(e.id)) candidates.set(e.id, { source: "podcast_map", text });
        }
      }
    }

    // Pre-filter & upsert
    const neg: string[] = t.negative_hints || [];
    const rows: any[] = [];
    for (const [episode_id, { source, text }] of candidates) {
      const hasNeg = anyHit(text, neg);
      const hasPos = anyHit(text, pos);
      const source_hash = await sha256(`${episode_id}|${t.id}|${(text || "").slice(0, 500)}`);

      // Negative-only → reject by rule. Positive (or current_map without negative) → needs_review.
      if (hasNeg && !hasPos) {
        rows.push({
          episode_id, topic_id: t.id, candidate_source: source, status: "rejected",
          confidence: 0.2, reason_hu: "Negatív kulcsszó találat, pozitív bizonyíték nélkül.",
          reviewed_by: "rule", source_hash, reviewed_at: new Date().toISOString(),
        });
      } else if (hasPos || source === "current_map") {
        rows.push({
          episode_id, topic_id: t.id, candidate_source: source, status: "needs_review",
          confidence: hasPos ? 0.5 : 0.3, reviewed_by: "rule", source_hash,
        });
      }
    }

    let inserted = 0;
    if (rows.length) {
      // chunked upsert
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        const { error } = await admin.from("episode_topic_relevance_reviews")
          .upsert(chunk, { onConflict: "episode_id,topic_id", ignoreDuplicates: true });
        if (!error) inserted += chunk.length;
      }
    }
    report.push({ topic: t.slug, candidates: candidates.size, inserted_rows: rows.length });
  }

  return new Response(JSON.stringify({ ok: true, runtime_ms: Date.now() - t0, report }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
