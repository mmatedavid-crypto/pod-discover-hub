// Pure-heuristic Hungarian language classifier.
// No AI calls — fast, free, deterministic. Use as ingestion gate + audit.
//
// classifyHungarianPodcastCandidate(candidate) =>
//   { language_decision, hungarian_score, foreign_score, detected_language,
//     rejection_reason, evidence }

export type LanguageDecision = "accept_hungarian" | "reject_foreign" | "review_uncertain";

export interface LanguageCandidate {
  title?: string | null;
  description?: string | null;
  author?: string | null;
  rss_language?: string | null;
  rss_url?: string | null;
  website_url?: string | null;
  episode_titles?: (string | null | undefined)[] | null;
  episode_descriptions?: (string | null | undefined)[] | null;
  categories?: (string | null | undefined)[] | null;
}

export interface LanguageResult {
  language_decision: LanguageDecision;
  hungarian_score: number; // 0..100
  foreign_score: number;   // 0..100
  detected_language: string; // 'hu' | 'en' | 'ar' | 'de' | ... | 'unknown'
  rejection_reason: string | null;
  evidence: Record<string, unknown>;
}

// Hungarian-specific accent characters
const HU_ACCENTS = "áéíóöőúüűÁÉÍÓÖŐÚÜŰ";

// High-signal Hungarian function words and very common nouns/verbs.
// Loanwords shared with English ("podcast", "interview" etc.) are intentionally excluded
// so they don't double-count on both sides.
const HU_WORDS = new Set([
  "és","hogy","nem","van","csak","már","így","mert","lehet","kell","volt",
  "most","még","azt","aki","ami","ezt","ezek","azok","mint","sem","ha",
  "vagy","majd","után","előtt","közben","felé","fölött","mellett","helyett",
  "magyar","magyarországi","budapest","beszélgetés","epizód","adás",
  "vendég","élet","világ","történet","évad","rész","műsor","heti",
  "napi","kérdés","válasz","gondolat","gondolkodás","barát","család","gyerek",
  "iskola","munka","pénz","ember","emberek","férfi","nő","fiatal","idős",
  "hogyan","miért","melyik","milyen","mikor","hol",
  "egy","két","három","négy","öt","tíz","száz","ezer","millió",
  "új","régi","jó","rossz","szép","fontos","érdekes","igaz","hamis",
  "ország","város","falu","ház","autó","út",
  "üdvözöljük","köszönöm","kérem","segítség","figyelem",
  "üzlet","vállalkozás","gazdaság","politika","kultúra","zene",
  "minden","semmi","valami","valaki","mindig","soha","gyakran",
  "szerint","alatt","fölött","között","során","végén","elején",
  "tegnap","holnap","ma","este","reggel","délután",
  "saját","közös","együtt","külön","nélkül","miatt",
  "ahol","ahogy","akkor","azért","mégis","tehát","persze",
  "boldog","szomorú","nehéz","könnyű","fiatalok","idősek",
]);

// English function/content words. EXCLUDES loanwords also common in HU ("podcast",
// "interview", "online", "tech", "sport", "business", "music", "film", "video").
const EN_WORDS = new Set([
  "the","and","with","this","that","from","what","your","about","have","has",
  "are","was","were","will","would","could","should","been","being","they",
  "their","them","there","these","those","which","when","where","while",
  "episode","show","host","guest","welcome","today","week","weekly",
  "daily","season","series","story","stories","news","update",
  "talk","talking","discuss","discussion","conversation","review","reviews",
  "best","new","top","big","small","more","less","most","first","last",
  "people","person","man","woman","kids","family","friend","life","work",
  "money","economy","politics","culture","sports",
  "movie","movies","films","technology","science","health",
  "security","cybersecurity","stormcenter","headlines",
]);

// German / French / Spanish / Italian / Russian (transliterated) signal words
const DE_WORDS = new Set(["und","der","die","das","ist","mit","nicht","ein","eine","nicht","wir","ihr","sie","sein","haben","werden","über","ohne","podcast","folge","staffel","interview"]);
const FR_WORDS = new Set(["le","la","les","et","est","une","des","dans","pour","avec","sans","plus","mais","nous","vous","ils","elles","être","avoir","épisode","émission"]);
const ES_WORDS = new Set(["el","la","los","las","y","es","una","con","por","para","sin","más","pero","nosotros","vosotros","ellos","ser","tener","episodio","programa"]);
const IT_WORDS = new Set(["il","lo","la","gli","le","e","è","una","con","per","senza","più","ma","noi","voi","loro","essere","avere","episodio","puntata"]);

const HU_DOMAINS = [
  ".hu","podkaszt.hu","hallod.hu","telex.hu","444.hu","index.hu","partizan",
  "mandiner","g7.hu","mediaklikk","spirit.hu","klubradio","hvg.hu","portfolio.hu",
  "qubit.hu","valaszonline","azonnali.hu","atlatszo.hu","forbes.hu","napi.hu",
  "ado.hu","penzcentrum","origo.hu","blikk.hu","nlc.hu","wmn.hu","arcanum",
  "atv.hu","blogger.hu","fidelio","fortepan","prae.hu","kotvenymagazin",
];

const FOREIGN_DOMAINS = [
  "npr.org","bbc.co.uk","bbc.com","theringer.com","sans.org","cisa.gov","spotify.com",
  "wnyc.org","wbur.org","kqed.org","sciencemag.org","stanford.edu","mit.edu",
  "nytimes.com","wsj.com","ft.com","economist.com","reuters.com","bloomberg.com",
  "tagesschau.de","faz.net","spiegel.de","zeit.de","lemonde.fr","lefigaro.fr",
  "elpais.com","abc.es","corriere.it","repubblica.it","rt.com","cnn.com",
  "joerogan","theguardian","npr","podcastone","iheart","wondery",
];

const SCRIPT_RANGES: Array<{ name: string; test: (cp: number) => boolean }> = [
  { name: "arabic",   test: (c) => (c >= 0x0600 && c <= 0x06FF) || (c >= 0x0750 && c <= 0x077F) || (c >= 0xFB50 && c <= 0xFDFF) || (c >= 0xFE70 && c <= 0xFEFF) },
  { name: "hebrew",   test: (c) => c >= 0x0590 && c <= 0x05FF },
  { name: "cyrillic", test: (c) => c >= 0x0400 && c <= 0x04FF },
  { name: "cjk",      test: (c) => (c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3400 && c <= 0x4DBF) },
  { name: "japanese", test: (c) => (c >= 0x3040 && c <= 0x309F) || (c >= 0x30A0 && c <= 0x30FF) },
  { name: "korean",   test: (c) => c >= 0xAC00 && c <= 0xD7AF },
  { name: "greek",    test: (c) => c >= 0x0370 && c <= 0x03FF },
  { name: "devanagari", test: (c) => c >= 0x0900 && c <= 0x097F },
  { name: "thai",     test: (c) => c >= 0x0E00 && c <= 0x0E7F },
];

function tokenize(text: string): string[] {
  // Words including HU accents and dashes
  const matches = text.toLowerCase().match(/[a-záéíóöőúüűàâäçèêëìîïñòôöùûÿß'-]+/giu);
  return matches || [];
}

function scoreScripts(text: string) {
  const scripts: Record<string, number> = {};
  let latin = 0;
  let total = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80 || (cp >= 0xC0 && cp <= 0x024F)) { latin++; total++; continue; }
    let matched = false;
    for (const r of SCRIPT_RANGES) {
      if (r.test(cp)) {
        scripts[r.name] = (scripts[r.name] || 0) + 1;
        matched = true;
        total++;
        break;
      }
    }
    if (!matched && /\S/.test(ch)) total++;
  }
  return { scripts, latin, total };
}

function countMatches(words: string[], set: Set<string>): { count: number; samples: string[] } {
  let count = 0;
  const samples: string[] = [];
  for (const w of words) {
    if (set.has(w)) {
      count++;
      if (samples.length < 8) samples.push(w);
    }
  }
  return { count, samples };
}

function huAccentRatio(text: string): number {
  if (!text) return 0;
  let huChars = 0;
  let alpha = 0;
  for (const ch of text) {
    if (HU_ACCENTS.includes(ch)) huChars++;
    if (/[\p{L}]/u.test(ch)) alpha++;
  }
  return alpha > 0 ? huChars / alpha : 0;
}

function safeStr(x: any): string {
  return typeof x === "string" ? x : "";
}

function matchAnyDomain(haystack: string, needles: string[]): string | null {
  const h = haystack.toLowerCase();
  for (const n of needles) if (h.includes(n)) return n;
  return null;
}

export function classifyHungarianPodcastCandidate(c: LanguageCandidate): LanguageResult {
  const title = safeStr(c.title);
  const description = safeStr(c.description);
  const author = safeStr(c.author);
  const epTitles = (c.episode_titles || []).map(safeStr).filter(Boolean);
  const epDescs = (c.episode_descriptions || []).map(safeStr).filter(Boolean);
  const categories = (c.categories || []).map(safeStr).filter(Boolean);

  // Combined corpus for analysis. Title + episode titles weighted by repetition (more signal).
  const titleHeavy = [title, title, ...epTitles, ...epTitles, description, ...epDescs.slice(0, 5), author, ...categories].join(" \n ").trim();
  const corpus = titleHeavy.slice(0, 8000);

  const scripts = scoreScripts(corpus);
  const words = tokenize(corpus);
  const huMatches = countMatches(words, HU_WORDS);
  const enMatches = countMatches(words, EN_WORDS);
  const deMatches = countMatches(words, DE_WORDS);
  const frMatches = countMatches(words, FR_WORDS);
  const esMatches = countMatches(words, ES_WORDS);
  const itMatches = countMatches(words, IT_WORDS);

  const huAccentRatioVal = huAccentRatio(titleHeavy);

  const rssLangRaw = safeStr(c.rss_language).trim().toLowerCase();
  const rssLang = rssLangRaw.replace(/[_-].*$/, ""); // hu-HU -> hu, en_US -> en

  const urlHaystack = `${c.rss_url || ""} ${c.website_url || ""}`.toLowerCase();
  const huDomain = matchAnyDomain(urlHaystack, HU_DOMAINS);
  const foreignDomain = matchAnyDomain(urlHaystack, FOREIGN_DOMAINS);

  let hu = 0;
  let foreign = 0;
  let detected = "unknown";
  let rejectReason: string | null = null;
  const path: string[] = [];

  // --- HARD REJECTS (non-Latin script dominance) ---
  const nonLatinScriptCounts = Object.entries(scripts.scripts);
  const totalCharsForRatio = Math.max(scripts.latin + nonLatinScriptCounts.reduce((s, [, v]) => s + v, 0), 1);
  let dominantForeignScript: string | null = null;
  for (const [name, count] of nonLatinScriptCounts) {
    if (count / totalCharsForRatio > 0.05 && count > 8) {
      dominantForeignScript = name;
      break;
    }
  }
  if (dominantForeignScript) {
    detected = dominantForeignScript;
    rejectReason = `non_latin_script_dominant:${dominantForeignScript}`;
    path.push(`hard_reject:${dominantForeignScript}`);
    return {
      language_decision: "reject_foreign",
      hungarian_score: 0,
      foreign_score: 100,
      detected_language: detected,
      rejection_reason: rejectReason,
      evidence: { scripts: scripts.scripts, decision_path: path, rss_lang: rssLang, foreign_domain: foreignDomain, hu_domain: huDomain },
    };
  }

  // --- Scoring ---

  // HU signals
  if (rssLang === "hu") { hu += 35; path.push("rss=hu:+35"); }
  if (huDomain) { hu += 20; path.push(`hu_domain:${huDomain}:+20`); }
  if (huAccentRatioVal > 0.015) { hu += Math.min(30, Math.round(huAccentRatioVal * 1000)); path.push(`hu_accent_ratio:${huAccentRatioVal.toFixed(3)}`); }
  hu += Math.min(40, huMatches.count * 3);
  if (huMatches.count > 0) path.push(`hu_words:${huMatches.count}`);

  // EN/foreign signals
  const enScore = Math.min(45, enMatches.count * 2);

  // DE/FR/ES/IT: only register when there are MANY distinct matches AND there's no
  // strong Hungarian signal. Otherwise common particles like "mit", "per", "in"
  // misfire on Hungarian text.
  const hasStrongHu = huMatches.count >= 5 || huAccentRatioVal >= 0.01 || rssLang === "hu";
  const SECONDARY_MIN = hasStrongHu ? 6 : 4;
  const secondaryScore = (count: number) =>
    count >= SECONDARY_MIN ? Math.min(30, (count - SECONDARY_MIN + 1) * 5) : 0;
  const deScore = secondaryScore(deMatches.count);
  const frScore = secondaryScore(frMatches.count);
  const esScore = secondaryScore(esMatches.count);
  const itScore = secondaryScore(itMatches.count);

  // Determine dominant foreign language
  const foreignTallies: Array<[string, number]> = [
    ["en", enScore],
    ["de", deScore],
    ["fr", frScore],
    ["es", esScore],
    ["it", itScore],
  ];
  foreignTallies.sort((a, b) => b[1] - a[1]);
  const [topForeignLang, topForeignScore] = foreignTallies[0];

  foreign += topForeignScore;
  if (topForeignScore > 0) {
    detected = topForeignLang;
    path.push(`${topForeignLang}_words_score:${topForeignScore}`);
  }

  if (rssLang && rssLang !== "hu" && rssLang.length === 2) {
    // explicit non-HU RSS language
    foreign += 25;
    if (!detected || detected === "unknown") detected = rssLang;
    path.push(`rss=${rssLang}:+25`);
  }

  if (foreignDomain) { foreign += 25; path.push(`foreign_domain:${foreignDomain}:+25`); }

  // No HU accents AT ALL in a long text is a strong EN signal
  if (titleHeavy.length > 300 && huAccentRatioVal === 0 && huMatches.count === 0) {
    foreign += 15;
    path.push("no_hu_accents_at_all:+15");
  }

  // --- Decision ---
  hu = Math.max(0, Math.min(100, hu));
  foreign = Math.max(0, Math.min(100, foreign));

  let decision: LanguageDecision;
  let finalDetected = detected;

  // Tie-breakers and conservative thresholds.
  //
  // CORE PRINCIPLE: a podcast with strong Hungarian signal must NEVER be auto-rejected,
  // even if it also contains foreign words (bilingual marketing copy, English titles
  // mixed in, etc.). Worst case for a HU-positive podcast is "review_uncertain".
  const strongHuSignal =
    rssLang === "hu" ||
    huAccentRatioVal >= 0.01 ||
    huMatches.count >= 5 ||
    !!huDomain;

  // rss=hu alone is NOT enough: an RSS feed can lie. Require at least one
  // independent HU signal (accents, HU words, or HU domain). Otherwise → review.
  const hasHuTextEvidence = huAccentRatioVal > 0 || huMatches.count >= 2 || !!huDomain;
  if (rssLang === "hu" && foreign < 30 && hasHuTextEvidence) {
    decision = "accept_hungarian";
    finalDetected = "hu";
    path.push("accept:rss_hu+text_evidence+low_foreign");
  } else if (hu >= 55 && foreign < 30) {
    decision = "accept_hungarian";
    finalDetected = "hu";
    path.push("accept:strong_hu");
  } else if (strongHuSignal && foreign < 50) {
    decision = "accept_hungarian";
    finalDetected = "hu";
    path.push("accept:hu_signal_dominant");
  } else if (strongHuSignal) {
    // HU is clearly present but foreign is also strong → bilingual / mixed.
    // NEVER reject. Send to review so a human can decide.
    decision = "review_uncertain";
    path.push("review:hu_signal_with_foreign");
  } else if (foreign >= 55 && hu < 20) {
    decision = "reject_foreign";
    rejectReason = `text_dominant_${finalDetected}`;
    path.push("reject:strong_foreign");
  } else if (foreign >= 70 && hu < 30) {
    decision = "reject_foreign";
    rejectReason = `text_dominant_${finalDetected}`;
    path.push("reject:very_strong_foreign");
  } else if (titleHeavy.length < 100 && hu < 20 && foreign < 20) {
    decision = "review_uncertain";
    path.push("review:insufficient_data");
  } else if (hu < 20 && foreign < 20 && !rssLang) {
    decision = "review_uncertain";
    path.push("review:low_signal_no_rss_lang");
  } else if (hu > 0 && foreign > 0 && Math.abs(hu - foreign) < 25) {
    decision = "review_uncertain";
    path.push("review:bilingual_or_ambiguous");
  } else if (hu > foreign) {
    decision = "accept_hungarian";
    finalDetected = "hu";
    path.push("accept:hu_outweighs_foreign");
  } else if (foreign > hu + 15) {
    decision = "reject_foreign";
    rejectReason = `text_foreign_${finalDetected}`;
    path.push("reject:foreign_outweighs_hu");
  } else {
    decision = "review_uncertain";
    path.push("review:default_tie");
  }

  return {
    language_decision: decision,
    hungarian_score: hu,
    foreign_score: foreign,
    detected_language: decision === "accept_hungarian" ? "hu" : finalDetected,
    rejection_reason: decision === "reject_foreign" ? rejectReason : null,
    evidence: {
      decision_path: path,
      rss_lang: rssLang || null,
      hu_domain: huDomain,
      foreign_domain: foreignDomain,
      hu_words_count: huMatches.count,
      hu_words_sample: huMatches.samples,
      en_words_count: enMatches.count,
      en_words_sample: enMatches.samples,
      de_words_count: deMatches.count,
      fr_words_count: frMatches.count,
      es_words_count: esMatches.count,
      it_words_count: itMatches.count,
      hu_accent_ratio: Number(huAccentRatioVal.toFixed(4)),
      scripts: scripts.scripts,
      corpus_length: titleHeavy.length,
      episode_titles_count: epTitles.length,
    },
  };
}
