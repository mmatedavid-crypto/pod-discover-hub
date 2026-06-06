// Personalized "Neked válogatva" recommendations for logged-in users.
// Reads the user's taste_vec from profiles, calls match_user_episodes RPC,
// hydrates episode + podcast metadata, and returns a diversified 12-item shelf.
//
// Fallback/backfill: recent HU episodes ranked by archetype topic overlap,
// with explicit guards against one podcast or news bulletins taking over.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

type EpisodeRow = {
  id: string;
  podcast_id: string;
  title: string;
  display_title: string | null;
  slug: string;
  image_url: string | null;
  published_at: string | null;
  topics?: string[] | null;
};

type PodcastRow = {
  id: string;
  slug: string;
  title: string;
  display_title: string | null;
  image_url: string | null;
  category?: string | null;
  rank_label?: string | null;
};

type HydratedEpisode = {
  id: string;
  slug: string;
  title: string;
  image_url: string | null;
  published_at: string | null;
  topics: string[];
  podcast: {
    id: string;
    slug: string;
    title: string;
    image_url: string | null;
    category: string | null;
    rank_label: string | null;
  } | null;
};

const FINAL_LIMIT = 12;
const PERSONALIZED_CANDIDATE_LIMIT = 80;
const FALLBACK_CANDIDATE_LIMIT = 180;
const PERSONALIZED_FRESHNESS_DAYS = 180;

const NEWS_LIKE_RX = /\b(hírek|hír|hírösszefoglaló|hírháttér|hírpercek|krónika|infostart|napi hírek|reggeli hírek|esti hírek|friss hírek|news|bulletin)\b/i;
const BULLETIN_LIKE_RX = /\b(hírek röviden|röviden|hírpercek|hírgyors|napi hírek|friss hírek|reggeli hírek|déli hírek|esti hírek|éjszakai hírek|hírösszefoglaló|infostart hírek|percben|perces hír|bulletin)\b/i;
const INTEREST_GROUPS: Record<string, string[]> = {
  tech: ["tech", "technológia", "technologia", "mi", "ai", "mesterséges intelligencia", "startup", "jövő", "jovo", "digitális", "digitalis"],
  business: ["gazdaság", "gazdasag", "pénz", "penz", "pénzügy", "penzugy", "üzlet", "uzlet", "business", "befektetés", "befektetes", "tőzsde", "tozsde", "vállalkozás", "vallalkozas", "karrier"],
  public_affairs: ["közélet", "kozelet", "politika", "hírek", "hirek", "társadalom", "tarsadalom", "geopolitika", "közbeszéd", "kozbeszed"],
  culture: ["kultúra", "kultura", "film", "mozi", "sorozat", "zene", "könyv", "konyv", "irodalom", "színház", "szinhaz"],
  science: ["tudomány", "tudomany", "űr", "ur", "kutatás", "kutatas", "természet", "termeszet"],
  mind: ["pszichológia", "pszichologia", "mentális", "mentalis", "önismeret", "onismeret", "lélek", "lelek"],
  health: ["egészség", "egeszseg", "életmód", "eletmod", "orvos", "sport", "edzés", "edzes"],
  crime: ["bűnügy", "bunugy", "true crime", "krimi", "nyomozás", "nyomozas"],
  travel: ["utazás", "utazas", "világ", "vilag", "külföld", "kulfold"],
  food: ["gasztronómia", "gasztronomia", "kaja", "étel", "etel", "főzés", "fozes"],
  humor: ["humor", "standup", "stand-up", "szórakozás", "szorakozas"],
};

function normalizeInterest(value: string | null | undefined): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function interestGroupsForText(value: string | null | undefined): string[] {
  const text = normalizeInterest(value);
  if (!text) return [];
  const groups: string[] = [];
  for (const [group, terms] of Object.entries(INTEREST_GROUPS)) {
    if (terms.some((term) => text.includes(normalizeInterest(term)))) groups.push(group);
  }
  return groups;
}

function expandTasteTags(tags: string[]): Set<string> {
  const out = new Set<string>();
  for (const tag of tags) {
    const normalized = normalizeInterest(tag);
    if (!normalized || normalized.length < 3) continue;
    out.add(normalized);
    for (const group of interestGroupsForText(normalized)) {
      out.add(group);
      for (const term of INTEREST_GROUPS[group] || []) out.add(normalizeInterest(term));
    }
  }
  return out;
}

function episodeInterestKeys(input: { title?: string | null; podcastTitle?: string | null; category?: string | null; topics?: string[] | null }): Set<string> {
  const values = [
    input.title || "",
    input.podcastTitle || "",
    input.category || "",
    ...(input.topics || []),
  ];
  const keys = new Set<string>();
  for (const value of values) {
    const normalized = normalizeInterest(value);
    if (normalized.length >= 3) keys.add(normalized);
    for (const group of interestGroupsForText(value)) keys.add(group);
  }
  return keys;
}

function isBulletinLike(input: { title?: string | null; podcastTitle?: string | null }): boolean {
  const hay = `${input.title || ""} ${input.podcastTitle || ""}`.toLowerCase();
  return BULLETIN_LIKE_RX.test(hay) || /^\s*\d{1,2}\s*[-–—]\s+/.test(input.title || "");
}

function isNewsLike(input: { title?: string | null; podcastTitle?: string | null }): boolean {
  const hay = `${input.title || ""} ${input.podcastTitle || ""}`.toLowerCase();
  return isBulletinLike(input) || NEWS_LIKE_RX.test(hay);
}

function newsSignalFromTopics(likedTopics: string[]): number {
  const expanded = expandTasteTags(likedTopics);
  let signal = 0;
  for (const key of ["public_affairs", "kozelet", "közélet", "politika", "hirek", "hírek", "geopolitika"]) {
    if (expanded.has(normalizeInterest(key))) signal += 1;
  }
  return signal;
}

function newsPolicyForTopics(likedTopics: string[]): { allowNews: boolean; allowBulletins: boolean } {
  const signal = newsSignalFromTopics(likedTopics);
  return {
    allowNews: signal >= 3,
    allowBulletins: signal >= 5,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "unauthorized" }, 401);
    }

    // Identify user with their JWT
    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "unauthorized" }, 401);
    const userId = userData.user.id;

    const admin = createClient(url, service);

    // Load profile (taste vector status + archetype)
    const { data: profileBefore } = await admin
      .from("profiles")
      .select("taste_vec, taste_vec_updated_at, taste_signal_count, archetype_slug, archetype_result")
      .eq("user_id", userId)
      .maybeSingle();

    const signalCount = profileBefore?.taste_signal_count ?? 0;
    const vecAge = profileBefore?.taste_vec_updated_at
      ? Date.now() - new Date(profileBefore.taste_vec_updated_at as string).getTime()
      : Number.POSITIVE_INFINITY;
    const needsRefresh = signalCount > 0 && (!profileBefore?.taste_vec || vecAge > 5 * 60_000);
    if (needsRefresh) {
      const { error: refErr } = await admin.rpc("refresh_user_taste_vec", { p_user: userId });
      if (refErr) console.error("refresh_user_taste_vec error", refErr);
    }

    // Re-read taste_vec presence after potential refresh.
    const { data: profile } = await admin
      .from("profiles")
      .select("taste_vec, taste_signal_count, archetype_slug, archetype_result")
      .eq("user_id", userId)
      .maybeSingle();

    const hasVector = !!profile?.taste_vec;
    const likedTopics: string[] = extractLikedTopics(profile?.archetype_result);

    let episodeIds: string[] = [];
    let mode: "personalized" | "archetype" | "fresh" = "fresh";
    let personalizedCandidateCount = 0;

    if (hasVector) {
      const { data: matches, error: matchErr } = await admin.rpc("match_user_episodes", {
        p_user: userId,
        p_limit: PERSONALIZED_CANDIDATE_LIMIT,
        p_freshness_days: PERSONALIZED_FRESHNESS_DAYS,
      });
      if (matchErr) console.error("match_user_episodes error", matchErr);
      if (matches && matches.length > 0) {
        personalizedCandidateCount = matches.length;
        episodeIds = matches.map((m: { episode_id: string }) => m.episode_id);
        mode = "personalized";
      }
    }

    if (episodeIds.length === 0) {
      episodeIds = await loadBackfillEpisodeIds(admin, userId, likedTopics, new Set(), PERSONALIZED_CANDIDATE_LIMIT);
      mode = likedTopics.length > 0 ? "archetype" : "fresh";
    }

    if (episodeIds.length === 0) {
      return json({ episodes: [], mode, signal_count: signalCount });
    }

    const hydrated = await hydrateEpisodes(admin, episodeIds);
    const ranked = rankHydratedForTaste(hydrated, likedTopics);
    const newsPolicy = newsPolicyForTopics(likedTopics);
    let ordered = diversifyRecommendations(ranked, FINAL_LIMIT, newsPolicy);
    let backfilledCount = 0;

    if (ordered.length < FINAL_LIMIT) {
      const exclude = new Set<string>([
        ...episodeIds,
        ...ordered.map((e) => e.id),
      ]);
      const backfillIds = await loadBackfillEpisodeIds(
        admin,
        userId,
        likedTopics,
        exclude,
        FALLBACK_CANDIDATE_LIMIT,
      );
      backfilledCount = backfillIds.length;
      const backfilled = await hydrateEpisodes(admin, backfillIds);
      ordered = diversifyRecommendations(
        rankHydratedForTaste([...ordered, ...backfilled], likedTopics),
        FINAL_LIMIT,
        newsPolicy,
      );
    }

    return json({
      episodes: ordered.slice(0, FINAL_LIMIT),
      mode,
      signal_count: signalCount,
      guard: {
        personalized_candidates: personalizedCandidateCount,
        hydrated_candidates: hydrated.length,
        backfilled_candidates: backfilledCount,
        returned: Math.min(ordered.length, FINAL_LIMIT),
      },
    });
  } catch (e) {
    console.error("taste-recommend error", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

async function hydrateEpisodes(admin: ReturnType<typeof createClient>, episodeIds: string[]): Promise<HydratedEpisode[]> {
  const ids = Array.from(new Set(episodeIds)).filter(Boolean);
  if (ids.length === 0) return [];

  const { data: episodes, error: epErr } = await admin
    .from("episodes")
    .select("id, podcast_id, title, display_title, slug, image_url, published_at, topics")
    .in("id", ids);
  if (epErr) {
    console.error("hydrate episodes error", epErr);
    return [];
  }

  const podcastIds = Array.from(new Set((episodes ?? []).map((e) => e.podcast_id).filter(Boolean)));
  const { data: podcasts, error: podErr } = await admin
    .from("podcasts")
    .select("id, slug, title, display_title, image_url, category, rank_label")
    .in("id", podcastIds);
  if (podErr) console.error("hydrate podcasts error", podErr);

  const podById = new Map<string, PodcastRow>((podcasts ?? []).map((p) => [p.id, p as PodcastRow]));
  const epById = new Map<string, EpisodeRow>(
    (episodes ?? []).map((e) => [e.id, e as EpisodeRow]),
  );

  return ids
    .map((id) => epById.get(id))
    .filter((e): e is EpisodeRow => !!e)
    .map((e) => {
      const p = podById.get(e.podcast_id);
      return {
        id: e.id,
        slug: e.slug,
        title: e.display_title || e.title,
        image_url: e.image_url,
        published_at: e.published_at,
        topics: Array.isArray(e.topics) ? e.topics.filter((t): t is string => typeof t === "string") : [],
        podcast: p
          ? {
              id: p.id,
              slug: p.slug,
              title: p.display_title || p.title,
              image_url: p.image_url,
              category: p.category ?? null,
              rank_label: p.rank_label ?? null,
            }
          : null,
      };
    });
}

function diversifyRecommendations(
  rows: HydratedEpisode[],
  limit: number,
  newsPolicy: { allowNews: boolean; allowBulletins: boolean },
): HydratedEpisode[] {
  const strict = pickDiverse(rows, limit, {
    maxPerPodcast: 1,
    maxPerCategory: 4,
    maxNews: newsPolicy.allowNews ? 2 : 0,
    maxBulletin: newsPolicy.allowBulletins ? 1 : 0,
  });
  if (strict.length >= limit) return strict;

  return pickDiverse(rows, limit, {
    maxPerPodcast: 2,
    maxPerCategory: 5,
    maxNews: newsPolicy.allowNews ? 3 : 0,
    maxBulletin: newsPolicy.allowBulletins ? 1 : 0,
  });
}

function rankHydratedForTaste(rows: HydratedEpisode[], likedTopics: string[]): HydratedEpisode[] {
  const expandedLikedTopics = expandTasteTags(likedTopics);
  if (expandedLikedTopics.size === 0) return rows;

  return rows
    .map((row, index) => {
      const title = row.title;
      const podcastTitle = row.podcast?.title || "";
      const category = row.podcast?.category || null;
      const interestKeys = episodeInterestKeys({ title, podcastTitle, category, topics: row.topics });
      let topicOverlap = 0;
      for (const key of interestKeys) {
        if (expandedLikedTopics.has(key)) topicOverlap += 1;
      }
      const rankScore = rankWeight(row.podcast?.rank_label);
      const bulletinPenalty = isBulletinLike({ title, podcastTitle }) ? -10 : 0;
      const newsPenalty = isNewsLike({ title, podcastTitle }) ? -4 : 0;
      const noEvidencePenalty = topicOverlap === 0 ? -5 : 0;
      const recencyScore = row.published_at
        ? Math.max(0, 3 - (Date.now() - new Date(row.published_at).getTime()) / (45 * 86400_000))
        : 0;
      const vectorOrderScore = Math.max(0, 4 - index / 12);
      return {
        row,
        score: topicOverlap * 14 + rankScore + recencyScore + vectorOrderScore + bulletinPenalty + newsPenalty + noEvidencePenalty,
      };
    })
    .sort((a, b) => b.score - a.score)
    .map((item) => item.row);
}

function pickDiverse(
  rows: HydratedEpisode[],
  limit: number,
  caps: { maxPerPodcast: number; maxPerCategory: number; maxNews: number; maxBulletin: number },
): HydratedEpisode[] {
  const out: HydratedEpisode[] = [];
  const seen = new Set<string>();
  const perPodcast = new Map<string, number>();
  const perCategory = new Map<string, number>();
  let newsCount = 0;
  let bulletinCount = 0;

  for (const row of rows) {
    if (seen.has(row.id)) continue;
    const podcastTitle = row.podcast?.title;
    const bulletin = isBulletinLike({ title: row.title, podcastTitle });
    const news = isNewsLike({ title: row.title, podcastTitle });
    if (bulletin && bulletinCount >= caps.maxBulletin) continue;
    if (news && newsCount >= caps.maxNews) continue;

    const podcastKey = row.podcast?.id || row.podcast?.slug || row.id;
    const podcastCount = perPodcast.get(podcastKey) ?? 0;
    if (podcastCount >= caps.maxPerPodcast) continue;

    const categoryKey = normalizeCategory(row.podcast?.category);
    const categoryCount = categoryKey ? perCategory.get(categoryKey) ?? 0 : 0;
    if (categoryKey && categoryCount >= caps.maxPerCategory) continue;

    seen.add(row.id);
    perPodcast.set(podcastKey, podcastCount + 1);
    if (categoryKey) perCategory.set(categoryKey, categoryCount + 1);
    if (bulletin) bulletinCount++;
    if (news) newsCount++;
    out.push(row);
    if (out.length >= limit) break;
  }

  return out;
}

async function loadBackfillEpisodeIds(
  admin: ReturnType<typeof createClient>,
  userId: string,
  likedTopics: string[],
  exclude: Set<string>,
  limit: number,
): Promise<string[]> {
  const { data: seenRows } = await admin
    .from("user_episode_interactions")
    .select("episode_id")
    .eq("user_id", userId)
    .gt("created_at", new Date(Date.now() - 60 * 86400_000).toISOString());
  const seen = new Set((seenRows ?? []).map((r) => r.episode_id));

  const { data, error } = await admin
    .from("episodes")
    .select("id, podcast_id, title, display_title, topics, published_at, podcasts!inner(language, language_decision, rank_label, category, title, display_title)")
    .eq("podcasts.language_decision", "accept_hungarian")
    .not("published_at", "is", null)
    .gt("published_at", new Date(Date.now() - 120 * 86400_000).toISOString())
    .order("published_at", { ascending: false })
    .limit(Math.max(limit, 80));

  if (error) {
    console.error("taste backfill query error", error);
    return [];
  }

  const expandedLikedTopics = expandTasteTags(likedTopics);
  const newsPolicy = newsPolicyForTopics(likedTopics);
  const scored = (data ?? [])
    .filter((r) => !seen.has(r.id) && !exclude.has(r.id))
    .map((r) => {
      const topics: string[] = Array.isArray(r.topics)
        ? r.topics.filter((t): t is string => typeof t === "string")
        : [];
      const podcast = Array.isArray(r.podcasts) ? r.podcasts[0] : r.podcasts;
      const title = r.display_title || r.title;
      const podcastTitle = podcast?.display_title || podcast?.title || "";
      const category = podcast?.category || null;
      const interestKeys = episodeInterestKeys({ title, podcastTitle, category, topics });
      let topicOverlap = 0;
      for (const key of interestKeys) {
        if (expandedLikedTopics.has(key)) topicOverlap += 1;
      }
      const rankScore = rankWeight(podcast?.rank_label);
      const bulletinPenalty = isBulletinLike({ title, podcastTitle }) ? (newsPolicy.allowBulletins ? -8 : -40) : 0;
      const newsPenalty = isNewsLike({ title, podcastTitle }) ? (newsPolicy.allowNews ? -3 : -18) : 0;
      const recencyScore = r.published_at
        ? Math.max(0, 4 - (Date.now() - new Date(r.published_at).getTime()) / (30 * 86400_000))
        : 0;
      return {
        id: r.id,
        podcast_id: r.podcast_id,
        score: topicOverlap * 12 + rankScore + recencyScore + bulletinPenalty + newsPenalty,
      };
    })
    .sort((a, b) => b.score - a.score);

  const picked: string[] = [];
  const perPodcast = new Map<string, number>();
  for (const row of scored) {
    const count = perPodcast.get(row.podcast_id) ?? 0;
    if (count >= 1) continue;
    perPodcast.set(row.podcast_id, count + 1);
    picked.push(row.id);
    if (picked.length >= limit) break;
  }

  if (picked.length >= FINAL_LIMIT) return picked;

  for (const row of scored) {
    if (picked.includes(row.id)) continue;
    const count = perPodcast.get(row.podcast_id) ?? 0;
    if (count >= 2) continue;
    perPodcast.set(row.podcast_id, count + 1);
    picked.push(row.id);
    if (picked.length >= limit) break;
  }

  return picked;
}

function normalizeCategory(category?: string | null): string | null {
  return category ? category.trim().toLowerCase() : null;
}

function rankWeight(rank?: string | null): number {
  switch ((rank || "").toUpperCase()) {
    case "S":
      return 8;
    case "A":
      return 6;
    case "B":
      return 4;
    case "C":
      return 2;
    default:
      return 0;
  }
}

function extractLikedTopics(archetypeResult: unknown): string[] {
  if (!archetypeResult || typeof archetypeResult !== "object") return [];
  const r = archetypeResult as Record<string, unknown>;
  const candidates = [
    r.liked_topics,
    r.likedTopics,
    r.topics,
    r.tags,
    r.topInterests,
    r.top_interests,
    (r.preferences as Record<string, unknown> | undefined)?.topics,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c.filter((x) => typeof x === "string") as string[];
  }
  return [];
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
