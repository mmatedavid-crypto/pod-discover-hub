// Person JSON-LD builder for episode pages.
// Only emits schema for people that pass the same safety gate the prerender
// uses — verified identity / not ambiguous / not hidden — so we never claim
// authorship or "mention" for a person we're not confident about.

export const PERSON_JSONLD_SELECT =
  "id,name,slug,image_url,wikipedia_url,wikidata_id,wikipedia_match_status,wikipedia_match_confidence,is_public,is_indexable,activation_status,ai_recommended_action,ai_review_status,identity_status,identity_ambiguous,manual_approved,is_deceased,is_historical,has_archival_evidence,persona,date_of_death,is_living,gated_episode_count,episode_count,short_description_hu,wikipedia_description,ai_bio,ai_bio_status,ai_bio_confidence";

type P = Record<string, any>;

function hasVerifiedWiki(p: P) {
  return p.wikipedia_match_status === "verified" && Number(p.wikipedia_match_confidence || 0) >= 0.8;
}
function hasTrustedIdentity(p: P) {
  return p.manual_approved === true || hasVerifiedWiki(p);
}

export function isSafeIndexablePerson(p: P | null | undefined): boolean {
  if (!p) return false;
  if (p.is_public === false || p.is_indexable === false) return false;
  if (!["indexable", "manual_approved", null, undefined].includes(p.activation_status)) return false;
  if (["hide", "reject"].includes(String(p.ai_recommended_action || ""))) return false;
  if (["needs_human_review", "duplicate_candidate"].includes(String(p.ai_review_status || ""))) return false;
  if (p.identity_status === "split_resolved") return false;
  if (p.identity_ambiguous && !hasTrustedIdentity(p)) return false;
  const temporalOnly =
    p.has_archival_evidence !== true &&
    p.manual_approved !== true &&
    (p.is_deceased === true || p.is_historical === true || p.persona === "historical" || Boolean(p.date_of_death) || p.is_living === false);
  if (temporalOnly) return false;
  return Number(p.gated_episode_count || p.episode_count || 0) >= 1;
}

function safeBio(p: P): string | undefined {
  const aiBio = typeof p.ai_bio === "string" ? p.ai_bio.trim() : "";
  const aiBioSafe = p.ai_bio_status === "published" && Number(p.ai_bio_confidence || 0) >= 0.75 ? aiBio : "";
  const src = aiBioSafe || p.wikipedia_description || p.short_description_hu || "";
  const s = String(src || "").trim();
  return s ? s.slice(0, 250) : undefined;
}

export function buildPersonJsonLd(p: P, origin: string) {
  const sameAs: string[] = [];
  if (typeof p.wikipedia_url === "string" && p.wikipedia_url) sameAs.push(p.wikipedia_url);
  if (typeof p.wikidata_id === "string" && p.wikidata_id) sameAs.push(`https://www.wikidata.org/wiki/${p.wikidata_id}`);
  const url = p.slug ? `${origin}/szemelyek/${p.slug}` : undefined;
  const image = typeof p.image_url === "string" && p.image_url ? p.image_url : undefined;
  const desc = safeBio(p);
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": url,
    name: p.name,
    url,
    ...(image ? { image } : {}),
    ...(desc ? { description: desc } : {}),
    ...(sameAs.length ? { sameAs } : {}),
  };
}

/** Compact `{ @type:Person, name, url }` for use inside NewsArticle.mentions / about. */
export function personMentionRef(p: P, origin: string) {
  const url = p.slug ? `${origin}/szemelyek/${p.slug}` : undefined;
  return { "@type": "Person", name: p.name, ...(url ? { url } : {}) };
}
