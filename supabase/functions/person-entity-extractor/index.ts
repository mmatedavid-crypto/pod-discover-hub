// Person + topic entity extractor.
// Reads HU-approved episodes, uses already-extracted `episodes.people`,
// `episodes.mentioned` and `podcasts.hosts` arrays. Upserts canonical
// `people` rows, aliases, mentions and podcast roles. Also maps episodes
// and podcasts to seeded `topics` using `topic_aliases` keyword match.
// No AI calls — pure DB pass. Safe to run on cron.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

import { slugify as sharedSlugify } from "../_shared/slug.ts";
// normalize() is kept as the comparison key for existing `people.normalized_name`
// rows — changing it would re-bucket the entire people table. The slugify path
// now uses the central HU-safe helper so new person slugs match site-wide rules.
function normalize(s: string): string {
  return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}
function slugify(s: string): string {
  return sharedSlugify(s, "person");
}
function isLikelyFullName(name: string): boolean {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return false;
  if (parts.some(p => p.length < 2)) return false;
  return true;
}
function roleTypeForMention(mentionType: string): string {
  if (["host", "guest", "interviewee", "speaker"].includes(mentionType)) return "participant";
  if (mentionType === "subject") return "subject";
  return "mention";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const body = await req.json().catch(() => ({}));
  const limit = Math.min(Math.max(Number(body.limit) || 5000, 100), 20000);

  const { data: runRow } = await supabase
    .from("entity_extraction_runs")
    .insert({ run_type: "mixed", status: "running" })
    .select("id").single();
  const runId = (runRow as any)?.id;

  let scanned = 0, peopleCreated = 0, peopleUpdated = 0, topicMaps = 0;
  const errors: string[] = [];

  try {
    // ---------- Load topic aliases once ----------
    const { data: aliasRows } = await supabase
      .from("topic_aliases")
      .select("topic_id, normalized_alias, weight");
    const aliasMap = new Map<string, { topic_id: string; weight: number }[]>();
    (aliasRows || []).forEach((a: any) => {
      const arr = aliasMap.get(a.normalized_alias) || [];
      arr.push({ topic_id: a.topic_id, weight: a.weight });
      aliasMap.set(a.normalized_alias, arr);
    });

    // Cache existing people
    const { data: existing } = await supabase.from("people").select("id, slug, normalized_name");
    const peopleBySlug = new Map<string, string>();
    const peopleByNorm = new Map<string, string>();
    (existing || []).forEach((p: any) => {
      peopleBySlug.set(p.slug, p.id);
      peopleByNorm.set(p.normalized_name, p.id);
    });

    // Mention accumulator: person_id -> { episodes: Map<ep, {type,confidence,source,podcast_id,published_at}>, podcasts: Map<pod, {role, count, latest}> }
    const personAgg = new Map<string, {
      name: string;
      slug: string;
      norm: string;
      mentions: {
        episode_id: string;
        podcast_id: string;
        mention_type: string;
        confidence: number;
        source: string;
        evidence?: string | null;
        source_evidence?: Record<string, unknown>;
      }[];
      podcastRoles: Map<string, { role: string; count: number; latest: string | null; confidence: number }>;
      maxConfidence: number;
      latest: string | null;
    }>();

    function getOrCreatePerson(name: string): string | null {
      const cleaned = name.trim();
      if (!cleaned) return null;
      const norm = normalize(cleaned);
      if (norm.length < 3) return null;
      // Reject single first names / single tokens unless from hosts list
      if (!isLikelyFullName(cleaned)) return null;
      const slug = slugify(cleaned);
      if (!slug) return null;
      const existingId = peopleByNorm.get(norm) || peopleBySlug.get(slug);
      const id = existingId || crypto.randomUUID();
      if (!existingId) {
        peopleByNorm.set(norm, id);
        peopleBySlug.set(slug, id);
      }
      if (!personAgg.has(id)) {
        personAgg.set(id, {
          name: cleaned, slug, norm,
          mentions: [], podcastRoles: new Map(),
          maxConfidence: 0, latest: null,
        });
      }
      return id;
    }

    // ---------- Episode pull, paged ----------
    const PAGE = 500;
    let from = 0;
    const episodeTopicRows: { episode_id: string; topic_id: string; confidence: number; source: string }[] = [];
    const podcastTopicTally = new Map<string, Map<string, { count: number; maxConf: number }>>(); // pod -> topic -> stats

    while (scanned < limit) {
      const { data: eps, error } = await supabase
        .from("episodes")
        .select("id, podcast_id, title, ai_summary, description, people, mentioned, topics, entity_extraction_evidence, published_at, podcasts!inner(id, language, is_hungarian, language_decision, hosts, title)")
        .eq("podcasts.is_hungarian", true)
        .eq("podcasts.language_decision", "accept_hungarian")
        .order("published_at", { ascending: false, nullsFirst: false })
        .range(from, from + PAGE - 1);
      if (error) { errors.push(error.message); break; }
      if (!eps || eps.length === 0) break;

      for (const e of eps as any[]) {
        scanned++;
        const pod = e.podcasts;
        if (!pod) continue;
        const hosts: string[] = pod.hosts || [];
        const hostSet = new Set(hosts.map(normalize));
        const titleNorm = normalize(e.title || "");
        const descNorm = normalize([e.ai_summary, e.description].filter(Boolean).join(" "));
        const allText = titleNorm + " " + descNorm;

        // -------- People --------
        // Hosts: high confidence per podcast (mark as host on every episode of this pod)
        for (const h of hosts) {
          const pid = getOrCreatePerson(h);
          if (!pid) continue;
          const agg = personAgg.get(pid)!;
          agg.maxConfidence = Math.max(agg.maxConfidence, 0.95);
          if (e.published_at && (!agg.latest || e.published_at > agg.latest)) agg.latest = e.published_at;
          agg.mentions.push({ episode_id: e.id, podcast_id: pod.id, mention_type: "host", confidence: 0.95, source: "rss_author" });
          const cur = agg.podcastRoles.get(pod.id) || { role: "host", count: 0, latest: null, confidence: 0.95 };
          cur.count++;
          if (e.published_at && (!cur.latest || e.published_at > cur.latest)) cur.latest = e.published_at;
          agg.podcastRoles.set(pod.id, cur);
        }

        const evidencePeople = Array.isArray(e.entity_extraction_evidence?.person_mentions)
          ? e.entity_extraction_evidence.person_mentions
          : [];
        const evidenceSpeakers = evidencePeople
          .filter((p: any) => p?.role === "speaker")
          .map((p: any) => p.name);
        const evidenceMentioned = evidencePeople
          .filter((p: any) => p?.role !== "speaker")
          .map((p: any) => p.name);

        // Guests / speakers: prefer v5 evidence-backed mentions, fall back to legacy episodes.people.
        for (const p of (evidenceSpeakers.length ? evidenceSpeakers : (e.people || []))) {
          if (hostSet.has(normalize(p))) continue;
          const pid = getOrCreatePerson(p);
          if (!pid) continue;
          const inTitle = titleNorm.includes(normalize(p));
          const evidence = evidencePeople.find((x: any) => normalize(x?.name || "") === normalize(p));
          const conf = Math.max(Number(evidence?.confidence || 0), inTitle ? 0.9 : 0.8);
          const agg = personAgg.get(pid)!;
          agg.maxConfidence = Math.max(agg.maxConfidence, conf);
          if (e.published_at && (!agg.latest || e.published_at > agg.latest)) agg.latest = e.published_at;
          agg.mentions.push({
            episode_id: e.id,
            podcast_id: pod.id,
            mention_type: "guest",
            confidence: conf,
            source: evidence?.source || (inTitle ? "title" : "ai_summary"),
            evidence: evidence?.evidence || null,
            source_evidence: evidence ? { extraction_version: 5, evidence: evidence.evidence, role: evidence.role } : {},
          } as any);
          const cur = agg.podcastRoles.get(pod.id) || { role: "recurring_guest", count: 0, latest: null, confidence: conf };
          cur.count++;
          if (e.published_at && (!cur.latest || e.published_at > cur.latest)) cur.latest = e.published_at;
          agg.podcastRoles.set(pod.id, cur);
        }

        // Mentioned (talked about, not speaking): prefer v5 evidence-backed mentions.
        for (const m of (evidenceMentioned.length ? evidenceMentioned : (e.mentioned || []))) {
          if (hostSet.has(normalize(m))) continue;
          const pid = getOrCreatePerson(m);
          if (!pid) continue;
          const evidence = evidencePeople.find((x: any) => normalize(x?.name || "") === normalize(m));
          const conf = Math.max(Number(evidence?.confidence || 0), evidence ? 0.72 : 0.7);
          const agg = personAgg.get(pid)!;
          agg.maxConfidence = Math.max(agg.maxConfidence, conf);
          if (e.published_at && (!agg.latest || e.published_at > agg.latest)) agg.latest = e.published_at;
          const mentionType = evidence?.role === "subject" ? "subject" : "mentioned";
          agg.mentions.push({
            episode_id: e.id,
            podcast_id: pod.id,
            mention_type: mentionType,
            confidence: conf,
            source: evidence?.source || "ai_summary",
            evidence: evidence?.evidence || null,
            source_evidence: evidence ? { extraction_version: 5, evidence: evidence.evidence, role: evidence.role } : {},
          } as any);
          const cur = agg.podcastRoles.get(pod.id) || { role: "frequent_subject", count: 0, latest: null, confidence: conf };
          cur.count++;
          if (e.published_at && (!cur.latest || e.published_at > cur.latest)) cur.latest = e.published_at;
          agg.podcastRoles.set(pod.id, cur);
        }

        // -------- Topics: AI-supplied topics + alias hits in title --------
        const matchedTopics = new Map<string, { confidence: number; source: string }>();
        // From AI-extracted topics array
        for (const t of (e.topics || [])) {
          const cands = aliasMap.get(normalize(t));
          if (!cands) continue;
          for (const c of cands) {
            const conf = 0.75 + Math.min(0.2, c.weight * 0.05);
            const cur = matchedTopics.get(c.topic_id);
            if (!cur || cur.confidence < conf) matchedTopics.set(c.topic_id, { confidence: conf, source: "ai_topic" });
          }
        }
        // Title direct match (strongest)
        for (const [alias, cands] of aliasMap) {
          if (alias.length < 4) continue;
          if (titleNorm.includes(alias)) {
            for (const c of cands) {
              const conf = 0.85;
              const cur = matchedTopics.get(c.topic_id);
              if (!cur || cur.confidence < conf) matchedTopics.set(c.topic_id, { confidence: conf, source: "title_match" });
            }
          }
        }
        // Cap to top 5 specific topics per episode
        const ranked = [...matchedTopics.entries()].sort((a, b) => b[1].confidence - a[1].confidence).slice(0, 5);
        for (const [topic_id, info] of ranked) {
          episodeTopicRows.push({ episode_id: e.id, topic_id, confidence: info.confidence, source: info.source });
          // Tally for podcast-level
          const pmap = podcastTopicTally.get(pod.id) || new Map();
          const cur = pmap.get(topic_id) || { count: 0, maxConf: 0 };
          cur.count++;
          cur.maxConf = Math.max(cur.maxConf, info.confidence);
          pmap.set(topic_id, cur);
          podcastTopicTally.set(pod.id, pmap);
        }
      }
      if (eps.length < PAGE) break;
      from += PAGE;
    }

    // ---------- Persist people ----------
    const peopleRows: any[] = [];
    const aliasRowsToInsert: any[] = [];
    const mentionRows: any[] = [];
    const podcastRoleRows: any[] = [];

    for (const [pid, agg] of personAgg) {
      // Threshold: must have at least 1 ep mention to upsert
      if (agg.mentions.length === 0) continue;
      const epCount = new Set(agg.mentions.map(m => m.episode_id)).size;
      const podCount = agg.podcastRoles.size;
      const isHost = [...agg.podcastRoles.values()].some(r => r.role === "host");
      const inTitleAsGuest = agg.mentions.some(m => m.mention_type === "guest" && m.source === "title");
      // Public threshold per spec
      const meetsPublic = agg.maxConfidence >= 0.75 && (epCount >= 2 || isHost || inTitleAsGuest);
      // Indexable threshold
      const meetsIndex = epCount >= 2 || isHost;
      peopleRows.push({
        id: pid,
        name: agg.name,
        slug: agg.slug,
        normalized_name: agg.norm,
        is_public: meetsPublic,
        is_indexable: meetsPublic && meetsIndex,
        confidence: agg.maxConfidence,
        episode_count: epCount,
        podcast_count: podCount,
        latest_episode_at: agg.latest,
      });
      aliasRowsToInsert.push({ person_id: pid, alias: agg.name, normalized_alias: agg.norm, source: "episode_extraction", confidence: agg.maxConfidence });
      for (const m of agg.mentions as any[]) {
        mentionRows.push({
          person_id: pid,
          ...m,
          evidence: m.evidence || null,
          role_type: roleTypeForMention(m.mention_type),
          role_confidence: m.confidence,
          source_evidence: m.source_evidence || {},
        });
      }
      for (const [pod_id, r] of agg.podcastRoles) {
        podcastRoleRows.push({ person_id: pid, podcast_id: pod_id, role: r.role, confidence: r.confidence, episode_count: r.count, latest_episode_at: r.latest });
      }
    }

    // Chunked upserts
    async function chunkUpsert(table: string, rows: any[], onConflict?: string, chunkSize = 500) {
      let inserted = 0, updated = 0;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const q = supabase.from(table).upsert(chunk, onConflict ? { onConflict, ignoreDuplicates: false } : undefined);
        const { error } = await q;
        if (error) errors.push(`${table}: ${error.message}`);
        else inserted += chunk.length;
      }
      return { inserted, updated };
    }

    const peopleResult = await chunkUpsert("people", peopleRows, "id");
    peopleCreated = peopleResult.inserted;
    await chunkUpsert("person_aliases", aliasRowsToInsert, "person_id,normalized_alias");
    await chunkUpsert("person_episode_mentions", mentionRows, "person_id,episode_id,mention_type");
    await chunkUpsert("person_podcast_map", podcastRoleRows, "person_id,podcast_id,role");

    // ---------- Persist topic maps ----------
    await chunkUpsert("episode_topic_map", episodeTopicRows, "episode_id,topic_id");
    topicMaps += episodeTopicRows.length;

    const podcastTopicRows: any[] = [];
    for (const [pod_id, tally] of podcastTopicTally) {
      // Cap 8 per podcast, ranked by count*confidence
      const ranked = [...tally.entries()]
        .map(([topic_id, s]) => ({ topic_id, score: s.count * s.maxConf, conf: s.maxConf }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 8);
      for (const r of ranked) {
        podcastTopicRows.push({ podcast_id: pod_id, topic_id: r.topic_id, confidence: r.conf, source: "aggregated" });
      }
    }
    await chunkUpsert("podcast_topic_map", podcastTopicRows, "podcast_id,topic_id");

    // ---------- Refresh topic counters via direct SQL ----------
    try {
      // Recompute episode_count and podcast_count per topic from mapping tables, HU-gated.
      const { data: topicIds } = await supabase.from("topics").select("id");
      for (const t of (topicIds || []) as any[]) {
        const { count: epCount } = await supabase
          .from("episode_topic_map")
          .select("episode_id, episodes!inner(podcast_id, podcasts!inner(is_hungarian, language_decision))", { count: "exact", head: true })
          .eq("topic_id", t.id)
          .eq("episodes.podcasts.is_hungarian", true)
          .eq("episodes.podcasts.language_decision", "accept_hungarian");
        const { count: podCount } = await supabase
          .from("podcast_topic_map")
          .select("podcast_id, podcasts!inner(is_hungarian, language_decision)", { count: "exact", head: true })
          .eq("topic_id", t.id)
          .eq("podcasts.is_hungarian", true)
          .eq("podcasts.language_decision", "accept_hungarian");
        const indexable = (podCount || 0) >= 5 || (epCount || 0) >= 15;
        await supabase.from("topics").update({
          episode_count: epCount || 0,
          podcast_count: podCount || 0,
          is_indexable: indexable,
          updated_at: new Date().toISOString(),
        }).eq("id", t.id);
      }
    } catch (e) {
      errors.push(`topic_count_refresh: ${e instanceof Error ? e.message : String(e)}`);
    }

    await supabase.from("entity_extraction_runs").update({
      status: errors.length ? "failed" : "completed",
      scanned_episode_count: scanned,
      extracted_person_count: personAgg.size,
      created_person_count: peopleCreated,
      updated_person_count: peopleUpdated,
      error_message: errors.slice(0, 5).join(" | ") || null,
      finished_at: new Date().toISOString(),
    }).eq("id", runId);

    return new Response(JSON.stringify({
      ok: true, runId, scanned, peopleAggregated: personAgg.size, peopleRows: peopleRows.length,
      mentions: mentionRows.length, podcastRoles: podcastRoleRows.length,
      episodeTopicMaps: episodeTopicRows.length, podcastTopicMaps: podcastTopicRows.length,
      errors,
    }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase.from("entity_extraction_runs").update({
      status: "failed", error_message: msg, finished_at: new Date().toISOString(),
    }).eq("id", runId);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
