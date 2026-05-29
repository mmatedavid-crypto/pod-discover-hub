// Hungarian AI bio + overview generator for People
// Cost-safe mode: no GPT/Pro models in backlog runners. Controls are fail-closed.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { chatTokenCostUsd } from "../_shared/ai-pricing.ts";
import { callLovableAI } from "../_shared/lovable-ai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BIO_MODEL = "google/gemini-2.5-flash-lite";
const AUDIT_MODEL = "google/gemini-2.5-flash-lite";
const OVERVIEW_MODEL = "google/gemini-2.5-flash-lite";
const MODEL = BIO_MODEL; // backwards-compat reference
const BLOCKED_BATCH_MODEL_RE = /(openai\/gpt-5|gpt-5|gemini-.*-pro|\/.*-pro|gemini-3)/i;

type AICallResult = { text: string; cost: number; ok: boolean; error?: string; toolCall?: any };

function assertCostSafeModel(model: string) {
  if (BLOCKED_BATCH_MODEL_RE.test(model || "")) {
    throw new Error(`blocked_batch_model:${model}`);
  }
}

async function callAI(
  model: string,
  system: string,
  user: string,
  opts: { reasoning?: "low" | "medium" | "high"; temperature?: number; tools?: any[]; toolChoice?: any } = {},
): Promise<AICallResult> {
  assertCostSafeModel(model);
  const body: any = {
    model,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
  };
  // GPT-5 reasoning models do not accept temperature.
  if (!/^openai\/gpt-5/.test(model) && typeof opts.temperature === "number") body.temperature = opts.temperature;
  // Reasoning effort: only supported by base gpt-5 and gpt-5.4 family. gpt-5.5 / gpt-5.2 / mini/nano/pro variants reject it as unknown parameter.
  // Reasoning effort: Lovable Gateway rejects `reasoning` on gpt-5 / gpt-5.5 base models ("Unknown parameter").
  // Only gpt-5.4 family currently accepts it reliably.
  if (opts.reasoning && /^openai\/gpt-5\.4(-(mini|nano|pro))?$/.test(model)) body.reasoning = { effort: opts.reasoning };
  if (opts.tools) body.tools = opts.tools;
  if (opts.toolChoice) body.tool_choice = opts.toolChoice;


  const ai = await callLovableAI({
    model,
    job_type: "person_bio_generator",
    target_type: "person",
    prompt_version: "person-bio-v2",
    input_text: user,
    min_input_chars: 120,
    messages: body.messages,
    tools: opts.tools,
    tool_choice: opts.toolChoice,
    temperature: typeof body.temperature === "number" ? body.temperature : undefined,
  });
  if (!ai.ok) {
    return { text: "", cost: 0, ok: false, error: ai.error || `ai_${ai.status}` };
  }
  const j = ai.data;
  const msg = j?.choices?.[0]?.message || {};
  const text = (msg.content || "").trim();
  const toolCall = msg.tool_calls?.[0];
  const inTok = ai.input_tokens || j?.usage?.prompt_tokens || 0;
  const outTok = ai.output_tokens || ((j?.usage?.completion_tokens || 0) + (j?.usage?.completion_tokens_details?.reasoning_tokens || 0));
  const cost = chatTokenCostUsd(model, Number(inTok || 0), Number(outTok || 0));
  return { text, cost, ok: true, toolCall };
}

const AUDIT_TOOL = {
  type: "function",
  function: {
    name: "submit_bio_audit",
    description: "Independent audit of an AI-generated Hungarian biography. Reject any claim not supported by sources.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        pass: { type: "boolean", description: "true only if every factual claim is supported by sources" },
        hallucination_flags: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "unsupported_occupation",
              "unsupported_birth_or_death",
              "unsupported_nationality",
              "unsupported_organization",
              "unsupported_role_claim",
              "unsupported_age_or_year",
              "speculative_political_stance",
              "marketing_language",
              "wrong_person_confusion",
              "non_hungarian_text",
              "too_long",
              "too_short",
              "echoes_safe_fallback",
              "other_unsupported_claim",
            ],
          },
        },
        rationale_hu: { type: "string", description: "Rövid magyar indoklás miért pass/fail." },
      },
      required: ["pass", "hallucination_flags", "rationale_hu"],
    },
  },
};

async function auditBio(
  personName: string,
  bioText: string,
  evidence: { wiki_extract?: string | null; wiki_description?: string | null; wiki_status: string; wiki_confidence: number; episode_titles: string[]; episode_evidence?: string[]; tally: any },
): Promise<{ pass: boolean; flags: string[]; rationale: string; cost: number; ok: boolean; error?: string }> {
  const sys = `Független auditor vagy. Egy AI által generált rövid magyar életrajzot ellenőrzöl egy podcast-katalógus számára.
Szabályok:
- HÁROM bio-típust fogadunk el:
  (A) WIKIPEDIA-ALAPÚ bio: minden tényállítást (foglalkozás, születés/halál, nemzetiség, szervezet, korszak, szerep) a Wikipedia extract/leírás KIFEJEZETTEN támogatnia kell.
  (B) EPIZÓD-LEÍRÁS-ALAPÚ bio (nincs Wikipedia, de a podcast-epizódok leírásai explicit megnevezik a személy nevét és foglalkozását/szerepét egy mondatban — pl. "X Y közgazdász", "Z W tájépítész", "az ELTE oktatója"). Ezek a foglalkozás-állítások ELFOGADHATÓK, ha a megadott epizód-evidence blokkban szóról szóra megtalálhatók.
  (C) OBSZERVÁCIÓS bio (sem Wikipedia, sem releváns leírás): csak azt állíthatja, hogy a személy magyar podcastokban szerepel/szerepelt vendégként/műsorvezetőként/témaként. Konkrét szám, szerep (host/guest/subject) megengedett, ha a tally támogatja. ÉLETRAJZI tény NEM megengedett.
- Pass=true ha a bio (A), (B) vagy (C) szabályainak megfelel ÉS magyar nyelvű ÉS 20–500 karakter között van ÉS nem a szó szerinti "magyar podcast epizódokban előforduló személy" sablon.
- Hipotetikus, "valószínűleg", reklámszerű, politikai értékelés → pass=false.
- Légy szigorú a hallucinációra (kitalált tény), de NE bukdoss el azért, mert nincs Wikipedia — (B) és (C) érvényes bio.
- A submit_bio_audit eszközzel válaszolj.`;

  const epList = evidence.episode_titles.slice(0, 15).map((t, i) => `${i + 1}. ${t}`).join("\n") || "(nincs)";
  const epEvidence = (evidence.episode_evidence || []).slice(0, 5).map((s, i) => `[${i + 1}] ${s.slice(0, 320)}`).join("\n") || "(nincs releváns leírás)";
  const user = `SZEMÉLY: ${personName}

GENERÁLT BIO (auditálandó):
"""
${bioText}
"""

BIZONYÍTÉK — Wikipedia státusz: ${evidence.wiki_status} (konfidencia ${evidence.wiki_confidence}).
Wikipedia leírás: ${evidence.wiki_description || "—"}
Wikipedia kivonat (max 800 char): ${(evidence.wiki_extract || "").slice(0, 800) || "—"}

Epizód kontextus (host=${evidence.tally?.host || 0} guest=${evidence.tally?.guest || 0} subject=${evidence.tally?.subject || 0} mentioned=${evidence.tally?.mentioned || 0}):
${epList}

Epizód-leírás részletek (foglalkozás/szerep idézhető innen, ha explicit szerepel):
${epEvidence}

Végezd el az auditot.`;

  const r = await callAI(AUDIT_MODEL, sys, user, {
    reasoning: "medium",
    tools: [AUDIT_TOOL],
    toolChoice: { type: "function", function: { name: "submit_bio_audit" } },
  });
  if (!r.ok || !r.toolCall) {
    return { pass: false, flags: ["other_unsupported_claim"], rationale: r.error || "audit_no_tool_call", cost: r.cost, ok: false, error: r.error };
  }
  try {
    const args = JSON.parse(r.toolCall.function?.arguments || "{}");
    return {
      pass: !!args.pass,
      flags: Array.isArray(args.hallucination_flags) ? args.hallucination_flags : [],
      rationale: String(args.rationale_hu || ""),
      cost: r.cost,
      ok: true,
    };
  } catch (e: any) {
    return { pass: false, flags: ["other_unsupported_claim"], rationale: `parse_error:${e?.message || e}`, cost: r.cost, ok: false, error: "parse_error" };
  }
}

function safeFallbackBio(name: string): string {
  return `${name} magyar podcast epizódokban előforduló személy. Az alábbi epizódokban kapcsolódó beszélgetések, interjúk vagy említések találhatók.`;
}

function isSafeFallback(name: string, text?: string | null): boolean {
  const value = (text || "").trim();
  return !value || value === safeFallbackBio(name) || value.includes("magyar podcast epizódokban előforduló személy");
}

function wikipediaBio(p: any): string | null {
  const extract = String(p.wikipedia_extract || "").trim();
  const desc = String(p.wikipedia_description || "").trim();
  if (!extract && !desc) return null;
  const cleanExtract = /^ez a szócikk/i.test(extract) ? "" : extract;
  const firstSentence = cleanExtract.match(/^(.{60,500}?[.!?])(?:\s|$)/)?.[1]?.trim() || cleanExtract.slice(0, 420).trim();
  let bio = firstSentence || desc;
  const nameLower = String(p.name || "").toLocaleLowerCase("hu-HU");
  const bioLower = bio.toLocaleLowerCase("hu-HU");
  const firstNameLower = nameLower.split(/\s+/)[0] || "";
  const lastNameLower = nameLower.split(/\s+/).slice(-1)[0] || "";
  // Skip prefix if the bio already starts with the canonical name OR with the first/last name
  // (avoids duplications like "Vlagyimir Putyin vlagyimir Vlagyimirovics Putyin…")
  const startsWithName = bioLower.startsWith(nameLower);
  const startsWithFirst = firstNameLower.length >= 3 && bioLower.startsWith(firstNameLower);
  const startsWithLast = lastNameLower.length >= 3 && bioLower.startsWith(lastNameLower);
  const containsLastNameEarly = lastNameLower.length >= 3 && bioLower.slice(0, 80).includes(lastNameLower);
  if (bio && !startsWithName && !startsWithFirst && !startsWithLast && !containsLastNameEarly) {
    bio = `${p.name} ${bio.charAt(0).toLocaleLowerCase("hu-HU")}${bio.slice(1)}`;
  }
  return bio.length > 500 ? `${bio.slice(0, 497).trim()}…` : bio;
}


function hasVerifiedWikiSource(p: any): boolean {
  return p.wikipedia_match_status === "verified"
    && Number(p.wikipedia_match_confidence || 0) >= 0.65
    && Boolean(p.wikipedia_extract || p.wikipedia_description);
}

function pickOverviewStyleLine(host: number, guest: number, subject: number, mentioned: number): string {
  if (host > 0 && host >= guest && host >= subject) return "host";
  if (guest > 0 && guest >= subject) return "guest";
  if (subject > 0 && subject >= mentioned) return "subject";
  return "mentioned";
}

async function processPerson(admin: any, personId: string, opts: { force?: boolean }): Promise<any> {
  const { data: p } = await admin.from("people").select("*").eq("id", personId).maybeSingle();
  if (!p) return { id: personId, skipped: "not_found" };
  // Activation/review gate
  if (!p.is_public || p.activation_status === "inactive") return { id: personId, skipped: "inactive" };
  if (["hide","reject","merge"].includes(p.ai_recommended_action || "")) return { id: personId, skipped: "ai_blocked" };
  if (["needs_human_review","duplicate_candidate"].includes(p.ai_review_status || "")) return { id: personId, skipped: "review_pending" };

  if (!opts.force && p.ai_bio_status === "completed" && p.ai_bio && p.overview_text) {
    return { id: personId, skipped: "already_done" };
  }

  const { data: aliases } = await admin.from("person_aliases").select("alias").eq("person_id", personId).limit(15);
  const { data: ppm } = await admin
    .from("person_podcast_map")
    .select("role, episode_count, podcasts!inner(id, title, is_hungarian, language_decision)")
    .eq("person_id", personId)
    .eq("podcasts.is_hungarian", true)
    .eq("podcasts.language_decision", "accept_hungarian")
    .limit(15);
  const { data: mentions } = await admin
    .from("person_episode_mentions")
    .select("mention_type, confidence, relevance_status, final_relevance_score, validation_source, episodes!inner(id, title, ai_summary, summary, podcasts!inner(is_hungarian, language_decision))")
    .eq("person_id", personId)
    .eq("episodes.podcasts.is_hungarian", true)
    .eq("episodes.podcasts.language_decision", "accept_hungarian")
    .limit(50);

  const epList = (mentions || [])
    .filter((m: any) => {
      if (m.relevance_status === "rejected" || m.relevance_status === "needs_review") return false;
      const accepted = m.relevance_status === "accepted";
      const strongAi = Number(m.final_relevance_score || 0) >= 0.75;
      const manual = m.validation_source === "manual";
      const legacyOk = (!m.relevance_status || m.relevance_status === "pending")
        && ["host","guest","subject","archival_source","interviewee","speaker"].includes(m.mention_type)
        && Number(m.confidence || 0) >= 0.80;
      return accepted || strongAi || manual || legacyOk;
    })
    .map((m: any) => ({
      id: m.episodes?.id,
      title: m.episodes?.title,
      summary: (m.episodes?.ai_summary || m.episodes?.summary || "").slice(0, 400),
      mention_type: m.mention_type,
    }))
    .filter((e: any) => e.id);

  const tally = { host: 0, guest: 0, subject: 0, mentioned: 0 } as any;
  epList.forEach((e: any) => { tally[e.mention_type] = (tally[e.mention_type] || 0) + 1; });
  const styleHint = pickOverviewStyleLine(tally.host, tally.guest, tally.subject, tally.mentioned);
  const isHost = (ppm || []).some((r: any) => r.role === "host");

  const jobInsert = await admin.from("person_enrichment_jobs").insert({
    person_id: personId, job_type: "ai_bio_overview", status: "running", started_at: new Date().toISOString(),
    input_snapshot: { ep_count: epList.length, tally, has_wiki: !!p.wikipedia_extract, wiki_status: p.wikipedia_match_status },
  }).select("id").maybeSingle();
  const jobId = (jobInsert.data as any)?.id;

  try {
    const useWiki = hasVerifiedWikiSource(p);
    const wikiDerivedBio = useWiki ? wikipediaBio(p) : null;

    // Unverified wiki candidate: extract/description present, but match_status != verified.
    // Surface it to the LLM as advisory text — model must judge if it fits the same person.
    const hasWikiCandidate = !useWiki && Boolean(
      (String(p.wikipedia_extract || "").trim().length >= 40) ||
      (String(p.wikipedia_description || "").trim().length >= 20)
    );

    const wikiBlob = useWiki
      ? `Wikipedia leírás: ${p.wikipedia_description || ""}\nWikipedia kivonat: ${(p.wikipedia_extract || "").slice(0, 800)}`
      : hasWikiCandidate
        ? `Wikipedia-jelölt (NEM verified — csak akkor használd, ha a szöveg egyértelműen ugyanerről a személyről szól: a név egyezik, az életrajzi adatok hihetők, és nincs egyértelmű félreazonosítás pl. fiktív karakter, mű, város). Ha bármi gyanús, hagyd figyelmen kívül és írj obszervációs bio-t.\nLeírás: ${p.wikipedia_description || "—"}\nKivonat: ${(p.wikipedia_extract || "").slice(0, 800)}`
        : "Nincs Wikipedia-forrás.";

    const epTitlesShort = epList.slice(0, 6).map((e: any) => `• ${e.title}`).join("\n") || "—";
    const podcastTitlesShort = (ppm || []).slice(0, 5).map((r: any) => `• ${r.podcasts?.title}`).filter(Boolean).join("\n") || "—";

    // Episode TITLE + DESCRIPTION evidence: címekben és leírásokban gyakran ott a vendég
    // foglalkozása / szerepe ("X Y közgazdász", "Z W, a Tisza Párt elnöke", "az ELTE oktatója").
    // Mindkettőt megbízható forrásként kezeljük, ha a név szóhatáron egyezik.
    const nameForMatch = String(p.name || "").toLocaleLowerCase("hu-HU");
    const tokens = nameForMatch.split(/\s+/).filter(Boolean);
    const lastTok = tokens.slice(-1)[0] || "";
    const firstTok = tokens[0] || "";
    const mentionsName = (raw: string): boolean => {
      const lower = String(raw || "").toLocaleLowerCase("hu-HU");
      if (!lower) return false;
      if (lower.includes(nameForMatch)) return true;
      const wordRe = (t: string) => new RegExp(`(^|[^\\p{L}])${t.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}([^\\p{L}]|$)`, "u");
      if (lastTok.length >= 4 && wordRe(lastTok).test(lower)) return true;
      if (firstTok.length >= 4 && wordRe(firstTok).test(lower)) return true;
      return false;
    };
    const ROLE_HINT_RE = /(közgazdász|szociológus|politológus|újságíró|szerkeszt[őo]|riporter|műsorvezet[őo]|főszerkeszt[őo]|elnök|alelnök|miniszter|államtitkár|képvisel[őo]|polgármester|kutató|professzor|docens|oktató|tanár|orvos|jogász|ügyvéd|bíró|író|költ[őo]|rendez[őo]|színész|énekes|zenész|vállalkozó|alapító|tulajdonos|vezérigazgató|igazgató|tájépítész|építész|mérnök|programozó|sportoló|edz[őo]|elemz[őo]|szakért[őo]|történész|filozófus|pszichológus|pszichiáter|atléta|labdarúgó|kosárlabdázó|sportriporter|youtuber|influenszer|aktivista|nagykövet|tábornok|ezredes)/iu;

    const epTextEvidence: string[] = [];
    for (const e of epList) {
      const title = String(e.title || "").trim();
      const summary = String(e.summary || "").trim();
      if (title && mentionsName(title) && epTextEvidence.length < 10) {
        const tag = ROLE_HINT_RE.test(title) ? "CÍM [+szerep]" : "CÍM";
        epTextEvidence.push(`${tag}: ${title.slice(0, 220)}`);
      }
      if (summary && mentionsName(summary) && epTextEvidence.length < 10) {
        const tag = ROLE_HINT_RE.test(summary) ? "LEÍRÁS [+szerep]" : "LEÍRÁS";
        epTextEvidence.push(`${tag}: ${summary.slice(0, 340)}`);
      }
      if (epTextEvidence.length >= 10) break;
    }
    // Prioritás: a [+szerep] jelölésűek előre
    epTextEvidence.sort((a, b) => (b.includes("[+szerep]") ? 1 : 0) - (a.includes("[+szerep]") ? 1 : 0));
    const epEvidenceBlob = epTextEvidence.length
      ? epTextEvidence.slice(0, 8).map((s, i) => `[${i + 1}] ${s}`).join("\n")
      : "—";

    const bioSys = `Magyar nyelvű, neutrális, tényszerű rövid bio-t írsz egy podcast-katalógushoz.
SZABÁLYOK:
- KIZÁRÓLAG magyarul. 2-3 rövid mondat, max ~280 karakter.
- ELSŐDLEGES FELADAT: ha az evidence-blokkban a személy neve mellett szerepel a FOGLALKOZÁSA, SZEREPE, INTÉZMÉNYE vagy POZÍCIÓJA (pl. "X Y közgazdász", "Z W, a Tisza Párt elnöke", "az ELTE oktatója", "a 444 újságírója"), AKKOR KÖTELEZŐ ezt a bio első mondatában szerepeltetni. Ez fontosabb, mint az epizódcímek puszta felsorolása.
- ÉLETRAJZI tényt csak akkor használj, ha (a) Wikipedia explicit tartalmazza VAGY (b) legalább egy epizód CÍME vagy LEÍRÁSA explicit megnevezi a nevet és a foglalkozást/szerepet ugyanazon mondatban. Szóról szóra alátámaszthatóság kötelező.
- Ha Wikipedia VAN (verified vagy egyértelműen ráillő jelölt), kezdj életrajzi mondattal, majd 1 mondat podcast-kontextus.
- Ha NINCS Wikipedia, de van [+szerep] evidence: kezdd a foglalkozással/szereppel ("Schmied Andi közgazdász, …"), majd 1 mondat hogy mely podcastokban / milyen témákban szólal meg.
- Ha SEM Wikipedia SEM szerep-evidence nincs, írj OBSZERVÁCIÓS bio-t konkrét podcast-címekkel és a tally alapján vendég/műsorvezető/téma minőséggel.
- SOHA ne találj ki életrajzi adatot. "Valószínűleg", "úgy tudni", reklám, politikai értékelés TILOS.
- SOHA ne nevezd "műsorvezetőnek", ha a tally.host=0.
- ABSZOLÚT TILOS visszaadni vagy parafrázálni: "magyar podcast epizódokban előforduló személy" / "magyar podcast adásokban megjelenő személy" / "az alábbi epizódokban kapcsolódó beszélgetések". Konkrét szerepet, foglalkozást VAGY podcast-címet KÖTELEZŐ említened.
- Csak a bio szövegét add vissza, semmi mást.`;

    const bioUser = `Személy neve: ${p.name}
Alias-ok: ${(aliases || []).map((a: any) => a.alias).join(", ") || "—"}
Wikipedia státusz: ${p.wikipedia_match_status} (konfidencia: ${p.wikipedia_match_confidence})
${wikiBlob}

Podiverzum kontextus:
- Magyar podcastok (${(ppm || []).length}):
${podcastTitlesShort}
- Indexelt epizódok száma: ${epList.length}
- Megjelenések típusa: host=${tally.host}, guest=${tally.guest}, subject=${tally.subject}, mentioned=${tally.mentioned}
- Példa epizódcímek:
${epTitlesShort}

EVIDENCE — epizód-CÍMEK és -LEÍRÁSOK, amelyek megemlítik ${p.name} nevét. A "[+szerep]" jelölésűek tartalmaznak foglalkozás/pozíció szót is — ezeket HASZNÁLD prioritással a bio első mondatához:
${epEvidenceBlob}

Írd meg a bio-t a fenti szabályok szerint. Ha van [+szerep] evidence, abból KÖTELEZŐ a foglalkozást/szerepet kinyerni és az első mondatban szerepeltetni.`;



    const overviewSys = `Magyar nyelvű, neutrális összefoglalót írsz arról, MIT tárgyalnak a podcast epizódok ${p.name} kapcsán.
SZABÁLYOK:
- KIZÁRÓLAG magyarul.
- 2-4 mondat.
- Csak az alább megadott epizód-címek és -leírások alapján.
- SOHA ne állítsd, hogy a személy személyesen szerepel, hacsak a megjelenés-típus host vagy guest.
- Style hint: "${styleHint}".
  - host: kezdd valami olyannal, hogy "Műsorvezetőként ezekben a beszélgetésekben…"
  - guest: "Azokban az epizódokban, amelyekben vendégként szerepel…"
  - subject: "A róla szóló epizódok…"
  - mentioned: "A róla szóló vagy őt említő epizódok…"
- Ne találgass. Ne ismételd a bio-t.
- Csak az összefoglaló szövegét add vissza.`;

    const epBlob = epList.slice(0, 25).map((e: any, i: number) => `${i + 1}. [${e.mention_type}] ${e.title}\n   ${e.summary}`).join("\n");
    const overviewUser = `Személy: ${p.name}\nEpizódok (összesen ${epList.length}, ${tally.host} host, ${tally.guest} guest, ${tally.subject} subject, ${tally.mentioned} mentioned):\n${epBlob || "—"}`;

    let bio = "";
    let bioCost = 0;
    let overview = "";
    let overviewCost = 0;
    let auditCost = 0;
    let bioStatus = "completed";
    let auditResult: any = null;
    if (epList.length === 0 && !useWiki && !hasWikiCandidate) {
      bio = safeFallbackBio(p.name);
      overview = `A ${p.name} kapcsán jelenleg nincs elegendő indexelt magyar podcast epizód.`;
      bioStatus = "insufficient_evidence";
      auditResult = { skipped: "insufficient_evidence" };
    } else {
      const [b, o] = await Promise.all([
        callAI(BIO_MODEL, bioSys, bioUser, { reasoning: "low" }),
        callAI(OVERVIEW_MODEL, overviewSys, overviewUser, { temperature: 0.3 }),
      ]);
      if (b.ok) { bio = b.text; bioCost = b.cost; } else { bio = wikiDerivedBio || safeFallbackBio(p.name); bioStatus = wikiDerivedBio ? "completed" : "needs_review"; }
      if (o.ok) { overview = o.text; overviewCost = o.cost; } else { overview = ""; }

      // Retry once if LLM gave up and returned the literal fallback (without verified wiki).
      if (!useWiki && b.ok && isSafeFallback(p.name, bio)) {
        const retrySys = bioSys + `\n\nFIGYELEM: az előző válaszod a TILTOTT sablon volt. Írd át úgy, hogy LEGALÁBB EGY konkrét podcast-címet vagy szerep-megfigyelést tartalmazzon a Podiverzum-kontextusból. NE add vissza ugyanazt.`;
        const retry = await callAI(BIO_MODEL, retrySys, bioUser, { reasoning: "low" });
        if (retry.ok && retry.text && !isSafeFallback(p.name, retry.text)) {
          bio = retry.text;
          bioCost += retry.cost;
        }
      }

      if (useWiki && isSafeFallback(p.name, bio)) {
        bio = wikiDerivedBio || safeFallbackBio(p.name);
        bioStatus = wikiDerivedBio ? "completed" : "needs_review";
        auditResult = { skipped: "wiki_verified_fallback_replaced" };
      }

      if (useWiki && bioStatus !== "completed" && wikiDerivedBio) {
        bio = wikiDerivedBio;
        bioStatus = "completed";
        auditResult = { skipped: "wiki_verified_recovery" };
      }


      if (o.ok) { overview = o.text; overviewCost = o.cost; } else { overview = ""; }

      if (useWiki && isSafeFallback(p.name, bio)) {
        bio = wikiDerivedBio || safeFallbackBio(p.name);
        bioStatus = wikiDerivedBio ? "completed" : "needs_review";
        auditResult = { skipped: "wiki_verified_fallback_replaced" };
      }

      if (useWiki && bioStatus !== "completed" && wikiDerivedBio) {
        bio = wikiDerivedBio;
        bioStatus = "completed";
        auditResult = { skipped: "wiki_verified_recovery" };
      }

      // Self-audit only if we actually got a non-fallback bio
      if (!auditResult && b.ok && bio && !isSafeFallback(p.name, bio)) {
        const audit = await auditBio(p.name, bio, {
          wiki_extract: p.wikipedia_extract,
          wiki_description: p.wikipedia_description,
          wiki_status: p.wikipedia_match_status,
          wiki_confidence: Number(p.wikipedia_match_confidence || 0),
          episode_titles: epList.map((e: any) => e.title),
          episode_evidence: epEvidenceBlob === "—" ? [] : epEvidenceBlob.split("\n").map((l: string) => l.replace(/^\[\d+\]\s*/, "")),
          tally,
        });
        auditResult = audit;
        auditCost += audit.cost || 0;
        if (!audit.pass) {
          // Reject unsupported AI text. If Wikipedia is verified, publish the source-derived sentence.
          if (wikiDerivedBio) {
            bio = wikiDerivedBio;
            bioStatus = "completed";
            auditResult.recovered_with_wikipedia = true;
          } else {
            // Without verified wiki: keep the AI text but mark as needs_review so the team can triage.
            // Avoid demoting back to the literal fallback (creates audited_fail noise).
            bioStatus = "needs_review";
          }
        } else if (!useWiki && epList.length < 2) {
          bioStatus = "needs_review";
        }
      } else if (!useWiki) {
        // Bio was the safe fallback OR call failed; demote if no evidence.
        bioStatus = isSafeFallback(p.name, bio) ? (epList.length >= 2 ? "needs_review" : "insufficient_evidence") : (epList.length < 2 ? "needs_review" : "completed");
      }
    }


    const sources = {
      wikipedia: useWiki ? { qid: p.wikidata_id, title: p.wikipedia_title, confidence: p.wikipedia_match_confidence } : null,
      episode_ids: epList.map((e: any) => e.id),
      podcast_ids: (ppm || []).map((r: any) => r.podcasts?.id).filter(Boolean),
      confidence: useWiki ? 0.9 : (epList.length >= 5 ? 0.6 : 0.4),
      mention_tally: tally,
      audit: auditResult,
      generator_model: BIO_MODEL,
    };

    const totalCost = bioCost + overviewCost + auditCost;
    // Only publish short_bio when audit passed (or no audit needed because of safe fallback)
    const publish = bioStatus === "completed";
    const update: any = {
      ai_bio: bio,
      ai_bio_status: bioStatus,
      ai_bio_generated_at: new Date().toISOString(),
      ai_bio_model: BIO_MODEL,
      ai_bio_sources: sources,
      ai_bio_confidence: sources.confidence,
      overview_text: overview || null,
      overview_generated_at: overview ? new Date().toISOString() : null,
      overview_sources: sources,
    };
    if (publish) update.short_bio = bio;
    await admin.from("people").update(update).eq("id", personId);

    // Audit trail entry
    try {
      await admin.from("ai_call_audit").insert({
        job_type: auditResult?.skipped ? "person_bio_generator" : "person_bio_audit",
        model_used: auditResult?.skipped ? BIO_MODEL : AUDIT_MODEL,
        provider: "lovable_ai",
        target_id: personId,
        target_type: "person",
        status: auditResult?.pass || bioStatus === "completed" ? "ok" : (auditResult?.skipped ? "skipped" : "rejected"),
        confidence: Number(auditResult?.pass || bioStatus === "completed" ? 1 : 0),
        estimated_cost_usd: totalCost,
        meta: { bio_status: bioStatus, flags: auditResult?.flags || [], rationale: auditResult?.rationale, bio_preview: bio.slice(0, 160), wiki_status: p.wikipedia_match_status },
      });
    } catch { /* ignore */ }

    // Spend tracking
    try {
      const today = new Date().toISOString().slice(0, 10);
      const { data: spend } = await admin.from("ai_spend_daily").select("*").eq("day", today).maybeSingle();
      const byKind = (spend?.by_kind as any) || {};
      byKind.person_bio = (Number(byKind.person_bio || 0) + totalCost);
      await admin.from("ai_spend_daily").upsert({
        day: today,
        spend_usd: Number(spend?.spend_usd || 0) + totalCost,
        calls: Number(spend?.calls || 0) + 2,
        by_kind: byKind,
        updated_at: new Date().toISOString(),
      });
    } catch { /* ignore */ }

    if (jobId) await admin.from("person_enrichment_jobs").update({
      status: bioStatus === "completed" ? "completed" : (bioStatus === "audited_fail" ? "audited_fail" : "needs_review"),
      finished_at: new Date().toISOString(),
      output_snapshot: { bio_len: bio.length, overview_len: overview.length, cost_usd: totalCost, sources },
    }).eq("id", jobId);

    return { id: personId, status: bioStatus, cost_usd: totalCost, audit: auditResult };
  } catch (e: any) {
    await admin.from("people").update({
      ai_bio_status: "error",
      ai_bio_generated_at: new Date().toISOString(),
      ai_bio_sources: { error: String(e?.message || e).slice(0, 500), generator_model: BIO_MODEL },
    }).eq("id", personId);
    if (jobId) await admin.from("person_enrichment_jobs").update({
      status: "failed", error_message: String(e?.message || e), finished_at: new Date().toISOString(),
    }).eq("id", jobId);
    return { id: personId, error: String(e?.message || e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const body = await req.json().catch(() => ({}));
  const limit = Math.min(Number(body.limit || 20), 300);
  const force = false;
  const personIds: string[] = Array.isArray(body.person_ids) ? body.person_ids : [];

  // Fail-closed: this runner must be explicitly enabled before any AI call.
  const { data: ctrlRow } = await admin.from("app_settings").select("value").eq("key", "person_bio_generator_controls").maybeSingle();
  const controls = (ctrlRow?.value || {}) as any;
  if (controls.enabled !== true) {
    return new Response(JSON.stringify({ ok: true, skipped: true, reason: "disabled_by_controls", paused_reason: controls.paused_reason || controls.auto_paused_reason || null }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }


  // Daily budget cap — honors controls.daily_budget_usd, hard ceiling at $30/day
  // as a final guard against runaway loops.
  const budget = Math.min(Number(controls.daily_budget_usd || 5), 30);
  const today = new Date().toISOString().slice(0, 10);
  const { data: spend } = await admin.from("ai_spend_daily").select("by_kind").eq("day", today).maybeSingle();
  const spentToday = Number(((spend?.by_kind as any) || {}).person_bio || 0);
  if (spentToday >= budget) {
    return new Response(JSON.stringify({ paused: "budget_reached", spent_today: spentToday, budget }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let ids: string[] = personIds;
  if (ids.length === 0) {
    // Eligibility: is_public + (is_indexable OR episode_count>=3 OR (podcast_count>=1 AND host) OR strong_mention_count>=2)
    const { data } = await admin
      .from("people")
      .select("id, episode_count, podcast_count, strong_mention_count, latest_episode_at, is_indexable, ai_bio_status, activation_status, ai_recommended_action, ai_review_status")
      .eq("is_public", true)
      .in("activation_status", ["indexable","manual_approved","public_noindex"])
      .or("is_indexable.eq.true,episode_count.gte.3,strong_mention_count.gte.2")
      .order("ai_bio_generated_at", { ascending: true, nullsFirst: true })
      .order("episode_count", { ascending: false })
      .order("strong_mention_count", { ascending: false })
      .order("podcast_count", { ascending: false })
      .order("latest_episode_at", { ascending: false, nullsFirst: false })
      .limit(limit * 3);
    const filtered = (data || []).filter((r: any) =>
      (force || !["completed","audited_fail","insufficient_evidence","needs_review","error"].includes(r.ai_bio_status || "")) &&
      !["hide","reject","merge"].includes(r.ai_recommended_action || "") &&
      !["needs_human_review","duplicate_candidate"].includes(r.ai_review_status || "")
    ).slice(0, limit);
    ids = filtered.map((r: any) => r.id);
  }

  // Concurrency 6: a Lovable AI gateway elbírja, és ~6× gyorsít a sorosan futóhoz képest.
  const CONCURRENCY = Math.max(1, Math.min(8, Number(controls.concurrency || 6)));
  const results: any[] = [];
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= ids.length) return;
      try {
        const r = await processPerson(admin, ids[i], { force });
        results.push(r);
      } catch (e: any) {
        results.push({ id: ids[i], error: String(e?.message || e) });
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  return new Response(JSON.stringify({ processed: results.length, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
