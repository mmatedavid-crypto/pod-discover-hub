// One public-evidence formatter for React and crawler HTML; never consumes transcripts or biographies.
export interface PersonPageEvidence {
  title?: string | null;
  display_title?: string | null;
  ai_summary?: string | null; // existing public card projection, not raw clean text
  topics?: string[] | null;
  podcast_title?: string | null;
  podcast_display_title?: string | null;
  mention_type?: string | null;
  role_type?: string | null;
  verified?: boolean | null;
}

export interface PersonPageCopyInput {
  name: string;
  count: number;
  identityLabel?: string | null;
  historical?: boolean;
  episodes: PersonPageEvidence[];
}

const plain = (value: unknown) => String(value ?? "").replace(/<[^>]*>/g, " ")
  .replace(/https?:\/\/\S+/g, "").replace(/&(?:nbsp|amp|quot|#\d+);/g, " ")
  .replace(/\s+/g, " ").trim();
const fold = (value: string) => plain(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const short = (value: string, max: number) => {
  if (value.length <= max) return value;
  const head = value.slice(0, max - 1);
  const space = head.lastIndexOf(" ");
  return `${space > max / 2 ? head.slice(0, space) : head}…`;
};
const generic = /^(podcast|beszélgetés|interjú|élet|társadalom|kultúra|gazdaság|politika|közélet|történelem|magyarország|személy|említés|utazás|szabályozások|új technológiák)$/i;

export function formatPersonPage(input: PersonPageCopyInput) {
  const name = plain(input.name);
  const rawIdentity = plain(input.identityLabel);
  const identity = /^(személy|közszereplő|köz[eé]leti szereplő|nemzetközi( téma)? személy|podcast(ok)?ban (előforduló|említett) személy)$/i.test(rawIdentity) ? "" : rawIdentity;
  // Both callers pass the first 40 rows of the SAME RPC in its original order.
  const sample = input.episodes.slice(0, 40);
  const verified = sample.filter(e => e.verified === true);
  const roles = new Set(verified.map(e => {
    if (e.role_type === "subject" || (input.historical && e.role_type === "participant" && e.mention_type !== "archival_source")) return "subject";
    if (e.role_type !== "participant") return "mention";
    if (e.mention_type === "host") return "host";
    if (["guest", "interviewee"].includes(e.mention_type || "")) return "guest";
    return "speaker";
  }));
  const relation = roles.size > 1 ? "mixed" : [...roles][0] || (input.count > 0 ? "unverified" : "empty");
  const labels: Record<string, string> = {
    guest: "vendégként", host: "műsorvezetőként", speaker: "megszólalóként",
    subject: "róla szóló adások", mention: "említések", mixed: "különböző szerepek",
    unverified: "név szerinti találatok", empty: "podcastok",
  };
  const shows = [...new Set(verified.map(e => plain(e.podcast_display_title || e.podcast_title)).filter(Boolean))].slice(0, 2);
  const topics: string[] = [];
  for (const e of verified) {
    const supported = fold(`${e.title || ""} ${e.ai_summary || ""}`);
    for (const raw of e.topics || []) {
      let topic = plain(raw);
      const words = fold(topic).split(/[^a-z0-9]+/).filter(w => w.length >= 5);
      if (!topic || topic.length > 60 || generic.test(topic) || !words.length) continue;
      if (!words.some(w => supported.includes(w.slice(0, Math.max(5, w.length - 2))))) continue;
      // Keep a source's meaningful qualifier rather than reducing it to a broad topic.
      if (supported.includes(`tudatos ${fold(topic)}`)) topic = `tudatos ${topic}`;
      if (!topics.some(t => fold(t) === fold(topic))) topics.push(topic);
      if (topics.length === 2) break;
    }
    if (topics.length === 2) break;
  }
  const context = topics.length ? topics.join(", ") : "";
  const show = shows[0] || "";
  const specific = (relation === "subject" ? show : topics[0]) || show;
  const titleHead = `${name} – ${labels[relation]}`;
  // Leave title truncation to a deterministic boundary here, identical in both renderers.
  const fullTitleHead = `${titleHead}${specific ? `: ${specific}` : ""}`;
  const conciseTitleHead = specific ? `${name} – ${specific}` : titleHead;
  const title = `${short(fullTitleHead.length <= 47 ? fullTitleHead : conciseTitleHead, 47)} | Podiverzum`;
  let lead: string;
  if (relation === "empty") lead = `${name} nevéhez még nincs ellenőrzött magyar podcast-epizód a Podiverzumon.`;
  else if (relation === "unverified") lead = `${name} neve szerepel a katalógus találataiban; ezek még nem igazolt személykapcsolatok.`;
  else if (relation === "subject") lead = `${name}: róla szóló magyar adások a Podiverzumon.`;
  else if (relation === "mention") lead = `${name} említései magyar podcastokban; az említés nem jelent megszólalást.`;
  else if (relation === "mixed") lead = `${name} különböző szerepekben kapcsolódik ezekhez az adásokhoz: ${[...roles].map(r => labels[r]).join(", ")}.`;
  else lead = `${name} ${labels[relation]} hallható a kapcsolódó magyar adásokban.`;
  if (identity) lead += ` ${identity}.`;
  const detail = context ? ` Témák: ${context}.` : "";
  const showText = shows.length ? ` Műsorok: ${shows.join("; ")}.` : "";
  const example = !context && verified[0]?.title ? ` Kapcsolódó adás: „${short(plain(verified[0].title), 110)}”.` : "";
  const count = input.count > 0 ? ` ${input.count} kapcsolódó magyar epizód.` : "";
  const intro = `${lead}${detail}${showText}${example}${count}`;
  const description = short(`${name}: ${input.count > 0 ? `${input.count} magyar epizód, ` : ""}${labels[relation]}${context ? ` – ${context}` : ""}.${showText}${relation === "empty" ? " Még nincs ellenőrzött epizód." : relation === "unverified" ? " A személyazonosság még nem igazolt." : ""}`, 160);
  return { title, description, intro, relation, topics, shows };
}