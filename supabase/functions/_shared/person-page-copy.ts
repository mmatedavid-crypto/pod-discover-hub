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
  const identity = !rawIdentity.includes(" ") || /^(személy|közszereplő|köz[eé]leti szereplő|nemzetközi( téma)? személy|podcast(ok)?ban (előforduló|említett) személy)$/i.test(rawIdentity) ? "" : rawIdentity;
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
  const context = topics.join(" és ");
  const show = shows[0] || "";
  // Both SEO writers cap titles at 60 characters. Fit whole phrases within
  // their 47-character head budget rather than leaving a dangling “és”.
  const candidates = relation === "subject" ? [show] : [context, topics[0], show];
  const specific = candidates.find(value => value && `${name} – ${value}`.length <= 47) || "";
  // Context describes the linked programmes, never the person's expertise.
  // Keep personal names unchanged; Hungarian name suffixes cannot be guessed safely.
  const title = `${name}${specific ? ` – ${specific}` : ""} | Podiverzum`;
  let lead: string;
  if (relation === "empty") lead = `${name} nevéhez még nincs ellenőrzött magyar podcast-epizód a Podiverzumon.`;
  else if (relation === "unverified") lead = `${name} neve szerepel a katalógus találataiban; ezek még nem igazolt személykapcsolatok.`;
  else if (relation === "subject") lead = `A kapcsolódó adásokban róla beszélnek: ${name}.`;
  else if (relation === "mention") lead = `A kapcsolódó adásokban megemlítik: ${name}.`;
  else {
    const clauses: string[] = [];
    if (roles.has("guest")) clauses.push(`vendégként${relation === "mixed" ? " is" : ""} megszólal`);
    if (roles.has("host")) clauses.push("műsorvezetőként beszélget");
    if (roles.has("speaker")) clauses.push("megszólal a kapcsolódó adásokban");
    lead = clauses.length ? `${name} ${clauses.join(", illetve ")}` : `${name}:`;
    if (roles.has("subject")) lead += `${clauses.length ? "; más adásokban" : " a kapcsolódó adásokban"} róla beszélnek`;
    if (roles.has("mention")) lead += `${clauses.length || roles.has("subject") ? "; más adásokban" : " a kapcsolódó adásokban"} megemlítik`;
    lead += ".";
  }
  const detail = context ? `Témák: ${context}.` : "";
  // A subtitle is already rendered by both callers. Only omit a role clause
  // when the subtitle explicitly states the SAME verified role, never for mixed evidence.
  const subtitleStatesRole = Boolean(identity) && (
    (relation === "guest" && /vend[eé]g/i.test(identity)) ||
    (relation === "host" && /műsorvezető|házigazda/i.test(identity))
  );
  const visibleShows = shows.filter(value => {
    const words = fold(value).split(/[^a-z0-9]+/).filter(word => word.length >= 4 && !["podcast", "podcastok", "musor", "radio"].includes(word));
    return !identity || !words.length || !words.every(word => fold(identity).includes(word));
  });
  const showText = shows.length ? `Kapcsolódó műsor${shows.length > 1 ? "ok" : ""}: ${shows.join(" és ")}.` : "";
  const visibleShowText = visibleShows.length ? `Kapcsolódó műsor${visibleShows.length > 1 ? "ok" : ""}: ${visibleShows.join(" és ")}.` : "";
  const example = !context && verified[0]?.title ? ` Kapcsolódó adás: „${short(plain(verified[0].title), 110)}”.` : "";
  const count = input.count > 0 ? ` ${input.count} kapcsolódó magyar epizód.` : "";
  const intro = [subtitleStatesRole ? "" : lead, detail, visibleShowText, example.trim()].filter(Boolean).join(" ");
  // Search snippets are standalone: material identity and totals may remain
  // here, but never in the visible paragraph next to its subtitle and counters.
  const description = short([identity ? `${identity.replace(/[.!?]$/, "")}.` : "", subtitleStatesRole ? "" : lead, detail, showText, count.trim()].filter(Boolean).join(" "), 160);
  return { title, description, intro, relation, topics, shows };
}