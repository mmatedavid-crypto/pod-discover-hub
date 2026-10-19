// Shared by hybrid and browser fallback search. A name must occur together in
// one field (or one people entry); bags of words never establish name identity.
export function foldSearchName(value: string): string {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isNameShapedQuery(query: string): boolean {
  const words = query.trim().split(/\s+/);
  return words.length >= 2 && words.length <= 4
    && words.every((word) => /^[\p{L}.'’\-]+$/u.test(word))
    && words.filter((word) => /^\p{Lu}/u.test(word)).length >= 2;
}

export function createFullNameMatcher(names: string[]) {
  const patterns = [...new Set(names.map(foldSearchName))].flatMap((name) => {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length < 2 || parts.length > 4 || !parts.every((p) => /^[\p{L}.'’\-]+$/u.test(p))) return [];
    const last = parts.pop()!;
    // Conservative Hungarian case endings, including assimilation (Andrással,
    // Viktorral, Egonnal). No arbitrary prefix/stem matching (András != Andrási).
    const endings = ["", "val", "vel", "rol", "bol", "tol", "nal", "nel", "nak", "nek", "ban", "ben", "hoz", "hez", "ra", "re", "on", "en", "ot", "et", "t", "ert"];
    const forms = endings.map((ending) => last + ending);
    const consonant = last.match(/(?:dzs|cs|dz|gy|ly|ny|sz|ty|zs|[bcdfghjklmnpqrstvwxyz])$/)?.[0];
    if (consonant) {
      const stem = last.slice(0, -consonant.length);
      const doubled = stem.endsWith(consonant[0]) ? consonant : consonant[0] + consonant;
      forms.push(`${stem}${doubled}al`, `${stem}${doubled}el`);
    }
    // Vowel lengthening disappears under accent folding: Magdával -> magdaval.
    const prefix = parts.map((part) => escapeRegex(part).replace(/\\\.$/, "\\.?" )).join("\\s+");
    return [new RegExp(`(?:^|[^\\p{L}\\p{N}])${prefix}\\s+(?:${[...new Set(forms)].map(escapeRegex).join("|")})(?=$|[^\\p{L}\\p{N}])`, "u")];
  });
  return (value: unknown): boolean => typeof value === "string" && patterns.some((pattern) => pattern.test(
    foldSearchName(value.replace(/<\/?(?:b|strong|em|i|span)(?:\s[^>]*)?>/gi, "").replace(/<[^>]*>/g, " | ").replace(/&nbsp;|&#160;|&#x0*a0;/gi, " ")),
  ));
}

export type NameSearchEpisode = {
  id?: string; title?: string; display_title?: string; people?: string[];
  description?: string; summary?: string; ai_summary?: string;
};

export function nameEvidenceTier(episode: NameSearchEpisode, matches: (value: unknown) => boolean): number {
  if ([episode.title, episode.display_title].some(matches)) return 3;
  if ((episode.people || []).some(matches)) return 2;
  if ([episode.description, episode.summary, episode.ai_summary].some(matches)) return 1;
  return 0;
}

// Run after reranking, diversity and pins so none can promote a split-name hit.
// Existing order is retained within each evidence tier. A text mention does not
// assert that the person is a speaking guest; it is only search evidence.
export function rankFullNameMatches<T extends NameSearchEpisode>(
  episodes: T[], names: string[], options: {
    strict?: boolean; acceptedEpisodeIds?: ReadonlySet<string>; cleanTextEpisodeIds?: ReadonlySet<string>;
  } = {},
): T[] {
  const matches = createFullNameMatcher(names);
  return episodes.map((episode, index) => ({
    episode, index,
    tier: Math.max(nameEvidenceTier(episode, matches),
      options.acceptedEpisodeIds?.has(episode.id || "") ? 2 : 0,
      options.cleanTextEpisodeIds?.has(episode.id || "") ? 1 : 0),
  })).filter(({ tier }) => !options.strict || tier > 0)
    .sort((a, b) => b.tier - a.tier || a.index - b.index)
    .map(({ episode }) => episode);
}

// Indexed candidate retrieval is deliberately broader than the final matcher:
// the last token prefix admits Hungarian suffixes; final verification rejects
// other names, cross-field adjacency and arbitrary prefix matches.
export function fullNameTsQuery(name: string): string | null {
  const tokens = foldSearchName(name).match(/[a-z0-9]+/g) || [];
  if (tokens.length < 2 || tokens.length > 4) return null;
  return tokens.map((token, i) => `${token}${i === tokens.length - 1 ? ":*" : ""}`).join(" <-> ");
}
