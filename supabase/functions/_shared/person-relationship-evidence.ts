// Input eligibility only. A short credit admits a request, never accepts a person.
import { cleanRoleField, foldKeepLength, usableRoleNames } from './person-role-label.ts';
import type { EpisodeInput, Source } from './episode-enrichment-batch.ts';

export const normalizeEvidence = (s: unknown) => String(s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
const fold = (s: string) => foldKeepLength(normalizeEvidence(s)).toLowerCase();
const escapeRE = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function containsCandidateName(text: string, person: EpisodeInput['people'][number]) {
  return usableRoleNames(person.name, person.aliases).some(n =>
    new RegExp(`(?<![\\p{L}\\p{N}])${escapeRE(fold(n))}(?![\\p{L}\\p{N}-])`, 'u').test(fold(text)));
}
const CREDIT = /(?:^|[\s;|])(?:vendeg(?:unk|ek)?|musorvezeto(?:k)?|hazigazda|eloado|felolvasta|narrator|szerzo|szerkeszto|keszitette)\s*:\s*([^:;|\n]{3,180})/giu;
const OTHER_EPISODE = /\b(?:elozo|korabbi|kovetkezo|jovo heti|mult heti|ajanlo|archivum)\b/;
export function shortNamedCredit(input: EpisodeInput, source: Source) {
  const text = foldKeepLength(cleanRoleField(source.text)).toLowerCase();
  if (Array.from(normalizeEvidence(text)).length < 15 || text.length >= 100 || OTHER_EPISODE.test(text)) return false;
  for (const m of text.matchAll(CREDIT)) {
    // Restrict to the role's own value; never consume the next crew label.
    const value = m[1].split(/\b(?:szerkeszto|vago|zene|producer|foto|keszitette|vendeg|musorvezeto|eloado|felolvasta)\b/)[0];
    if (input.people.some(p => containsCandidateName(value, p))) return true;
  }
  return false;
}
export function episodeSourceEligible(input: EpisodeInput) {
  return input.sources.some(s => s.scope === 'episode' &&
    (s.text.length >= 100 || shortNamedCredit(input, s) ||
      (s.kind === 'episode_title' && /\binterju\b/.test(fold(s.text)) &&
       !OTHER_EPISODE.test(fold(s.text)) && input.people.some(p => containsCandidateName(s.text, p)))));
}
