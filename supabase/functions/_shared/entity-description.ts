// Pure policy for OpenAI Batch organization/person descriptions (no Deno/DB imports: unit-tested).
// Inputs are public episode facts only (title, show, date, RSS card summary). Every description must be
// backed by verbatim quotes from those facts; years/numbers must appear in the sources; persons without
// a participant role may only be described through what the episodes talk about.

export const DESCRIPTION_PROMPT_VERSION = "entity-description-v1";
export type Kind = "organization" | "person";
export type SourceEpisode = { i: number; podcast: string; title: string; date?: string | null; summary?: string | null; role?: string | null };
export type EntitySource = { entity_id: string; name: string; org_type?: string | null; attempt?: number; episodes: SourceEpisode[] };
export type Pricing = { input: number; cached_input: number; output: number };

export const INSTRUCTIONS = `Magyar podcastkatalógus (Podiverzum) szervezet- vagy személyoldalára írsz rövid, semleges leírást.
Kizárólag a megadott epizódadatokra (cím, műsor, dátum, összefoglaló) támaszkodhatsz. Saját tudást, feltételezést, értékelő vagy reklámszöveget nem írhatsz.
Szabályok:
- 1–2 mondat, legfeljebb 380 karakter, magyarul, harmadik személyben.
- Csak olyat állíts, ami szó szerint kiolvasható a forrásokból; minden állításhoz adj legalább egy szó szerinti idézetet (evidence) a megadott epizódok címéből vagy összefoglalójából, az epizód sorszámával (i).
- Évszámot, számot, beosztást, foglalkozást csak akkor írj, ha szerepel a forrásban.
- Személynél: csak akkor írd, hogy vendég, műsorvezető vagy megszólaló, ha az epizód role mezője "participant"; egyébként csak azt írd, milyen témák kapcsán kerül szóba.
- Ha a forrásokból nem derül ki, mi vagy ki az entitás, állítsd insufficient=true-ra, a description_hu legyen üres, evidence üres tömb.
- confidence: 0–1, mennyire biztos, hogy minden állítás a forrásból következik.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["insufficient", "description_hu", "confidence", "evidence"],
  properties: {
    insufficient: { type: "boolean" },
    description_hu: { type: "string" },
    confidence: { type: "number" },
    evidence: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["i", "quote"],
        properties: { i: { type: "integer" }, quote: { type: "string" } },
      },
    },
  },
};

export function buildCustomId(kind: Kind, entityId: string, attempt: number) {
  return `ed1:${kind === "organization" ? "o" : "p"}:${entityId}:${Math.max(1, Math.floor(attempt) || 1)}`;
}

export function sourcePayload(kind: Kind, src: EntitySource) {
  return {
    kind: kind === "organization" ? "szervezet" : "személy",
    name: src.name,
    ...(kind === "organization" && src.org_type ? { org_type: src.org_type } : {}),
    episodes: src.episodes.map((e) => ({
      i: e.i, podcast: e.podcast, title: e.title, date: e.date || null, summary: e.summary || "",
      ...(kind === "person" ? { role: e.role || "mention" } : {}),
    })),
  };
}

export function buildDescriptionLine(customId: string, kind: Kind, src: EntitySource, model: string, maxOutputTokens: number, effort = "low") {
  return {
    custom_id: customId,
    method: "POST",
    url: "/v1/responses",
    body: {
      model,
      instructions: INSTRUCTIONS,
      input: "INPUT:\n" + JSON.stringify(sourcePayload(kind, src)),
      reasoning: { effort: effort === "medium" ? "medium" : "low" },
      max_output_tokens: Math.max(300, Math.min(2000, Math.floor(maxOutputTokens))),
      store: false,
      text: { format: { type: "json_schema", name: "entity_description", strict: true, schema: SCHEMA } },
    },
  };
}

const estimateTokens = (text: string) => Math.ceil(String(text || "").length / 3);
export function lineCostUpperBoundUsd(line: ReturnType<typeof buildDescriptionLine>, pricing: Pricing | undefined, discount: number) {
  if (!pricing || !(discount > 0 && discount <= 1)) return Number.POSITIVE_INFINITY;
  const input = estimateTokens(line.body.instructions) + estimateTokens(line.body.input) + 50;
  return ((input * pricing.input) + (line.body.max_output_tokens * pricing.output)) / 1e6 * discount;
}

export const normalizeQuote = (s: string) => String(s || "")
  .normalize("NFC").toLowerCase()
  .replace(/[„”“"«»]/g, '"').replace(/[‘’‚']/g, "'").replace(/[–—]/g, "-")
  .replace(/\s+/g, " ").trim();

const HU_SIGNAL = /[áéíóöőúüű]|\b(és|egy|az|a|aki|amely|műsor|epizód|szó|kapcsán)\b/i;
const NUMBER_RE = /\d{2,}/g;
const URL_RE = /https?:\/\/|www\./i;
const MARKETING_RE = /\b(legjobb|kiváló|lenyűgöző|fantasztikus|egyedülálló|páratlan|kihagyhatatlan)\b/i;
const PARTICIPATION_RE = /\b(vendég\w*|műsorvezet\w*|házigazd\w*|interjú\w*|beszélget\w*|nyilatkoz\w*|megszólal\w*)/i;

export type Verdict =
  | { ok: true; description: string; evidence: { i: number; quote: string }[]; confidence: number }
  | { ok: false; reason: string };

/** Deterministic acceptance gate: anything not provably grounded in the given sources is rejected. */
export function verifyDescription(raw: unknown, kind: Kind, src: EntitySource, minConfidence = 0.7): Verdict {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return { ok: false, reason: "schema" };
  if (r.insufficient === true) return { ok: false, reason: "insufficient_evidence" };
  const description = String(r.description_hu || "").replace(/\s+/g, " ").trim();
  const confidence = Number(r.confidence);
  if (!Number.isFinite(confidence) || confidence < minConfidence) return { ok: false, reason: "low_confidence" };
  if (description.length < 40 || description.length > 420) return { ok: false, reason: "length" };
  if ((description.match(/[.!?](\s|$)/g) || []).length > 3) return { ok: false, reason: "too_many_sentences" };
  if (URL_RE.test(description)) return { ok: false, reason: "url" };
  if (MARKETING_RE.test(description)) return { ok: false, reason: "marketing_language" };
  if (!HU_SIGNAL.test(description)) return { ok: false, reason: "not_hungarian" };
  const byIndex = new Map(src.episodes.map((e) => [e.i, e]));
  const corpus = normalizeQuote(src.episodes.map((e) => `${e.podcast} ${e.title} ${e.summary || ""} ${e.date || ""}`).join(" ") + " " + src.name);
  const evidence = Array.isArray(r.evidence) ? r.evidence as { i: unknown; quote: unknown }[] : [];
  if (!evidence.length || evidence.length > 6) return { ok: false, reason: "evidence_count" };
  const clean: { i: number; quote: string }[] = [];
  for (const ev of evidence) {
    const ep = byIndex.get(Number(ev?.i));
    const quote = String(ev?.quote || "").trim();
    if (!ep || quote.length < 8 || quote.length > 300) return { ok: false, reason: "evidence_invalid" };
    const hay = normalizeQuote(`${ep.podcast} ${ep.title} ${ep.summary || ""}`);
    if (!hay.includes(normalizeQuote(quote))) return { ok: false, reason: "evidence_not_verbatim" };
    clean.push({ i: ep.i, quote });
  }
  for (const n of description.match(NUMBER_RE) || []) {
    if (!corpus.includes(n)) return { ok: false, reason: "unsupported_number" };
  }
  if (kind === "person" && PARTICIPATION_RE.test(description) && !src.episodes.some((e) => e.role === "participant")) {
    return { ok: false, reason: "unsupported_participation" };
  }
  return { ok: true, description, evidence: clean, confidence: Math.min(1, confidence) };
}
