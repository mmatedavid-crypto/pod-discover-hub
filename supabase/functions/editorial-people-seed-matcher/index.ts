// editorial-people-seed-matcher: matches admin-curated seed names against
// Hungarian-approved podcast episodes/descriptions, attaches them to people
// (creating new person rows if strong evidence exists), seeds aliases &
// person_episode_mentions, sets editorial_priority/manually_seeded internally.
// No public surface ever reveals that a person was seeded.
//
// POST { seed_slug?: string, seed_id?: string, limit?: number, dry_run?: bool }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

function slugify(s: string): string {
  return normalize(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function escapeIlike(s: string): string {
  return s.replace(/[%_\\]/g, " ");
}

interface Seed {
  id: string; name: string; canonical_name: string | null; aliases: string[];
  context_hints: string[]; priority_level: number; matched_person_id: string | null;
  status: string;
}

interface EpisodeHit {
  episode_id: string;
  podcast_id: string;
  title: string;
  summary_blob: string;
  matched_via: "title" | "ai_summary" | "description" | "search_text" | "people_array";
  context_score: number; // how many context tokens hit
  mention_type: "guest" | "subject" | "mentioned" | "host";
}

async function searchEpisodes(admin: any, seed: Seed, terms: string[]): Promise<EpisodeHit[]> {
  // Search across HU-accepted podcasts only.
  const hits = new Map<string, EpisodeHit>();
  const contextTokens = seed.context_hints.map(normalize);

  for (const term of terms) {
    const v = `%${escapeIlike(term)}%`;
    // Episodes: title / ai_summary / description / search_text / people array
    const { data, error } = await admin
      .from("episodes")
      .select("id, podcast_id, title, ai_summary, summary, description, search_text, people, mentioned, podcasts!inner(is_hungarian, language_decision)")
      .or(`title.ilike.${v},ai_summary.ilike.${v},description.ilike.${v},search_text.ilike.${v}`)
      .eq("podcasts.is_hungarian", true)
      .eq("podcasts.language_decision", "accept_hungarian")
      .limit(300);
    if (error) { console.warn("seed search", term, error.message); continue; }
    for (const e of (data || []) as any[]) {
      const haystack = normalize(`${e.title || ""} ${e.ai_summary || ""} ${e.description || ""} ${e.search_text || ""}`);
      // Re-verify the term actually hits as a near-whole-word, not just substring fragment
      const termN = normalize(term);
      if (!haystack.includes(termN)) continue;

      // Context boost
      let ctxScore = 0;
      for (const ctx of contextTokens) if (ctx && haystack.includes(ctx)) ctxScore++;

      // Decide mention type heuristically
      const titleN = normalize(e.title || "");
      const inPeopleArray = (Array.isArray(e.people) && e.people.some((p: string) => normalize(p).includes(termN)))
                         || (Array.isArray(e.mentioned) && e.mentioned.some((p: string) => normalize(p).includes(termN)));
      let mention_type: EpisodeHit["mention_type"] = "mentioned";
      if (inPeopleArray && titleN.includes(termN)) mention_type = "guest";
      else if (titleN.includes(termN)) mention_type = "subject";
      else if (inPeopleArray) mention_type = "guest";

      let matched_via: EpisodeHit["matched_via"] = "description";
      if (titleN.includes(termN)) matched_via = "title";
      else if (inPeopleArray) matched_via = "people_array";
      else if (normalize(e.ai_summary || "").includes(termN)) matched_via = "ai_summary";
      else if (normalize(e.search_text || "").includes(termN)) matched_via = "search_text";

      const prev = hits.get(e.id);
      const summary_blob = String(e.ai_summary || e.summary || e.description || "").slice(0, 600);
      if (!prev || prev.context_score < ctxScore) {
        hits.set(e.id, {
          episode_id: e.id, podcast_id: e.podcast_id, title: e.title,
          summary_blob, matched_via, context_score: ctxScore, mention_type,
        });
      }
    }
  }
  return Array.from(hits.values());
}

function disambiguate(seed: Seed, hits: EpisodeHit[]): { kept: EpisodeHit[]; reason: string } {
  const nameN = normalize(seed.name);
  // For common-name seeds, require at least 1 context-token hit.
  const requireContext = ["lakatos péter", "hajdu tibor", "pólus enikő", "kasza tibor"].includes(nameN);
  if (!requireContext) return { kept: hits, reason: "no_disambiguation_needed" };
  const kept = hits.filter(h => h.context_score >= 1);
  return { kept, reason: kept.length === hits.length ? "all_pass_context" : "filtered_by_context_tokens" };
}

async function findOrCreatePerson(admin: any, seed: Seed): Promise<{ id: string; created: boolean }> {
  if (seed.matched_person_id) return { id: seed.matched_person_id, created: false };
  const nameN = normalize(seed.name);
  // Try exact normalized_name OR alias.
  const { data: byName } = await admin.from("people").select("id, normalized_name, name").eq("normalized_name", nameN).limit(1);
  if (byName && byName.length) return { id: byName[0].id, created: false };
  const { data: byAlias } = await admin
    .from("person_aliases").select("person_id")
    .in("normalized_alias", seed.aliases.map(normalize))
    .limit(1);
  if (byAlias && byAlias.length) return { id: byAlias[0].person_id, created: false };

  // Create new
  const baseSlug = slugify(seed.name);
  let slug = baseSlug; let attempt = 0;
  while (attempt < 5) {
    const { data: exists } = await admin.from("people").select("id").eq("slug", slug).maybeSingle();
    if (!exists) break;
    attempt++; slug = `${baseSlug}-${attempt + 1}`;
  }
  const ins = await admin.from("people").insert({
    name: seed.canonical_name || seed.name,
    normalized_name: nameN,
    slug,
    manually_seeded: true,           // internal
    editorial_priority: true,        // internal
    editorial_priority_level: seed.priority_level,
    confidence: 0.8,
  }).select("id").single();
  return { id: ins.data!.id as string, created: true };
}

async function upsertAliases(admin: any, personId: string, seed: Seed) {
  const rows = seed.aliases.map(a => ({
    person_id: personId,
    alias: a,
    normalized_alias: normalize(a),
    source: "editorial_seed",
    confidence: 0.9,
  }));
  for (const r of rows) {
    const { data } = await admin.from("person_aliases").select("id").eq("person_id", personId).eq("normalized_alias", r.normalized_alias).maybeSingle();
    if (!data) await admin.from("person_aliases").insert(r);
  }
}

async function attachMentions(admin: any, personId: string, hits: EpisodeHit[]): Promise<number> {
  let n = 0;
  for (const h of hits) {
    const { data: existing } = await admin
      .from("person_episode_mentions")
      .select("id").eq("person_id", personId).eq("episode_id", h.episode_id).maybeSingle();
    if (existing) continue;
    await admin.from("person_episode_mentions").insert({
      person_id: personId,
      episode_id: h.episode_id,
      podcast_id: h.podcast_id,
      mention_type: h.mention_type,
      confidence: 0.6 + Math.min(0.3, h.context_score * 0.1),
      source: `editorial_seed:${h.matched_via}`,
      evidence: h.summary_blob.slice(0, 280),
    });
    // person_podcast_map upsert
    const { data: ppm } = await admin
      .from("person_podcast_map").select("id, episode_count")
      .eq("person_id", personId).eq("podcast_id", h.podcast_id).maybeSingle();
    if (ppm) {
      await admin.from("person_podcast_map")
        .update({ episode_count: (ppm.episode_count || 0) + 1 })
        .eq("id", ppm.id);
    } else {
      await admin.from("person_podcast_map").insert({
        person_id: personId, podcast_id: h.podcast_id, role: h.mention_type, episode_count: 1, confidence: 0.7,
      });
    }
    n++;
  }
  return n;
}

async function processSeed(admin: any, seed: Seed, dryRun: boolean): Promise<any> {
  const terms = Array.from(new Set([seed.name, seed.canonical_name || seed.name, ...seed.aliases].filter(Boolean) as string[]));
  const rawHits = await searchEpisodes(admin, seed, terms);
  const { kept, reason } = disambiguate(seed, rawHits);

  // No evidence at all -> leave seed active, no public page
  if (kept.length === 0) {
    if (!dryRun) {
      await admin.from("editorial_people_seed").update({
        status: rawHits.length > 0 ? "needs_review" : "active",
        evidence: { kept: 0, raw_hits: rawHits.length, disambiguation: reason },
        last_run_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", seed.id);
    }
    return { seed: seed.name, status: "no_evidence", raw_hits: rawHits.length };
  }

  // Weak evidence (1 mention with no context, or ambiguous) -> needs_review
  const strongHits = kept.filter(h => h.context_score >= 1 || h.matched_via === "title" || h.matched_via === "people_array");
  if (strongHits.length < 2 && !kept.some(h => h.matched_via === "people_array")) {
    if (!dryRun) {
      await admin.from("editorial_people_seed").update({
        status: "needs_review",
        evidence: { kept: kept.length, strong: strongHits.length, disambiguation: reason, sample_titles: kept.slice(0, 5).map(h => h.title) },
        last_run_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", seed.id);
    }
    return { seed: seed.name, status: "needs_review", kept: kept.length, strong: strongHits.length };
  }

  if (dryRun) {
    return { seed: seed.name, status: "would_match", kept: kept.length, strong: strongHits.length, sample_titles: kept.slice(0, 5).map(h => h.title) };
  }

  // Attach
  const { id: personId, created } = await findOrCreatePerson(admin, seed);
  await upsertAliases(admin, personId, seed);
  const attached = await attachMentions(admin, personId, strongHits.slice(0, 60));

  // Ensure editorial flags are set on existing person too
  await admin.from("people").update({
    manually_seeded: true,
    editorial_priority: true,
    editorial_priority_level: Math.max(seed.priority_level, 50),
  }).eq("id", personId);

  await admin.from("editorial_people_seed").update({
    matched_person_id: personId,
    status: "resolved",
    evidence: { kept: kept.length, strong: strongHits.length, attached_new: attached, disambiguation: reason, sample_titles: strongHits.slice(0, 5).map(h => h.title) },
    last_run_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", seed.id);

  return { seed: seed.name, status: "resolved", person_id: personId, person_created: created, attached_new_mentions: attached, strong_hits: strongHits.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const body = await req.json().catch(() => ({}));
  const dryRun = !!body.dry_run;

  let q = admin.from("editorial_people_seed").select("*").in("status", ["active", "needs_review"]).order("priority_level", { ascending: false });
  if (body.seed_id) q = q.eq("id", body.seed_id);
  else if (body.seed_slug) q = q.eq("slug", body.seed_slug);
  if (body.limit) q = q.limit(Number(body.limit));

  const { data: seeds, error } = await q;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const results: any[] = [];
  for (const s of (seeds || []) as Seed[]) {
    try {
      results.push(await processSeed(admin, s, dryRun));
    } catch (e: any) {
      results.push({ seed: s.name, error: String(e?.message || e) });
    }
  }

  // Recompute counts/activation after attaching new mentions
  if (!dryRun && results.some(r => r.status === "resolved")) {
    try { await admin.rpc("refresh_person_activation_status"); } catch (e) { console.warn("recompute", e); }
  }

  return new Response(JSON.stringify({ processed: results.length, dry_run: dryRun, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
