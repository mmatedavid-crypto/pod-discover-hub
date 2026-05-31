// AI-trim gate for episode-clean-text-runner.
// Routes only buckets where blind AI eval beat deterministic v3:
//   yt_dominant, over_trimmed_v3, sponsor_heavy.
// Model: google/gemini-3.1-flash-lite-preview with 12 gold few-shot pairs.
// Hallucination guard: rejects AI output if it deletes everything when v3 had real content.
import { callLovableAI } from "./lovable-ai.ts";
import { AI_TRIM_FEW_SHOTS } from "./clean-text-ai-trim-few-shots.ts";

export type AiTrimBucket = "yt_dominant" | "over_trimmed_v3" | "sponsor_heavy" | "none";

const SPONSOR_MARKERS = [
  /támogat(?:ó|ja|ói|ónk|óink|ja a műsort)/i,
  /\bkupon\b/i,
  /kedvezmény(?:es|kód)?/i,
  /\bpromo\b/i,
  /\bkód(?:dal|ot)\b/i,
  /\bhirdet(?:és|ő)\b/i,
  /\bszponzor/i,
  /műsor(?:unk)? (?:támogatója|partnere)/i,
  /használd a .{1,30} kódot/i,
  /\bpatreon\b/i,
];

/**
 * Decide whether AI-trim should run on this episode.
 * Uses raw + v3 output features only — no DB lookups.
 */
export function detectAiTrimBucket(opts: {
  raw_text: string;
  v3_cleaned: string;
  source_type: string;            // "rss" | "ytdesc" | "article" | "transcript"
  rss_description?: string | null;
}): AiTrimBucket {
  const raw = String(opts.raw_text || "");
  const v3 = String(opts.v3_cleaned || "");
  const rss = String(opts.rss_description || "");
  const rawLen = raw.length;
  const v3Len = v3.length;

  // 1. yt_dominant — best text source was YouTube and YT is meaningfully longer than RSS.
  if (opts.source_type === "ytdesc" && rawLen > 600 && (rss.length === 0 || rawLen > rss.length * 1.5)) {
    return "yt_dominant";
  }

  // 2. over_trimmed_v3 — raw had substance but v3 kept less than 25% of it (lost too much).
  if (rawLen >= 800 && v3Len < rawLen * 0.25) {
    return "over_trimmed_v3";
  }

  // 3. sponsor_heavy — raw is loaded with sponsor markers (check raw, not v3, since v3 strips most).
  const sponsorMatches = SPONSOR_MARKERS.reduce((n, rx) => n + (rx.test(raw) ? 1 : 0), 0);
  if (sponsorMatches >= 3 && rawLen > 800) return "sponsor_heavy";

  return "none";
}

const SYSTEM_PROMPT = [
  "Magyar podcast-epizód leírások tisztításáért felelsz.",
  "Bemenet: nyers epizód leírás (RSS / YouTube / cikkből).",
  "Kimenet: KIZÁRÓLAG az epizód tartalmát leíró tiszta magyar szöveg, semmi más.",
  "",
  "TÖRÖLD:",
  "- URL-eket, e-mail címeket, @handle-eket, közösségi link-listákat",
  "- 'Iratkozz fel / Kövess minket / Hallgasd Spotify-on / Patreon / támogatás' jellegű CTA-kat",
  "- Hirdetést, szponzor-blokkokat, kuponokat, kedvezmény-kódokat ('használd a XYZ kódot…')",
  "- Műsorvezető-bemutatást ha pusztán önreklám ('a műsor házigazdája X, X évek óta…')",
  "- Időkód-listákat (00:42 …), fejezetcímeket önmagukban",
  "- Show notes blokkokat, jogi nyilatkozatokat, 'this episode is sponsored by…'",
  "- Sablonos epizód-azonosítót ('Mauvaises Ondes #42' egyedül álló sor)",
  "",
  "TARTSD MEG:",
  "- Az epizód témáját, vendégeit, kulcskérdéseit",
  "- A tartalmi összefoglalót, idézeteket, konkrét állításokat",
  "- A vendég releváns szakmai hátterét (ha a leírás része)",
  "",
  "SZABÁLYOK:",
  "- NE találj ki új mondatot, NE foglalj össze újra — csak töröld a zajt és tartsd meg az érdemi mondatokat.",
  "- Ha a bemenet nem magyar (pl. francia / angol), NE fordítsd le — add vissza eredeti nyelven, csak a zajt törölve.",
  "- A kimenet csak az eltisztított szöveg, semmi prefix/suffix, nincs magyarázat, nincs markdown.",
].join("\n");

function buildFewShotMessages() {
  const msgs: Array<{ role: string; content: string }> = [
    { role: "system", content: SYSTEM_PROMPT },
  ];
  for (const ex of AI_TRIM_FEW_SHOTS) {
    msgs.push({ role: "user", content: `NYERS:\n${ex.raw}` });
    msgs.push({ role: "assistant", content: ex.gold });
  }
  return msgs;
}

const FEW_SHOT_MESSAGES = buildFewShotMessages();

export type AiTrimResult = {
  ok: boolean;
  cleaned_text?: string;
  reason?: string;
  cost_usd?: number;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
};

export async function runAiTrim(opts: {
  episode_id: string;
  raw_text: string;
  v3_cleaned: string;
  bucket: AiTrimBucket;
  model?: string;
  source_hash?: string;
}): Promise<AiTrimResult> {
  const model = opts.model || "google/gemini-3.1-flash-lite-preview";
  const raw = opts.raw_text.slice(0, 12_000);
  const v3 = opts.v3_cleaned;

  const messages = [
    ...FEW_SHOT_MESSAGES,
    { role: "user", content: `NYERS:\n${raw}` },
  ];

  const t0 = Date.now();
  const res = await callLovableAI({
    model,
    job_type: "clean_text_ai_trim",
    messages,
    temperature: 0,
    max_tokens: 1400,
    target_type: "episode",
    target_id: opts.episode_id,
    source_hash: opts.source_hash,
    prompt_version: `ai_trim_v1_${opts.bucket}`,
    min_input_chars: 200,
  });

  if (!res.ok) {
    return { ok: false, reason: res.error || "ai_call_failed", model };
  }

  const content = String(res.data?.choices?.[0]?.message?.content || "").trim();
  if (!content) return { ok: false, reason: "empty_response", model };

  // Hallucination / over-aggressive guard: AI killed everything despite v3 having content.
  if (content.length < 30 && v3.length > 200) {
    return { ok: false, reason: "guard_over_trim", model };
  }
  // Reject AI output that's dramatically shorter than v3 on long episodes (likely summary, not trim).
  if (v3.length > 600 && content.length < v3.length * 0.15) {
    return { ok: false, reason: "guard_summary_suspected", model };
  }
  // Reject AI output that's much LONGER than raw (hallucinated content).
  if (content.length > raw.length * 1.2) {
    return { ok: false, reason: "guard_hallucinated_expansion", model };
  }

  const inTok = Number(res.input_tokens || 0);
  const outTok = Number(res.output_tokens || 0);
  // flash-lite-preview ≈ $0.10/1M in, $0.40/1M out (rough)
  const cost = (inTok / 1_000_000) * 0.10 + (outTok / 1_000_000) * 0.40;

  void t0;
  return {
    ok: true,
    cleaned_text: content,
    model,
    input_tokens: inTok,
    output_tokens: outTok,
    cost_usd: cost,
  };
}

export const AI_TRIM_TARGET_BUCKETS: AiTrimBucket[] = ["yt_dominant", "over_trimmed_v3", "sponsor_heavy"];
