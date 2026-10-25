// Pure policy for the advisory Astra review of clean-text rows waiting for a
// human decision. Astra recommends only; it never writes text.
export const ASTRA_REVIEW_PROMPT_VERSION = "clean-text-astra-review-v1";
/** Same list price the entity Astra audit uses (USD per 1M tokens). */
export const ASTRA_PRICE = { input: 10, output: 50 };

export function astraReviewCostUsd(inputTokens: number, outputTokens: number): number {
  return (Math.max(0, inputTokens) * ASTRA_PRICE.input + Math.max(0, outputTokens) * ASTRA_PRICE.output) / 1_000_000;
}

export const RECOMMENDATIONS = ["use_proposed", "keep_current", "owner_decides"] as const;
export type Recommendation = typeof RECOMMENDATIONS[number];

export const ASTRA_REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "recommendation", "confidence", "missing_facts", "reason"],
        properties: {
          id: { type: "string" },
          recommendation: { type: "string", enum: [...RECOMMENDATIONS] },
          confidence: { type: "number" },
          missing_facts: { type: "array", items: { type: "string" } },
          reason: { type: "string" },
        },
      },
    },
  },
};

export const ASTRA_REVIEW_SYSTEM = `Egy magyar podcast-katalógus epizódleírásait ellenőrzöd. Minden tételnél:
- rss: a kiadó eredeti leírása,
- current: a most tárolt tisztított leírás (lehet üres),
- proposed: az automatikus javítás javaslata (lehet üres),
- concerns: amiért a gépi ellenőrzés megállította a javítást.
A concerns kódjai: names_missing = a javaslatból nevek hiányoznak; prior_names_lost = a jelenlegi szöveg neveit a javaslat elhagyná; lost_timecodes = időbélyeges fejezetek vesznek el; mostly_english = főleg angol szöveg; short_ad = rövid, reklámszerű szöveg; url_fragment = link- vagy felhasználónév-maradvány; identity = bizonytalan, hogy a YouTube-leírás ugyanehhez az epizódhoz tartozik-e; novel = a jelenlegi szöveg sok olyat tartalmaz, ami az RSS-ben nincs.
Adj egy javaslatot:
- use_proposed: a javaslat pontosan a kiadó leírásából származik, nem hagy ki fontos tényt (név, vendég, téma, időbélyeges fejezet), nincs benne reklám, felhívás vagy link, és legalább olyan jó, mint a current.
- keep_current: a current a jobb, vagy a javaslat fontos tényt hagy ki, illetve hibás.
- owner_decides: nem dönthető el biztosan, vagy egyik szöveg sem jó.
Ha a proposed üres, csak keep_current vagy owner_decides lehet.
Ne találj ki semmit, csak a megadott szövegek alapján dönts. A missing_facts legfeljebb 5 név vagy tény, ami az ajánlott szövegből hiányzik, de a másikban megvan. A confidence 0 és 1 közötti szám; 0.85 fölött csak akkor, ha biztos vagy. A reason egy rövid magyar mondat. Minden bemeneti id-re pontosan egy tétel.`;

/** Queue reason codes → the short concern labels Astra sees (fingerprints and counters dropped). */
export function reviewConcerns(reasons: string[]): string[] {
  const out = new Set<string>();
  for (const r of reasons || []) {
    const s = String(r);
    if (s.startsWith("fp:")) continue;
    if (/names_missing/.test(s)) out.add("names_missing");
    else if (/prior_names_lost_(?!0\b)/.test(s)) out.add("prior_names_lost");
    else if (/lost_timecodes/.test(s)) out.add("lost_timecodes");
    else if (/mostly_english/.test(s)) out.add("mostly_english");
    else if (/short_ad/.test(s)) out.add("short_ad");
    else if (/url_fragment|handle_fragment|link_label_residue|residual_url/.test(s)) out.add("url_fragment");
    else if (/^identity_|model_uncertain|unverified_name/.test(s)) out.add("identity");
    else if (/prior_novel_vs_rss_(\d+)/.test(s) && Number(s.match(/(\d+)$/)?.[1] || 0) >= 100) out.add("novel");
  }
  return Array.from(out);
}

export type AstraDecision = { episode_id: string; recommendation: Recommendation; confidence: number; missing_facts: string[]; reason: string };

/** Validates one model item; a "use_proposed" without a proposal becomes "owner_decides". */
export function normalizeAstraItem(raw: any, hadProposal: boolean, episodeId: string): AstraDecision | null {
  if (!raw || typeof raw !== "object") return null;
  let rec = String(raw.recommendation || "") as Recommendation;
  if (!RECOMMENDATIONS.includes(rec)) return null;
  if (rec === "use_proposed" && !hadProposal) rec = "owner_decides";
  const conf = Math.max(0, Math.min(1, Number(raw.confidence) || 0));
  const facts = Array.isArray(raw.missing_facts) ? raw.missing_facts.map((x: unknown) => String(x).slice(0, 120)).filter(Boolean).slice(0, 5) : [];
  return { episode_id: episodeId, recommendation: rec, confidence: conf, missing_facts: facts, reason: String(raw.reason || "").slice(0, 500) };
}
