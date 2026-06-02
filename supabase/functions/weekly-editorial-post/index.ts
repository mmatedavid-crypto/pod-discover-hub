// Weekly Editorial Post generator — HVG "Fülszöveg"-style curator's note.
// Picks 4-5 of the strongest Hungarian episodes from the last 7 days,
// asks a capped non-Pro model to write a magazine-style intro + per-episode mini-blocks
// with one strong quote each, and saves it as a draft in `editorial_posts`.
//
// POST body:
//   { dry_run?: boolean, force?: boolean, trigger?: string,
//     days?: number, limit?: number, post_id?: string (regenerate),
//     item_index?: number (regenerate single item) }
//
// Always returns the editorial JSON for admin review.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SITE_URL = "https://podiverzum.hu";
const LOVABLE_AI = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "openai/gpt-5.5";
const FALLBACK_MODEL = "google/gemini-2.5-pro";
const DEFAULT_MIN_TEXT_CHARS = 180;
const SOURCE_TEXT_CHARS = 3500;

// Tiltott klisék / tükörfordítások — ezeket post-validáció szűri, és 1 javító kört kérünk a modelltől.
const BANNED_PHRASES: { pattern: RegExp; reason: string }[] = [
  { pattern: /\bmintha\b/i, reason: `"Mintha…" üres meta-keret` },
  { pattern: /\bezen a héten\b/i, reason: `"Ezen a héten" klisé` },
  { pattern: /\ba hét adásai\b/i, reason: `"A hét adásai" klisé` },
  { pattern: /\bjelenleg mi foglalkoztatja\b/i, reason: `"jelenleg mi foglalkoztatja" klisé` },
  { pattern: /\bjól jellemzi\b/i, reason: `"jól jellemzi" műfaj-összefoglaló` },
  { pattern: /\bközös szál\b/i, reason: `"közös szál" klisé` },
  { pattern: /\bizgalmas\b/i, reason: `"izgalmas" üres jelző` },
  { pattern: /\bérdekes\b/i, reason: `"érdekes" üres jelző` },
  { pattern: /\blebilincsel/i, reason: `"lebilincselő" üres jelző` },
  { pattern: /\bmagával ragad/i, reason: `"magával ragadó" üres jelző` },
  { pattern: /\bkiderül,?\s+hogyan\b/i, reason: `"kiderül, hogyan" üres bevezető` },
  { pattern: /\bszó esik arról\b/i, reason: `"szó esik arról" üres bevezető` },
  { pattern: /\baz egyszeri magyar (hallgató|ember)\b/i, reason: `"az egyszeri magyar hallgató" klisé` },
  { pattern: /\bmindannyiunk\b/i, reason: `"mindannyiunk" patetikus` },
  { pattern: /\bmagunkhoz köt\b/i, reason: `"magunkhoz köt" magyartalan` },
  { pattern: /\bmust[-\s]?listen\b/i, reason: `angol "must-listen" tükörfordítás` },
  { pattern: /[\u{1F1E6}-\u{1F1FF}]{2}/u, reason: `országzászló-emoji` },
  { pattern: /\b\d{1,2}:\d{2}(?::\d{2})?\b/, reason: `epizód-timestamp (pl. "1:09:46") — soha ne tedd a szövegbe` },
];

// JÓ PÉLDA — a máj.17-i intro, few-shotként a system promptba.
const GOOD_INTRO_EXAMPLE = `Ezen a héten a nagy rendszerek ára látszik: vízumdíjban, klímaszorongásban, kiégésben, önbizalomhiányban és képekben elmesélt életutakban. A vászontáska itt már kevés, a brit ügyintézésnél pedig a romantikus külföldre költözés is hamar Excel-táblává változik.`;

// ROSSZ PÉLDA — a máj.26-i intro, hogy a modell lássa miért nem jó.
const BAD_INTRO_EXAMPLE = `Mintha tudatosan reflektálnánk a közelgő uniós választásokra, a hét adásai a jövőről szólnak, annak is a legsürgetőbb kérdéseiről: mezőgazdaságáról, a demokrácia alappilléréről, az egészségügyéről. Négy politikai, egy sport, egy történelmi adás – jól jellemzi, hogy jelenleg mi foglalkoztatja a podcast-hallgatókat 🇭🇺.`;

type Controls = {
  enabled?: boolean;
  min_text_chars?: number;
  max_candidates?: number;
  allow_reuse_existing_week?: boolean;
  auto_publish?: boolean;
  model?: string;
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function tierWeight(label: string | null | undefined): number {
  // HU_v1 toplista alapján — D/E gyakorlatilag senki nem hallgatja, így nem
  // engedjük be őket a heti editorialba (lásd a pickEpisodes hard-filterét).
  switch (label) {
    case "S": return 140;
    case "A": return 95;
    case "B": return 55;
    case "C": return 20;
    default: return 0;
  }
}

const ALLOWED_TIERS = new Set(["S", "A", "B", "C"]);

function freshnessBoost(publishedAt: string | null | undefined): number {
  if (!publishedAt) return 0;
  const ageH = (Date.now() - new Date(publishedAt).getTime()) / 3_600_000;
  if (ageH < 48) return 40;
  if (ageH < 96) return 25;
  if (ageH < 24 * 7) return 10;
  return 0;
}

// Heuristic "claim density" score — counts numbers, named entities, questions, strong verbs.
function claimDensity(text: string): number {
  if (!text) return 0;
  let s = 0;
  // numbers / percentages
  s += Math.min(15, (text.match(/\d+([.,]\d+)?%?/g) || []).length * 3);
  // proper-noun-ish tokens (capitalized mid-sentence)
  s += Math.min(10, (text.match(/(?<=[.!?]\s|^)[A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű]+/g) || []).length);
  // questions
  s += Math.min(12, (text.match(/\?/g) || []).length * 4);
  // controversy / strong claim markers (HU)
  const markers = /(\bvitatja|\bállítja|\bmiért|\bhogyan|\bvajon|\bszerintem|\bnem igaz|\btévedés|\bvád|\bbotrány|\bválság|\brekord|\bváltozt|\bfordulat|\bvégre|\bmilliárd|\bmillió)/gi;
  s += Math.min(20, (text.match(markers) || []).length * 4);
  return s;
}

function entityBonus(ep: any): number {
  let s = 0;
  s += Math.min(15, ((ep.people || []).length) * 3);
  s += Math.min(10, ((ep.parties || []).length) * 4);
  s += Math.min(8, ((ep.companies || []).length) * 2);
  s += Math.min(8, ((ep.topics || []).length) * 1.5);
  return s;
}

const BOILERPLATE_HINTS = [
  "iratkozz fel", "kövess minket", "facebook", "instagram", "tiktok", "youtube",
  "spotify", "apple podcast", "támogasd", "patreon", "webshop", "kupon",
];
const NEWS_HINTS = [
  "hírek", "hírösszefoglaló", "hír összefoglaló", "reggeli hír", "esti hír",
  "krónika", "hírpercek", "hírműsor",
];
const CATEGORY_CAPS: Record<string, number> = {
  "Religion & Spirituality": 1,
  "News": 2,
};

function textQuality(text: string, minTextChars = DEFAULT_MIN_TEXT_CHARS): number {
  const t = (text || "").trim();
  if (t.length < minTextChars) return -120;
  let s = Math.min(30, Math.floor(t.length / 140));
  const lower = t.toLowerCase();
  const boilerHits = BOILERPLATE_HINTS.filter((h) => lower.includes(h)).length;
  s -= Math.min(35, boilerHits * 7);
  const urlHits = (lower.match(/https?:\/\/|www\.|\.hu\b|\.com\b/g) || []).length;
  s -= Math.min(25, urlHits * 5);
  return s;
}

function isBulletinLike(ep: any): boolean {
  const rawTitle = String(ep?.display_title || ep?.title || "").trim();
  if (!rawTitle) return false;
  const t = rawTitle.toLowerCase();
  if (NEWS_HINTS.some((h) => t.includes(h))) return true;
  if (/^\s*\d{1,2}\s*[-–—]\s+\S/.test(rawTitle)) return true;
  if (/^\s*(20\d{6}|20\d{2}[\s._-]?\d{2}[\s._-]?\d{2})\s*[-–—\s]/.test(rawTitle)) return true;
  if (/^\s*\d{1,2}\s+(óra|perc)\b/.test(t)) return true;
  return false;
}

function categoryKey(ep: any): string {
  return ep?.podcasts?.category || ep?.podcast?.category || "_";
}

function podcastDiversityKey(podcast: any): string {
  return String(podcast?.display_title || podcast?.title || podcast?.slug || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(podcast|podcastok|radio|radio|musor)\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

type Cand = {
  id: string;
  title: string;
  display_title: string | null;
  slug: string;
  published_at: string;
  ai_summary: string | null;
  description: string | null;
  summary: string | null;
  people: string[];
  parties: string[];
  companies: string[];
  topics: string[];
  podcast: {
    id: string;
    title: string;
    display_title: string | null;
    slug: string;
    rank_label: string | null;
    podiverzum_rank: number | null;
    category?: string | null;
    featured?: boolean | null;
    shadow_rank_components?: Record<string, unknown> | null;
  };
  _score: number;
  _source_text: string;
  _text_quality: number;
};

async function fetchControls(admin: any): Promise<Controls> {
  const { data } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "weekly_editorial_controls")
    .maybeSingle();
  return (data?.value || {}) as Controls;
}

async function existingPostForWeek(admin: any, weekStart: string) {
  const { data, error } = await admin
    .from("editorial_posts")
    .select("*")
    .eq("week_start", weekStart)
    .in("status", ["draft", "approved", "published"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`existing editorial lookup: ${error.message}`);
  return data || null;
}

async function pickEpisodes(admin: any, days: number, limit: number, controls: Controls): Promise<Cand[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const maxCandidates = Math.max(100, Math.min(1000, Number(controls.max_candidates || 500)));
  const minTextChars = Math.max(80, Math.min(800, Number(controls.min_text_chars || DEFAULT_MIN_TEXT_CHARS)));
  const { data, error } = await admin
    .from("episodes")
    .select(`
      id, title, display_title, slug, published_at, ai_summary, description, summary,
      people, parties, companies, topics,
      podcasts!inner(id, title, display_title, slug, language, language_decision, is_hungarian, rss_status, category, rank_label, podiverzum_rank, featured, shadow_rank_components)
    `)
    .gte("published_at", since)
    .eq("podcasts.is_hungarian", true)
    .eq("podcasts.language_decision", "accept_hungarian")
    // Toplista-szűrő: csak S/A/B/C tier-ből válogatunk, hogy ne ajánljunk
    // olyan csatornát, amit gyakorlatilag senki nem hallgat. Featured podcast
    // bármelyik tier-ből beengedett (alább, a fallback ágon).
    .or("rank_label.in.(S,A,B,C),featured.eq.true", { foreignTable: "podcasts" })
    .order("published_at", { ascending: false })
    .limit(maxCandidates);

  if (error) throw new Error(`episode query: ${error.message}`);

  const ids = (data || []).map((e: any) => e.id);
  const cleanById = new Map<string, string>();
  if (ids.length > 0) {
    const { data: cleanRows, error: cleanErr } = await admin
      .from("episode_clean_text")
      .select("episode_id, cleaned_text, cleaner_method")
      .in("episode_id", ids)
      .limit(ids.length);
    if (cleanErr && !String(cleanErr.message || "").includes("episode_clean_text")) {
      console.warn("weekly editorial clean text lookup failed:", cleanErr.message);
    }
    for (const row of cleanRows || []) {
      if (row?.episode_id && row?.cleaned_text) cleanById.set(row.episode_id, row.cleaned_text);
    }
  }

  const scored: Cand[] = (data || []).map((e: any) => {
    const cleanText = cleanById.get(e.id) || "";
    const sourceText = (cleanText || e.ai_summary || e.summary || e.description || "").slice(0, 5000);
    const tq = textQuality(sourceText, minTextChars);
    const featuredBonus = e.podcasts?.featured ? 20 : 0;
    const qualityState = (e.podcasts?.shadow_rank_components || {})?.health_state;
    const rssState = String(e.podcasts?.rss_status || "");
    const healthPenalty =
      ["failed", "inactive", "deleted"].includes(rssState) ||
      ["quarantined_spam", "confirmed_dead", "needs_manual_rss_review"].includes(String(qualityState || ""))
        ? 200
        : 0;
    const bulletinPenalty = isBulletinLike(e) ? 45 : 0;
    const score =
      tierWeight(e.podcasts?.rank_label) +
      featuredBonus +
      freshnessBoost(e.published_at) +
      claimDensity(sourceText) +
      entityBonus(e) +
      tq +
      Math.min(20, Number(e.podcasts?.podiverzum_rank ?? 0) * 2) -
      bulletinPenalty -
      healthPenalty;
    return { ...e, podcast: e.podcasts, _score: score, _source_text: sourceText, _text_quality: tq };
  }).filter((e: Cand) => e._score > -40 && e._source_text.trim().length >= minTextChars);

  scored.sort((a, b) => b._score - a._score);

  // Diversity: max 1 episode per podcast, and cap categories that can flood a week.
  const seenPodcasts = new Set<string>();
  const seenPodcastKeys = new Set<string>();
  const categoryCounts = new Map<string, number>();
  const picked: Cand[] = [];
  for (const c of scored) {
    if (seenPodcasts.has(c.podcast.id)) continue;
    const key = podcastDiversityKey(c.podcast);
    if (key && seenPodcastKeys.has(key)) continue;
    const cat = categoryKey(c);
    const cap = CATEGORY_CAPS[cat] || 2;
    if ((categoryCounts.get(cat) || 0) >= cap && picked.length < limit) continue;
    seenPodcasts.add(c.podcast.id);
    if (key) seenPodcastKeys.add(key);
    categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1);
    picked.push(c);
    if (picked.length >= limit) break;
  }

  if (picked.length < limit) {
    for (const c of scored) {
      if (picked.some((p) => p.id === c.id)) continue;
      if (seenPodcasts.has(c.podcast.id)) continue;
      const key = podcastDiversityKey(c.podcast);
      if (key && seenPodcastKeys.has(key)) continue;
      seenPodcasts.add(c.podcast.id);
      if (key) seenPodcastKeys.add(key);
      picked.push(c);
      if (picked.length >= limit) break;
    }
  }
  return picked;
}

function episodeUrl(ep: Cand): string {
  return `${SITE_URL}/podcast/${ep.podcast.slug}/${ep.slug}`;
}

function buildPrompt(eps: Cand[], weekLabel: string, retryHint?: string): { system: string; user: string } {
  const bannedList = BANNED_PHRASES.map((b) => `  • ${b.reason}`).join("\n");

  const system = `Magyar szerkesztő vagy a Podiverzum.hu-nál. HVG / Magyar Narancs / Telex stílusú heti podcastajánlót írsz Instagram/Facebook posztra.

ALAPELVEK
- Szerkesztői hang: éles, intelligens, kicsit ironikus, sosem szenzációhajhász és sosem patetikus.
- Minden mondat konkrét: név, szám, intézmény, vagy az epizódból származó konkrét állítás. Általánosság = hiba.
- Természetes, élő magyar mondatszerkezet. Rövid mondatok jobbak, mint körmondatok. Kerüld a 3+ tagú birtokláncokat.
- Ne foglald össze az epizódok MŰFAJÁT vagy SZÁMÁT (pl. „négy politikai, egy sport"). Az olvasót nem a metaadat érdekli.

TILTOTT FORDULATOK (NE használd, sem az introban, sem a teaserben):
${bannedList}
  • országzászló-emoji bárhol (🇭🇺 🇪🇺 stb.)

INTRO szabályai:
- max 3 mondat, max 70 szó
- legalább 1 konkrét elem: tulajdonnév, intézmény, vagy az epizódokból vett konkrét állítás
- TILOS bármilyen idő-bélyeg (pl. „1:09:46", „12:30", „0:45") — az olvasó nem ugrik az epizódba, ez csak zaj
- számot csak akkor írj, ha valódi tény (Ft, %, év, darab) — ne pedig perc/másodperc
- nem műfaj-összegzés, hanem egy gondolati ív vagy konkrét megfigyelés a hét tartalmáról
- emoji max 1 db, semmiképp nem országzászló

JÓ PÉLDA introra (másold a stílust, ne a tartalmat):
"${GOOD_INTRO_EXAMPLE}"

ROSSZ PÉLDA — ezt NE csináld:
"${BAD_INTRO_EXAMPLE}"
Miért rossz: „Mintha tudatosan reflektálnánk" üres meta-keret; birtoklánc-halmozás („jövőről, kérdéseiről, mezőgazdaságáról, alappilléréről, egészségügyéről"); „az egyszeri magyar hallgatóként ülő magunkhoz köt" magyartalan körmondat; műfaj-összesítés a végén; zászló-emoji.

ITEMS szabályai (minden epizódra):
- title: pontosan az adott epizód neve (NE módosítsd)
- teaser: 2-3 mondat, MIRŐL szól és MIÉRT számít — konkrét állítás, név vagy szám a SZÖVEGFORRÁSBÓL. Sose írd hogy „interjú", „beszélgetés", „izgalmas", „érdekes" üres frázisként.
- quote: 1 erős mondat IDÉZŐJEL nélkül, max 140 karakter — parafrázis vagy provokatív összegzés. Soha ne idézz szó szerint ha nem biztos a forrás.

Magyarul írj. Ne hashtagelj.${retryHint ? `\n\nFONTOS JAVÍTÁS: ${retryHint}` : ""}`;

  const epsBlock = eps.map((e, i) => {
    const podcast = e.podcast.display_title || e.podcast.title;
    const title = e.display_title || e.title;
    const summary = (e._source_text || e.ai_summary || e.summary || e.description || "").slice(0, SOURCE_TEXT_CHARS);
    const people = (e.people || []).slice(0, 5).join(", ");
    const topics = (e.topics || []).slice(0, 6).join(", ");
    return `[${i + 1}] PODCAST: ${podcast}\nKATEGÓRIA: ${e.podcast.category || "—"}\nEPIZÓD: ${title}\nSZEREPLŐK: ${people || "—"}\nTÉMÁK: ${topics || "—"}\nSZÖVEGFORRÁS: ${summary}`;
  }).join("\n\n");

  const user = `Hét: ${weekLabel}\n\nEpizódok (sorrendben):\n\n${epsBlock}\n\nGenerálj editorial-t a megadott JSON sémába. Az items sorrendje legyen ugyanaz.`;

  return { system, user };
}

// Validáció: tiltott frázisok + min. 1 konkrét tulajdonnév/szám az introban.
function validateEditorial(ai: { intro: string; items: { title: string; teaser: string; quote: string }[] }): { ok: true } | { ok: false; reason: string } {
  const intro = ai.intro || "";
  for (const b of BANNED_PHRASES) {
    if (b.pattern.test(intro)) return { ok: false, reason: `intro tartalmaz tiltott fordulatot (${b.reason})` };
  }
  for (let i = 0; i < ai.items.length; i++) {
    const t = ai.items[i].teaser || "";
    for (const b of BANNED_PHRASES) {
      if (b.pattern.test(t)) return { ok: false, reason: `${i + 1}. teaser tartalmaz tiltott fordulatot (${b.reason})` };
    }
  }
  // konkrétság: legalább 1 nagybetűs név (mid-sentence) vagy szám az introban
  const hasNumber = /\d/.test(intro);
  const hasProperNoun = /(?<=[.!?]\s|^|„|"|\s)[A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű]{2,}/.test(intro);
  if (!hasNumber && !hasProperNoun) {
    return { ok: false, reason: "az intro nem tartalmaz egyetlen konkrét nevet vagy számot sem — írj bele egy konkrét állítást az epizódokból" };
  }
  return { ok: true };
}

async function callAI(system: string, user: string, itemCount: number, model = MODEL): Promise<{ intro: string; items: { title: string; teaser: string; quote: string }[] }> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY missing");

  const body = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    tools: [{
      type: "function",
      function: {
        name: "emit_editorial",
        description: "Emit weekly editorial copy",
        parameters: {
          type: "object",
          properties: {
            intro: { type: "string", description: "2-3 sentence Hungarian intro" },
            items: {
              type: "array",
              minItems: itemCount,
              maxItems: itemCount,
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  teaser: { type: "string" },
                  quote: { type: "string", maxLength: 160 },
                },
                required: ["title", "teaser", "quote"],
                additionalProperties: false,
              },
            },
          },
          required: ["intro", "items"],
          additionalProperties: false,
        },
      },
    }],
    tool_choice: { type: "function", function: { name: "emit_editorial" } },
  };

  const res = await fetch(LOVABLE_AI, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (res.status === 429) throw new Error("rate_limited");
  if (res.status === 402) throw new Error("payment_required");
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`AI error ${res.status}: ${t.slice(0, 300)}`);
  }

  const data = await res.json();
  const call = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!call?.function?.arguments) throw new Error("no tool call in AI response");
  return JSON.parse(call.function.arguments);
}

function weekRange(): { start: Date; end: Date; label: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 86_400_000);
  const fmt = (d: Date) => `${d.getUTCMonth() + 1}.${d.getUTCDate()}`;
  const months = ["jan", "feb", "márc", "ápr", "máj", "jún", "júl", "aug", "szept", "okt", "nov", "dec"];
  const label = `${months[start.getUTCMonth()]}. ${start.getUTCDate()}. – ${end.getUTCDate()}.`;
  return { start, end, label };
}

function buildCaptions(intro: string, items: { title: string; podcast_name: string; url: string; quote: string }[]): { ig: string; fb: string } {
  const fbLines = [
    `📰 A hét a Podiverzumon`,
    "",
    intro,
    "",
    ...items.map((it) => `▸ ${it.title} — ${it.podcast_name}\n  ${it.quote}\n  ${it.url}`),
    "",
    `Több: ${SITE_URL}`,
  ];
  const igLines = [
    `📰 A hét a Podiverzumon`,
    "",
    intro,
    "",
    ...items.map((it) => `▸ ${it.title} — ${it.podcast_name}`),
    "",
    `Linkek a bio-ban → ${SITE_URL}`,
    "",
    "#podcast #magyarpodcast #podiverzum",
  ];
  return { ig: igLines.join("\n"), fb: fbLines.join("\n") };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method === "GET") return json({ ok: true, function: "weekly-editorial-post" });

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }

  const dryRun = body?.dry_run === true;
  const force = body?.force === true;
  const days = Math.max(1, Math.min(30, Number(body?.days ?? 7)));
  const limit = Math.max(3, Math.min(7, Number(body?.limit ?? 5)));

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { checkBackgroundJobsAllowed } = await import("../_shared/incident-guard.ts");
    const guard = await checkBackgroundJobsAllowed(admin, "weekly-editorial-post");
    if (guard.blocked) return json({ ok: false, blocked: true, reason: guard.reason }, 503);

    const controls = await fetchControls(admin);
    if (controls.enabled === false) {
      return json({ ok: false, error: "weekly_editorial disabled" }, 503);
    }
    const publishNow = body?.publish === true || controls.auto_publish === true;

    const { start, end, label } = weekRange();
    const weekStart = start.toISOString().slice(0, 10);
    const existing = !dryRun && !force && controls.allow_reuse_existing_week !== false
      ? await existingPostForWeek(admin, weekStart)
      : null;
    if (existing) {
      if (publishNow && existing.status !== "published") {
        const { data: published, error: pubErr } = await admin
          .from("editorial_posts")
          .update({
            status: "published",
            approved_at: existing.approved_at || new Date().toISOString(),
            published_at: existing.published_at || new Date().toISOString(),
          })
          .eq("id", existing.id)
          .select()
          .single();
        if (pubErr) throw new Error(`publish existing editorial: ${pubErr.message}`);
        return json({
          ok: true,
          reused_existing: true,
          published_existing: true,
          post_id: published.id,
          status: published.status,
          week_start: published.week_start,
          week_end: published.week_end,
          title: published.title,
        });
      }
      return json({
        ok: true,
        reused_existing: true,
        post_id: existing.id,
        status: existing.status,
        week_start: existing.week_start,
        week_end: existing.week_end,
        title: existing.title,
      });
    }

    const picked = await pickEpisodes(admin, days, limit, controls);
    if (picked.length < 3) {
      return json({ ok: false, error: `not enough strong episodes (got ${picked.length})` }, 200);
    }

    const primaryModel = controls.model || MODEL;
    let modelUsed = primaryModel;
    let validationNote: string | null = null;

    // 1. próba: primary model (gemini-2.5-pro alapból)
    let ai: Awaited<ReturnType<typeof callAI>>;
    try {
      const { system, user } = buildPrompt(picked, label);
      ai = await callAI(system, user, picked.length, primaryModel);
    } catch (e: any) {
      const msg = String(e?.message || "");
      const shouldFallback =
        msg === "rate_limited" ||
        msg === "payment_required" ||
        msg === "no tool call in AI response" ||
        msg.startsWith("AI error 5");
      if (shouldFallback && primaryModel !== FALLBACK_MODEL) {
        console.warn(`weekly-editorial primary model failed (${msg}), falling back to ${FALLBACK_MODEL}`);
        modelUsed = FALLBACK_MODEL;
        const { system, user } = buildPrompt(picked, label);
        ai = await callAI(system, user, picked.length, FALLBACK_MODEL);
      } else {
        throw e;
      }
    }

    // Validáció + max 1 javító kör
    const check = validateEditorial(ai);
    if (!check.ok) {
      console.warn(`weekly-editorial validation failed: ${check.reason} — retrying once`);
      validationNote = check.reason;
      try {
        const { system, user } = buildPrompt(picked, label, check.reason);
        const ai2 = await callAI(system, user, picked.length, modelUsed);
        const check2 = validateEditorial(ai2);
        if (check2.ok) {
          ai = ai2;
          validationNote = `retry_passed_after: ${check.reason}`;
        } else {
          // A jobbat tartjuk meg (kevesebb tiltott találat) — itt az eredetit hagyjuk, hogy ne akadjon el a heti poszt.
          validationNote = `retry_still_failing: ${check2.reason} (original: ${check.reason})`;
          console.warn(`weekly-editorial retry still invalid: ${check2.reason}`);
          ai = ai2; // a retry általában jobb, akkor is ha még nem tökéletes
        }
      } catch (e: any) {
        console.warn(`weekly-editorial retry threw: ${e?.message}`);
      }
    }
    const model = modelUsed;

    const items = picked.map((ep, i) => {
      const aiItem = ai.items[i] || { title: ep.display_title || ep.title, teaser: "", quote: "" };
      return {
        episode_id: ep.id,
        title: ep.display_title || ep.title,
        podcast_name: ep.podcast.display_title || ep.podcast.title,
        podcast_slug: ep.podcast.slug,
        episode_slug: ep.slug,
        url: episodeUrl(ep),
        teaser: aiItem.teaser,
        quote: aiItem.quote,
        cover_card_url: null as string | null,
        score: ep._score,
        source_quality: ep._text_quality,
        source_text_chars: ep._source_text.length,
      };
    });

    const captions = buildCaptions(ai.intro, items);
    const title = `A hét a Podiverzumon — ${label}`;

    const payload = {
      week_start: weekStart,
      week_end: end.toISOString().slice(0, 10),
      status: publishNow ? "published" : "draft",
      title,
      intro: ai.intro,
      items,
      ig_caption: captions.ig,
      fb_caption: captions.fb,
      ai_model: model,
      generation_meta: {
        picked: picked.length,
        days,
        scores: picked.map((p) => p._score),
        source_quality: picked.map((p) => p._text_quality),
        policy: "weekly_editorial_v3_hu_strict_style",
        auto_published: publishNow,
        primary_model: primaryModel,
        model_used: modelUsed,
        validation_note: validationNote,
      },
      trigger: body?.trigger || (dryRun ? "manual_preview" : "cron"),
      approved_at: publishNow ? new Date().toISOString() : null,
      published_at: publishNow ? new Date().toISOString() : null,
    };

    if (dryRun && !body?.persist) {
      return json({ ok: true, dry_run: true, ...payload });
    }

    const { data: saved, error: insErr } = await admin
      .from("editorial_posts")
      .insert(payload)
      .select()
      .single();
    if (insErr) throw new Error(`save draft: ${insErr.message}`);

    return json({ ok: true, post_id: saved.id, ...payload });
  } catch (e: any) {
    console.error("weekly-editorial-post error:", e?.message);
    return json({ ok: false, error: e?.message || "unknown" }, 500);
  }
});
