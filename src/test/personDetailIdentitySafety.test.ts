import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isUsefulPersonIdentityLabel } from "@/components/PersonCard";

const root = process.cwd();
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");

describe("person detail identity safety", () => {
  it("hides generic machine labels that do not help identify a person", () => {
    expect(isUsefulPersonIdentityLabel("Nemzetközi téma személy")).toBe(false);
    expect(isUsefulPersonIdentityLabel("Személy")).toBe(false);
    expect(isUsefulPersonIdentityLabel("Podcastokban említett személy")).toBe(false);
  });

  it("keeps specific disambiguation labels", () => {
    expect(isUsefulPersonIdentityLabel("Hold Alapkezelő alapítója")).toBe(true);
    expect(isUsefulPersonIdentityLabel("sport- és életmód szakértő")).toBe(true);
  });

  it("keeps person detail pages from presenting generic fallback text as biography", () => {
    const page = read("src/pages/PersonDetailPage.tsx");

    expect(page).toContain("personCollectionIntro");
    expect(page).toContain("Podcastokban");
    expect(page).toContain("const introText = personCollectionIntro(person.name, eps.length)");
    expect(page).toContain("function safePersonIdentityLabel");
    expect(page).toContain("sanitizeHungarianPublicText(label || \"\") || null");
    expect(page).toContain("const identityLabel = safePersonIdentityLabel(person.disambiguation_label)");
    expect(page).not.toContain("const identityLabel = isUsefulPersonIdentityLabel(person.disambiguation_label)");
    expect(page).toContain("description: safeDesc");
    expect(page).not.toContain('text-primary">Személy</div>');
    expect(page).not.toContain("(eps.length > 0 ? huFallbackBio(person.name) : null)");
    expect(page).not.toContain("Forrás: Wikipedia");
    expect(page).not.toContain("const bioText =");
    expect(page).not.toContain("description: bio || undefined");
  });

  it("keeps person episode lists open to accepted Hungarian shows and AI-summary aware", () => {
    const page = read("src/pages/PersonDetailPage.tsx");

    expect(page).toContain("published_at, ai_summary, summary, description");
    expect(page).toContain('.eq("podcasts.language_decision", "accept_hungarian")');
    expect(page).toContain('.eq("episodes.podcasts.language_decision", "accept_hungarian")');
    expect(page).not.toContain('.eq("podcasts.is_hungarian", true)');
    expect(page).not.toContain('.eq("episodes.podcasts.is_hungarian", true)');
  });

  it("keeps related person links identity-safe and indexable", () => {
    const page = read("src/pages/PersonDetailPage.tsx");

    expect(page).toContain("Kapcsolódó személyek");
    expect(page).toContain("persona, is_topic_only, date_of_death, is_living, participant_count, host_count, guest_count");
    expect(page).toContain('.eq("is_indexable", true)');
    expect(page).toContain("const safeRelated = ((rel || []) as any[]).filter");
    expect(page).toContain('r.activation_status === "inactive"');
    expect(page).toContain('["hide", "reject"].includes(r.ai_recommended_action || "")');
    expect(page).toContain('["needs_human_review", "duplicate_candidate"].includes(r.ai_review_status || "")');
    expect(page).toContain('r.identity_status === "split_resolved"');
    expect(page).toContain("if (isTemporalTopicOnlyPerson(r)) return false");
    expect(page).toContain("r.identity_ambiguous && !r.manual_approved && !trustedWiki");
    expect(page).not.toContain('from("people").select("slug, name").eq("is_public", true).in("name", topNames)');
  });

  it("does not resurrect hidden historical or company-eponym people through fallback arrays", () => {
    const page = read("src/pages/PersonDetailPage.tsx");

    expect(page).toContain("editorial_notes");
    expect(page).toContain("function isTemporalTopicOnlyPerson");
    expect(page).toContain("const historicalWithoutEvidence = isTemporalTopicOnlyPerson(pp)");
    expect(page).toContain('person.persona === "historical"');
    expect(page).toContain("if (person.date_of_death || person.is_living === false) return true");
    expect(page).not.toContain("(person.date_of_death || person.is_living === false) && (hasVerifiedWiki(person) || !hasPodcastPersonEvidence(person))");
    expect(page).not.toContain("person.date_of_death || person.is_living === false) && !hasPodcastPersonEvidence");
    expect(page).toContain("const hiddenCompanyEponym = Boolean(pp)");
    expect(page).toContain("hidden_as_company_eponym_without_podcast_person_evidence");
    expect(page).toContain("if (historicalWithoutEvidence || hiddenCompanyEponym)");
    expect(page).toContain("setNotFound(true)");
    expect(page).toContain('id: `fallback-${decodedSlug}`');
    expect(page).toContain('const fallbackRelation = "említve"');
    expect(page).toContain('const fallbackDescriptionRelation = "említve szerepel"');
    expect(page).not.toContain('const fallbackRelation = sorted.some');
    expect(page).toContain('`${exemplar} – ${fallbackEpCount} podcast epizódban ${fallbackRelation} | Podiverzum`');
    expect(page).toContain("Megnézhető ${fallbackEpCount} podcast epizód, amelyben ${exemplar} ${fallbackDescriptionRelation}.");
  });

  it("keeps prerendered person SEO identity-safe for ambiguous or historical names", () => {
    const prerender = read("supabase/functions/prerender/index.ts");

    expect(prerender).toContain("function hasTrustedPersonIdentity");
    expect(prerender).toContain("function safePersonImageForPrerender");
    expect(prerender).toContain("person.identity_ambiguous && !hasTrustedPersonIdentity(person)");
    expect(prerender).toContain('person.persona === "historical"');
    expect(prerender).toContain("|| Boolean(person.date_of_death)");
    expect(prerender).toContain("|| person.is_living === false");
    expect(prerender).not.toContain("trustedWiki || !hasPodcastPersonEvidence");
    expect(prerender).toContain("|| historicalWithoutEvidence");
    expect(prerender).toContain('trustedIdentity ? {');
    expect(prerender).toContain('"@type": "Person"');
    expect(prerender).toContain('"@type": "CollectionPage"');
    expect(prerender).toContain("if (safeImage && trustedIdentity) personLd.image = safeImage");
    expect(prerender).toContain("ogImage: safeImage");
    expect(prerender).not.toContain("ogImage: person.image_url");
    expect(prerender).not.toContain("if (person.image_url) personLd.image = person.image_url");
  });
});
