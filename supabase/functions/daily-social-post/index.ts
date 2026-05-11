// Editorial X automation for Podiverzum (English-only).
// Slot-aware runner — invoked every 30 min by cron. If the current UTC time
// matches a publishing slot, it picks ONE strong fresh episode, scores it,
// generates 3 hook variants, runs a quality gate, then posts to X.
//
// Modes:
//   POST {}                          → if a slot is active now, pick + post
//   POST { dry_run: true }           → preview a post for the active slot (or "flagship" if none)
//   POST { force_slot: "13:30" }     → force a slot regardless of clock
//   POST { dry_run: true, force_slot: "21:30" }
//   GET                              → health check
//
// Slots (UTC):
//   Weekdays (Mon–Fri): 13:30 (flagship), 17:30 (topic/entity), 21:30 (discovery)
//   Weekends (Sat/Sun): 16:00 (flagship/evergreen), 20:00 (discovery)
// Daily caps: weekdays 3, weekends 2. Same podcast cannot be re-posted within 3 days.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SITE_URL = "https://podiverzum.com";
const X_API = "https://api.x.com/2";
const LOVABLE_AI = "https://ai.gateway.lovable.dev/v1/chat/completions";

// ---------- Slot definitions ----------
type SlotKind = "flagship" | "topic" | "discovery";
type Slot = { time: string; kind: SlotKind; linkPlacement: "main" | "reply" };

const WEEKDAY_SLOTS: Slot[] = [
  { time: "13:30", kind: "flagship",  linkPlacement: "main"  },
  { time: "17:30", kind: "topic",     linkPlacement: "reply" },
  { time: "21:30", kind: "discovery", linkPlacement: "reply" },
];
const WEEKEND_SLOTS: Slot[] = [
  { time: "16:00", kind: "flagship",  linkPlacement: "main"  },
  { time: "20:00", kind: "discovery", linkPlacement: "reply" },
];

// Tolerance window (minutes) — cron runs every 30m, allow ±10m drift.
const SLOT_TOLERANCE_MIN = 10;

function slotsForDay(d: Date): Slot[] {
  const dow = d.getUTCDay(); // 0=Sun, 6=Sat
  return (dow === 0 || dow === 6) ? WEEKEND_SLOTS : WEEKDAY_SLOTS;
}

function activeSlot(now: Date): Slot | null {
  const slots = slotsForDay(now);
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  for (const s of slots) {
    const [h, m] = s.time.split(":").map(Number);
    const slotMin = h * 60 + m;
    if (Math.abs(nowMin - slotMin) <= SLOT_TOLERANCE_MIN) return s;
  }
  return null;
}

// ---------- High-priority themes (scoring) ----------
const HIGH_PRIORITY_THEMES = [
  "ai", "ai agent", "agents", "openai", "anthropic", "nvidia", "apple",
  "google", "meta", "microsoft", "tesla", "elon musk", "sam altman",
  "jensen huang", "startup", "founder", "business", "investing", "market",
  "bitcoin", "fed", "trump", "geopolitic", "defense", "energy",
  "health", "longevity", "glp-1", "ozempic", "productivity", "culture",
];

const CLICKABILITY_KEYWORDS = [
  "predict", "prediction", "debate", "contrarian", "controversial",
  "wrong about", "warning", "surprising", "shocking", "what happens next",
  "lesson", "future of", "the truth about", "vs", "versus",
];

const BANNED_PHRASES = [
  /\bnew episode\b/i,
  /\bcheck (this|it) out\b/i,
  /\blisten now\b/i,
  /\bdon'?t miss\b/i,
  /\btune in\b/i,
  /\bmust[- ]listen\b/i,
  /\bnew episode out\b/i,
  /\bhere'?s what you need to know\b/i,
  /\bthis changes everything\b/i,
  /\bthe future of humanity\b/i,
  /\byou need to listen\b/i,
  /\bthis is the business model\b/i,
  /\blet that sink in\b/i,
  /\bthe uncomfortable truth\b/i,
  /\bno one is talking about this\b/i,
  /\bin today'?s episode\b/i,
  /\bin this fascinating conversation\b/i,
  /\bwhat (it|this) means for humanity\b/i,
  /\bthe future of everything\b/i,
  /\band where we go from here\b/i,
];

// ---------- OAuth 1.0a HMAC-SHA1 ----------
function pctEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!*'()]/g, (c) =>
    "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}
async function hmacSha1(key: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(key), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}
async function buildOAuthHeader(
  method: string, url: string,
  ck: string, cs: string, at: string, ats: string,
): Promise<string> {
  const p: Record<string, string> = {
    oauth_consumer_key: ck,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ""),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: at,
    oauth_version: "1.0",
  };
  const paramString = Object.keys(p).sort().map((k) => `${pctEncode(k)}=${pctEncode(p[k])}`).join("&");
  const sigBase = `${method.toUpperCase()}&${pctEncode(url)}&${pctEncode(paramString)}`;
  const signingKey = `${pctEncode(cs)}&${pctEncode(ats)}`;
  p.oauth_signature = await hmacSha1(signingKey, sigBase);
  return "OAuth " + Object.keys(p).sort().map((k) => `${pctEncode(k)}="${pctEncode(p[k])}"`).join(", ");
}
function getCreds() {
  const ck = Deno.env.get("TWITTER_CONSUMER_KEY");
  const cs = Deno.env.get("TWITTER_CONSUMER_SECRET");
  const at = Deno.env.get("TWITTER_ACCESS_TOKEN");
  const ats = Deno.env.get("TWITTER_ACCESS_TOKEN_SECRET");
  if (!ck || !cs || !at || !ats) throw new Error("Twitter credentials missing");
  return { ck, cs, at, ats };
}

async function uploadMedia(imageUrl: string): Promise<string | null> {
  try {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) return null;
    const ct = imgRes.headers.get("content-type") || "image/jpeg";
    if (!/^image\/(jpeg|jpg|png|webp|gif)/i.test(ct)) return null;
    const buf = new Uint8Array(await imgRes.arrayBuffer());
    if (buf.byteLength > 4_900_000) return null;
    const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : ct.includes("gif") ? "gif" : "jpg";
    const { ck, cs, at, ats } = getCreds();
    const url = "https://upload.twitter.com/1.1/media/upload.json";
    const auth = await buildOAuthHeader("POST", url, ck, cs, at, ats);
    const boundary = "----PodiverzumBoundary" + crypto.randomUUID().replace(/-/g, "");
    const enc = new TextEncoder();
    const head = enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="cover.${ext}"\r\nContent-Type: ${ct}\r\n\r\n`);
    const tail = enc.encode(`\r\n--${boundary}--\r\n`);
    const body = new Uint8Array(head.length + buf.length + tail.length);
    body.set(head, 0); body.set(buf, head.length); body.set(tail, head.length + buf.length);
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body,
    });
    if (!res.ok) { console.error("media upload failed:", res.status, await res.text()); return null; }
    const j = JSON.parse(await res.text());
    return j?.media_id_string || null;
  } catch (e) {
    console.error("uploadMedia error:", (e as any)?.message || e);
    return null;
  }
}

async function postTweet(
  text: string,
  opts: { mediaId?: string | null; replyToId?: string | null } = {},
): Promise<{ id: string; url: string }> {
  const { ck, cs, at, ats } = getCreds();
  const url = `${X_API}/tweets`;
  const auth = await buildOAuthHeader("POST", url, ck, cs, at, ats);
  const payload: any = { text };
  if (opts.mediaId) payload.media = { media_ids: [opts.mediaId] };
  if (opts.replyToId) payload.reply = { in_reply_to_tweet_id: opts.replyToId };
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`X API ${res.status}: ${body}`);
  const data = JSON.parse(body);
  const id = data?.data?.id;
  return { id, url: id ? `https://x.com/i/web/status/${id}` : "" };
}

// ---------- Candidate selection & scoring ----------
type EpisodeRow = {
  id: string;
  title: string;
  display_title: string | null;
  ai_summary: string | null;
  slug: string;
  published_at: string | null;
  podcast_id: string;
  image_url: string | null;
  topics: string[] | null;
  people: string[] | null;
  companies: string[] | null;
  tickers: string[] | null;
  podcasts: {
    id: string;
    title: string;
    display_title: string | null;
    slug: string;
    category: string | null;
    shadow_rank_tier: string | null;
    featured: boolean;
    image_url: string | null;
    language: string | null;
  } | null;
};

type Scored = {
  ep: EpisodeRow;
  score: number;
  breakdown: Record<string, number>;
  matchedThemes: string[];
  matchedClick: string[];
  ageHours: number;
};

function tierScore(tier?: string | null, featured?: boolean): number {
  if (tier === "S") return 1.0;
  if (tier === "A") return 0.75;
  if (featured) return 0.65;
  if (tier === "B") return 0.45;
  return 0.2;
}
function freshnessScore(publishedAt: string | null): number {
  if (!publishedAt) return 0;
  const ageH = (Date.now() - new Date(publishedAt).getTime()) / 3_600_000;
  if (ageH < 24) return 1.0;
  if (ageH < 48) return 0.7;
  if (ageH < 72) return 0.45;
  return 0.1;
}
function topicTrendScore(ep: EpisodeRow): { score: number; matched: string[] } {
  const hay = [
    ep.title, ep.display_title || "", ep.ai_summary || "",
    ...(ep.topics || []), ...(ep.people || []), ...(ep.companies || []),
  ].join(" ").toLowerCase();
  const matched: string[] = [];
  for (const t of HIGH_PRIORITY_THEMES) if (hay.includes(t)) matched.push(t);
  if (matched.length === 0) return { score: 0.1, matched };
  if (matched.length >= 3) return { score: 1.0, matched };
  if (matched.length === 2) return { score: 0.75, matched };
  return { score: 0.5, matched };
}
function entityStrengthScore(ep: EpisodeRow): number {
  const n =
    (ep.people?.length || 0) +
    (ep.companies?.length || 0) +
    (ep.tickers?.length || 0);
  if (n >= 4) return 1.0;
  if (n === 3) return 0.8;
  if (n === 2) return 0.6;
  if (n === 1) return 0.35;
  return 0.1;
}
function aiSummaryQualityScore(s: string | null): number {
  if (!s) return 0;
  const len = s.trim().length;
  if (len < 80) return 0.1;
  // Penalize generic fillers
  const generic = /(in this episode|join (us|me) (as|for)|we (talk|discuss) about)/i;
  let base = Math.min(1, len / 600);
  if (generic.test(s)) base *= 0.6;
  return Math.max(0.15, base);
}
function clickabilityScore(ep: EpisodeRow): { score: number; matched: string[] } {
  const hay = [ep.title, ep.display_title || "", ep.ai_summary || ""].join(" ").toLowerCase();
  const matched: string[] = [];
  for (const k of CLICKABILITY_KEYWORDS) if (hay.includes(k)) matched.push(k);
  // Famous-people / company boost piggybacks on entity arrays
  const boost = Math.min(0.4, ((ep.people?.length || 0) + (ep.companies?.length || 0)) * 0.1);
  let s = 0.15 + matched.length * 0.18 + boost;
  if (s > 1) s = 1;
  return { score: s, matched };
}

function scoreEpisode(ep: EpisodeRow): Scored {
  const podRank = tierScore(ep.podcasts?.shadow_rank_tier, ep.podcasts?.featured);
  const fresh = freshnessScore(ep.published_at);
  const topic = topicTrendScore(ep);
  const ent = entityStrengthScore(ep);
  const aiq = aiSummaryQualityScore(ep.ai_summary);
  const click = clickabilityScore(ep);
  const score =
    podRank * 0.30 +
    fresh   * 0.20 +
    topic.score * 0.15 +
    ent     * 0.15 +
    aiq     * 0.10 +
    click.score * 0.10;
  const ageH = ep.published_at ? (Date.now() - new Date(ep.published_at).getTime()) / 3_600_000 : 999;
  return {
    ep, score,
    breakdown: { podRank, fresh, topic: topic.score, ent, aiq, click: click.score },
    matchedThemes: topic.matched,
    matchedClick: click.matched,
    ageHours: ageH,
  };
}

async function loadCandidates(admin: any): Promise<EpisodeRow[]> {
  const since = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("episodes")
    .select(`
      id, title, display_title, ai_summary, slug, published_at, podcast_id, image_url,
      topics, people, companies, tickers,
      podcasts!inner(id, title, display_title, slug, category, shadow_rank_tier, featured, image_url, language)
    `)
    .gte("published_at", since)
    .not("ai_summary", "is", null)
    .or("language.is.null,language.ilike.en%", { referencedTable: "podcasts" })
    .order("published_at", { ascending: false })
    .limit(300);
  if (error) throw new Error(`loadCandidates: ${error.message}`);
  return (data || []) as EpisodeRow[];
}

async function recentlyPosted(admin: any) {
  // For "no same podcast within 3 days" rule, plus today's count
  const since3d = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const sinceToday = new Date();
  sinceToday.setUTCHours(0, 0, 0, 0);
  const { data } = await admin
    .from("social_posts")
    .select("podcast_ids, episode_ids, created_at, post_type, slot_utc")
    .eq("platform", "x")
    .in("status", ["success", "deleted"])
    .gte("created_at", since3d.length ? since3d : new Date(0).toISOString());
  const podcasts3d = new Set<string>();
  const episodes3d = new Set<string>();
  const todaySlots = new Set<string>();
  let todayCount = 0;
  let lastHookType: string | null = null;
  let lastTwoHookTypes: string[] = [];
  for (const r of (data || []) as any[]) {
    (r.podcast_ids || []).forEach((id: string) => podcasts3d.add(id));
    (r.episode_ids || []).forEach((id: string) => episodes3d.add(id));
    if (new Date(r.created_at) >= sinceToday) {
      todayCount++;
      if (r.slot_utc) todaySlots.add(r.slot_utc);
    }
  }
  // Last two hook types (any time, latest 2)
  const { data: lastHooks } = await admin
    .from("social_posts")
    .select("hook_type")
    .eq("platform", "x")
    .eq("status", "success")
    .not("hook_type", "is", null)
    .order("created_at", { ascending: false })
    .limit(2);
  lastTwoHookTypes = ((lastHooks || []) as any[]).map((r) => r.hook_type).filter(Boolean);
  lastHookType = lastTwoHookTypes[0] || null;
  return { podcasts3d, episodes3d, todayCount, todaySlots, lastHookType, lastTwoHookTypes };
}

function selectForSlot(scored: Scored[], slot: Slot): Scored | null {
  // Slot-specific re-rank tweaks
  const reweighted = scored.map((s) => {
    let bonus = 0;
    if (slot.kind === "flagship") {
      bonus += s.breakdown.fresh * 0.15 + s.breakdown.podRank * 0.1;
    } else if (slot.kind === "topic") {
      bonus += s.breakdown.ent * 0.2 + s.breakdown.topic * 0.15;
    } else { // discovery
      bonus += s.breakdown.click * 0.2 + s.breakdown.aiq * 0.1;
    }
    return { ...s, slotScore: s.score + bonus };
  }).sort((a, b) => b.slotScore - a.slotScore);
  // Quality floor
  for (const r of reweighted) {
    if (r.score < 0.42) continue; // skip filler
    if (slot.kind === "flagship" && r.ageHours > 48) continue;
    return r;
  }
  return null;
}

// ---------- Hook generation ----------
type HookVariant = { text: string; editorial_style_score: number; rationale?: string };
type HookSet = {
  curiosity: string;
  contrarian: string;
  utility: string;
  scores: { curiosity: number; contrarian: number; utility: number };
  rationales: { curiosity: string; contrarian: string; utility: string };
  recommended: "curiosity" | "contrarian" | "utility";
  reason: string;
};

async function generateHooks(picked: Scored, slot: Slot): Promise<{ hooks: HookSet; model: string }> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY missing");
  const ep = picked.ep;
  const podTitle = ep.podcasts?.display_title || ep.podcasts?.title || "";
  const epTitle = ep.display_title || ep.title;
  const summary = (ep.ai_summary || "").slice(0, 800);
  const entities = [
    ...(ep.people || []).slice(0, 4),
    ...(ep.companies || []).slice(0, 4),
    ...(ep.tickers || []).slice(0, 3),
  ].join(", ");
  const themes = picked.matchedThemes.slice(0, 5).join(", ");

  const sys = [
    "You are a smart human editor writing for Podiverzum's X account.",
    "Audience: international English-speaking readers (UK, US) — tech, AI, business, markets, ideas.",
    "Goal: make a thoughtful reader stop and want to read more. Not viral one-liners. Not RSS reposts. Not generic AI summaries.",
    "",
    "VOICE: intelligent, curious, editorial, calm, concrete, slightly provocative when justified. Human — not AI-polished. Never academic, never hysterical, never marketing copy.",
    "",
    "STRUCTURE (use 2–4 short lines, separated by blank lines, when it helps readability):",
    "1) A strong first line with a CONCRETE angle — a name, number, company, ticker, person, or specific tension. Not a slogan.",
    "2) One short sentence naming the tension or why it matters now.",
    "3) One sentence of context from THIS episode (what it actually gets into).",
    "4) Optional soft CTA only if it feels natural — never required.",
    "",
    "LENGTH: usually 170–260 characters before the link. Shorter is OK if naturally strong. Longer is OK (up to ~300) if the extra context genuinely earns it. Never artificially short. Length is not the quality metric.",
    "",
    "FORBIDDEN: hashtags, emojis, 'New episode', 'Check this out', 'Listen now', 'Don't miss', 'Tune in', 'Must-listen', 'This changes everything', 'The future of humanity', 'You need to listen to this', 'Here's what you need to know', 'This is the business model', 'Let that sink in', 'The uncomfortable truth', 'No one is talking about this', 'In today's episode', 'In this fascinating conversation', '...and what it means for humanity', '...and the future of everything', '...and where we go from here'. Never invent quotes or numbers. No fake controversy. No empty drama.",
    "",
    "QUALITY BAR: each post must be specific to THIS episode — could not be swapped onto another podcast. Concrete > abstract. Curiosity > hype. Substance > slogan.",
    "",
    "Return strict JSON only.",
  ].join("\n");

  const user = [
    `Slot type: ${slot.kind} (${slot.kind === "flagship" ? "fresh, newsy flagship" : slot.kind === "topic" ? "topic / entity-driven" : "curiosity / discovery"}).`,
    `Podcast: "${podTitle}"`,
    `Episode: "${epTitle}"`,
    entities ? `Notable people/companies/tickers: ${entities}` : "",
    themes ? `Matched themes: ${themes}` : "",
    `Summary: ${summary}`,
    "",
    "Write 3 DISTINCT, FULL editorial X posts for this single episode — each a complete post body (no link, no hashtags, no emojis), written in the voice and structure above. Multi-line is encouraged. Each post should feel selected and written by a human editor, not generated.",
    "",
    "Variants:",
    "1) curiosity — opens a real curiosity gap with a concrete angle. Not a teaser, not a riddle.",
    "2) contrarian — challenges the default framing of this topic with a specific, defensible counter-angle.",
    "3) utility — names exactly which kind of reader this is for and what concrete signal they'll get.",
    "",
    "For each variant, also rate it 1–10 on editorial_style_score using this rubric:",
    "+ strong, specific first line",
    "+ concrete names / numbers / tickers / people",
    "+ clear reason why it matters NOW",
    "+ feels human, easy to read, no clichés",
    "+ creates genuine curiosity (not cheap hype)",
    "+ enough context to be worth reading",
    "− generic, AI-sounding, slogan-like, abstract drama, summary-style, RSS-style, viral-guru tone",
    "",
    "Then pick the variant best suited to THIS slot type AND highest in editorial quality. Do not auto-pick the shortest or most dramatic.",
    "",
    'Return JSON: { "curiosity": { "text": "...", "editorial_style_score": 8, "rationale": "..." }, "contrarian": { "text": "...", "editorial_style_score": 7, "rationale": "..." }, "utility": { "text": "...", "editorial_style_score": 9, "rationale": "..." }, "recommended": "curiosity|contrarian|utility", "reason": "..." }',
  ].filter(Boolean).join("\n");

  const model = "google/gemini-2.5-flash";
  const res = await fetch(LOVABLE_AI, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Lovable AI ${res.status}: ${await res.text()}`);
  const j = await res.json();
  const raw = j?.choices?.[0]?.message?.content || "{}";
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { parsed = {}; }
  const v = (k: string) => {
    const x = parsed?.[k];
    if (x && typeof x === "object") return { text: sanitize(x.text || ""), score: clamp01to10(x.editorial_style_score), rationale: String(x.rationale || "") };
    return { text: sanitize(typeof x === "string" ? x : ""), score: 0, rationale: "" };
  };
  const cu = v("curiosity"), co = v("contrarian"), ut = v("utility");
  const hooks: HookSet = {
    curiosity: cu.text,
    contrarian: co.text,
    utility: ut.text,
    scores: { curiosity: cu.score, contrarian: co.score, utility: ut.score },
    rationales: { curiosity: cu.rationale, contrarian: co.rationale, utility: ut.rationale },
    recommended: ["curiosity", "contrarian", "utility"].includes(parsed.recommended) ? parsed.recommended : "curiosity",
    reason: String(parsed.reason || ""),
  };
  return { hooks, model };
}

function clamp01to10(n: any): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(10, Math.round(x)));
}

function sanitize(s: string): string {
  return String(s)
    .replace(/^["']|["']$/g, "")
    .replace(/#/g, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------- Quality gate ----------
const MIN_EDITORIAL_SCORE = 8;
function qualityGate(text: string, ep: EpisodeRow, editorialScore: number): { ok: boolean; reason?: string } {
  if (!text) return { ok: false, reason: "empty" };
  if (text.length < 120) return { ok: false, reason: "too_short" };
  if (text.length > 300) return { ok: false, reason: "too_long" };
  for (const re of BANNED_PHRASES) if (re.test(text)) return { ok: false, reason: `banned:${re}` };
  // Editorial style score from the model itself
  if (editorialScore < MIN_EDITORIAL_SCORE) return { ok: false, reason: `low_editorial_score:${editorialScore}` };
  // Generic-fit check: post must mention something specific from THIS episode.
  const hay = text.toLowerCase();
  const epTokens = (ep.display_title || ep.title).toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  const entityHit = [
    ...(ep.people || []), ...(ep.companies || []), ...(ep.tickers || []), ...(ep.topics || []),
  ].some((e) => e && hay.includes(String(e).toLowerCase()));
  const titleHit = epTokens.some((t) => hay.includes(t));
  const themeHit = HIGH_PRIORITY_THEMES.some((t) => hay.includes(t));
  if (!entityHit && !titleHit && !themeHit) return { ok: false, reason: "too_generic" };
  return { ok: true };
}

function pickHookWithGate(
  hooks: HookSet, ep: EpisodeRow, lastTwo: string[],
): { text: string; type: "curiosity" | "contrarian" | "utility"; editorial_style_score: number } | null {
  const types: Array<"curiosity" | "contrarian" | "utility"> = ["curiosity", "contrarian", "utility"];
  // Rank by editorial_style_score desc, then preference for the model's recommended, then slot-pattern diversity.
  const ranked = types
    .map((t) => ({ t, text: (hooks as any)[t] as string, score: hooks.scores[t] }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.t === hooks.recommended) return -1;
      if (b.t === hooks.recommended) return 1;
      return 0;
    });
  // Prefer not repeating the same hook type as the last two posts.
  const sameAsLastTwo = (t: string) => lastTwo[0] === t && lastTwo[1] === t;
  const ordered = [...ranked.filter((r) => !sameAsLastTwo(r.t)), ...ranked.filter((r) => sameAsLastTwo(r.t))];
  for (const r of ordered) {
    if (qualityGate(r.text, ep, r.score).ok) return { text: r.text, type: r.t, editorial_style_score: r.score };
  }
  return null;
}

// ---------- Build & post ----------
function episodeUrl(ep: EpisodeRow): string {
  return `${SITE_URL}/podcast/${ep.podcasts?.slug}/${ep.slug}`;
}

// Calls the generate-social-card edge function. Always safe — returns null on any error
// so the caller can fall back to the raw cover image.
async function generateSocialCard(
  ep: EpisodeRow,
  hookText: string,
): Promise<{ ok: boolean; url?: string; image_type?: string } | null> {
  try {
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-social-card`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({ episode_id: ep.id, hook_text: hookText }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) {
      console.error("generate-social-card http", res.status, await res.text());
      return null;
    }
    const j = await res.json();
    if (j?.ok && j?.url) return { ok: true, url: j.url, image_type: j.image_type };
    return null;
  } catch (e: any) {
    console.error("generate-social-card call failed:", e?.message || e);
    return null;
  }
}

async function main(req: Request) {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const dryRun = body?.dry_run === true;
  const trigger = body?.trigger || (dryRun ? "manual_preview" : "cron");
  const forceSlotTime: string | undefined = body?.force_slot;

  // Kill switch (skip for dry-run)
  if (!dryRun) {
    const guard = await checkBackgroundJobsAllowed(admin, "daily-social-post");
    if (guard.blocked) {
      return jsonRes({ ok: false, blocked: true, reason: guard.reason });
    }
  }

  const now = new Date();
  let slot: Slot | null = activeSlot(now);
  if (forceSlotTime) {
    const all = [...WEEKDAY_SLOTS, ...WEEKEND_SLOTS];
    slot = all.find((s) => s.time === forceSlotTime) || null;
  }
  if (!slot) {
    if (dryRun) {
      // Default to flagship for preview convenience
      slot = { time: "preview", kind: "flagship", linkPlacement: "main" };
    } else {
      return jsonRes({ ok: true, skipped: true, reason: "no_active_slot", utc: now.toISOString() });
    }
  }

  // Daily cap
  const recent = await recentlyPosted(admin);
  const dow = now.getUTCDay();
  const dailyCap = (dow === 0 || dow === 6) ? 2 : 3;
  if (!dryRun && recent.todayCount >= dailyCap) {
    return jsonRes({ ok: true, skipped: true, reason: "daily_cap_reached", todayCount: recent.todayCount });
  }
  // Same-slot already posted today?
  if (!dryRun && slot.time !== "preview" && recent.todaySlots.has(slot.time)) {
    return jsonRes({ ok: true, skipped: true, reason: "slot_already_posted", slot: slot.time });
  }

  // Load + score candidates
  const all = await loadCandidates(admin);
  const eligible = all.filter((e) => {
    const tier = e.podcasts?.shadow_rank_tier;
    const featured = e.podcasts?.featured;
    if (!(tier === "S" || tier === "A" || featured)) return false;
    if (recent.podcasts3d.has(e.podcast_id)) return false; // 3-day same-podcast cool-down
    if (recent.episodes3d.has(e.id)) return false;
    return true;
  });
  const scored = eligible.map(scoreEpisode);
  const picked = selectForSlot(scored, slot);

  if (!picked) {
    const msg = `no_strong_candidate (eligible=${eligible.length}, slot=${slot.time}/${slot.kind})`;
    if (!dryRun && slot.time !== "preview") {
      await admin.from("social_posts").insert({
        platform: "x", status: "skipped", content: msg, trigger,
        post_type: slot.kind, slot_utc: slot.time, link_placement: slot.linkPlacement,
        metadata: { eligible_count: eligible.length },
      });
    }
    return jsonRes({ ok: true, skipped: true, reason: msg });
  }

  // Generate hooks (with one regen retry if quality gate fails)
  let { hooks, model } = await generateHooks(picked, slot);
  let chosen = pickHookWithGate(hooks, picked.ep, recent.lastTwoHookTypes);
  if (!chosen) {
    const second = await generateHooks(picked, slot);
    hooks = second.hooks; model = second.model;
    chosen = pickHookWithGate(hooks, picked.ep, recent.lastTwoHookTypes);
  }
  if (!chosen) {
    const msg = "quality_gate_failed";
    if (!dryRun && slot.time !== "preview") {
      await admin.from("social_posts").insert({
        platform: "x", status: "skipped", content: JSON.stringify(hooks), trigger,
        post_type: slot.kind, slot_utc: slot.time, link_placement: slot.linkPlacement,
        episode_ids: [picked.ep.id], podcast_ids: [picked.ep.podcast_id],
        ai_model: model, score: picked.score, score_breakdown: picked.breakdown,
        error: msg, metadata: { hooks },
      });
    }
    return jsonRes({ ok: true, skipped: true, reason: msg, hooks });
  }

  const link = episodeUrl(picked.ep);
  // X counts URLs as 23 chars regardless of actual length. Keep total ≤ 280.
  // If "main" placement would overflow, switch this post to "reply" placement on the fly.
  const X_URL_CHARS = 23;
  let effectiveLinkPlacement = slot.linkPlacement;
  if (effectiveLinkPlacement === "main" && (chosen.text.length + 2 + X_URL_CHARS) > 280) {
    effectiveLinkPlacement = "reply";
  }
  const mainText = effectiveLinkPlacement === "main" ? `${chosen.text}\n\n${link}` : chosen.text;
  const replyText = effectiveLinkPlacement === "reply" ? `Full episode on Podiverzum: ${link}` : null;

  const coverUrl = picked.ep.image_url || picked.ep.podcasts?.image_url || null;

  // ----- Branded social card (best-effort, safe fallback) -----
  // Priority: branded_card → episode_cover → podcast_cover → text_only.
  // Default policy: flagship + topic slots → branded_card; discovery → episode_cover (faster, more raw).
  const wantsBranded = slot.kind === "flagship" || slot.kind === "topic";
  let imageType: "branded_card" | "episode_cover" | "podcast_cover" | "text_only" =
    picked.ep.image_url ? "episode_cover" : picked.ep.podcasts?.image_url ? "podcast_cover" : "text_only";
  let socialCardUrl: string | null = null;
  let mediaUrl: string | null = coverUrl;

  if (wantsBranded) {
    try {
      const card = await generateSocialCard(picked.ep, chosen.text);
      if (card?.ok && card.url) {
        socialCardUrl = card.url;
        mediaUrl = card.url;
        imageType = "branded_card";
      }
    } catch (e: any) {
      console.error("social card error (using fallback cover):", e?.message || e);
    }
  }

  if (dryRun) {
    return jsonRes({
      ok: true, dry_run: true, slot,
      generated_text: mainText,
      reply_text: replyText,
      hook_type: chosen.type,
      hook_variants: hooks,
      char_count: mainText.length,
      score: picked.score, score_breakdown: picked.breakdown,
      matched_themes: picked.matchedThemes,
      matched_clickability: picked.matchedClick,
      cover_image_url: coverUrl,
      social_card_url: socialCardUrl,
      image_type: imageType,
      media_url: mediaUrl,
      model,
      episode: {
        id: picked.ep.id,
        title: picked.ep.display_title || picked.ep.title,
        podcast: picked.ep.podcasts?.display_title || picked.ep.podcasts?.title,
        url: link,
        tier: picked.ep.podcasts?.shadow_rank_tier,
        published_at: picked.ep.published_at,
      },
    });
  }

  // Upload media (best-effort) — prefer branded card, else raw cover.
  const mediaId = mediaUrl ? await uploadMedia(mediaUrl) : null;
  if (!mediaId && imageType === "branded_card" && coverUrl) {
    // Branded upload failed → degrade to cover.
    imageType = picked.ep.image_url ? "episode_cover" : "podcast_cover";
    mediaUrl = coverUrl;
  }

  // Post main tweet
  let postId = "", postUrl = "", replyId: string | null = null, replyUrl: string | null = null;
  let status: "success" | "failed" = "success";
  let errMsg: string | null = null;
  try {
    const r = await postTweet(mainText, { mediaId });
    postId = r.id; postUrl = r.url;
    if (replyText && postId) {
      try {
        const rr = await postTweet(replyText, { replyToId: postId });
        replyId = rr.id; replyUrl = rr.url;
      } catch (e: any) {
        // Reply failure should not fail the whole run
        console.error("reply post failed:", e?.message || e);
      }
    }
  } catch (e: any) {
    status = "failed";
    errMsg = e?.message || String(e);
  }

  await admin.from("social_posts").insert({
    platform: "x", status,
    content: mainText,
    episode_ids: [picked.ep.id],
    podcast_ids: [picked.ep.podcast_id],
    ai_model: model,
    platform_post_id: postId || null,
    platform_post_url: postUrl || null,
    error: errMsg,
    trigger,
    post_type: slot.kind,
    hook_type: chosen.type,
    slot_utc: slot.time,
    link_placement: slot.linkPlacement,
    score: picked.score,
    score_breakdown: picked.breakdown,
    metadata: {
      char_count: mainText.length,
      cover_image_url: coverUrl,
      social_card_url: socialCardUrl,
      image_type: imageType,
      media_url: mediaUrl,
      media_id: mediaId,
      has_media: !!mediaId,
      reply_id: replyId,
      reply_url: replyUrl,
      reply_text: replyText,
      matched_themes: picked.matchedThemes,
      matched_clickability: picked.matchedClick,
      hook_variants: hooks,
      age_hours: picked.ageHours,
    },
  });

  return jsonRes({
    ok: status === "success",
    status, slot,
    post_id: postId, post_url: postUrl,
    reply_id: replyId, reply_url: replyUrl,
    text: mainText, reply_text: replyText,
    hook_type: chosen.type,
    score: picked.score,
    error: errMsg,
  }, status === "success" ? 200 : 500);
}

function jsonRes(obj: any, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method === "GET") {
    return jsonRes({ ok: true, function: "daily-social-post (editorial)", now: new Date().toISOString(), active_slot: activeSlot(new Date()) });
  }
  try {
    return await main(req);
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.error("editorial-x-runner error:", msg);
    return jsonRes({ ok: false, error: msg }, 500);
  }
});
