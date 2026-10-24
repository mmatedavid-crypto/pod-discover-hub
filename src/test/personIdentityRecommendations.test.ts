import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { filterSafeRelatedEpisodes, isSafeRelatedEpisode, verifiedSharedPersonCount } from "@/lib/recommendationGuards";
import { personPageMentionRows } from "../../supabase/functions/_shared/person-link-trust";

const read = (p: string) => readFileSync(p, "utf8");

// Live case 2026-10-24: Aranyklinika urologist Dr. Király István (accepted, reviewed link)
// vs. a Hermann Zeneiskola music director and a chamber-music episode with the same name
// (pending, unreviewed). Same display name, different people.
const KIRALY = "17b234eb-46fc-474b-9378-4dc8da17329b";
const urologist = {
  title: "Folyó ügyeink – urológiáról – nem csak férfiaknak! | Aranyklinika Podcast 17. rész",
  podcastTitle: "Aranyklinika Podcast",
  category: "Health & Fitness",
  topics: ["urológia", "férfiegészség"],
  people: ["Király István"],
  verifiedPersonIds: [KIRALY],
  companies: [],
};
const musicDirector = {
  title: "Vendégünk Király István a Hermann Zeneiskola igazgatója, nagybőgőművész",
  podcastTitle: "Zenei beszélgetések",
  category: "Music",
  topics: ["zeneoktatás"],
  people: ["Király István"],
  verifiedPersonIds: [], // the mention is pending — no verified link
  companies: [],
  similarity: 0.55,
};

describe("verified person identity in recommendations", () => {
  it("excludes the urologist vs music-director namesake pair as a person-only match", () => {
    expect(verifiedSharedPersonCount(urologist, musicDirector)).toBe(0);
    expect(isSafeRelatedEpisode(urologist, musicDirector)).toBe(false);
    expect(isSafeRelatedEpisode(urologist, { ...musicDirector, title: "X. Országos Kamarazene Verseny", topics: ["kamarazene"] })).toBe(false);
  });

  it("keeps an accepted, verified same-person pair", () => {
    const sameDoctor = { ...musicDirector, title: "Prosztata és megelőzés", category: "Health & Fitness", topics: [], verifiedPersonIds: [KIRALY], similarity: 0.3 };
    expect(verifiedSharedPersonCount(urologist, sameDoctor)).toBe(1);
    expect(isSafeRelatedEpisode(urologist, sameDoctor)).toBe(true);
    // server-verified shared names (smart_player_discover / get_shared_verified_people_v1)
    expect(isSafeRelatedEpisode(urologist, { ...musicDirector, category: "Health & Fitness", topics: [], verifiedPersonIds: [], sharedPeople: ["Király István"], similarity: 0.3 })).toBe(true);
  });

  it("keeps shared-topic recommendations unaffected", () => {
    const topicPeer = { ...musicDirector, title: "Urológiai szűrés", category: "Health & Fitness", topics: ["urológia"], people: [], similarity: 0.3 };
    expect(isSafeRelatedEpisode(urologist, topicPeer)).toBe(true);
    const ranked = filterSafeRelatedEpisodes(urologist, [musicDirector, topicPeer], 5);
    expect(ranked.map((r) => r.title)).toEqual(["Urológiai szűrés"]);
  });
});

describe("person page link trust", () => {
  const rows = [
    { id: "uro", relevance_status: "accepted", validation_source: "person_openai_batch_v1", role_type: "participant" },
    { id: "music-director", relevance_status: "pending", validation_source: null, role_type: "participant" },
    { id: "chamber-music", relevance_status: "pending", validation_source: null, role_type: "participant" },
    { id: "accepted-unreviewed", relevance_status: "accepted", validation_source: "   ", role_type: "participant" },
    { id: "rejected", relevance_status: "rejected", validation_source: "ai", role_type: "participant" },
    { id: "needs-review", relevance_status: "needs_review", validation_source: "person_openai_batch_v1", role_type: "subject" },
    { id: "reviewed-mention", relevance_status: "accepted", validation_source: "ai", role_type: "mention" },
  ];

  it("keeps known namesakes off a person verified elsewhere (absent, not demoted)", () => {
    const out = personPageMentionRows(rows, { personHasVerifiedLink: true });
    expect(out.map((r) => r.row.id)).toEqual(["uro", "reviewed-mention"]);
    expect(out.map((r) => r.role)).toEqual(["participant", "mention"]);
    expect(out.map((r) => r.row.id)).not.toContain("music-director");
    expect(out.map((r) => r.row.id)).not.toContain("chamber-music");
  });

  it("treats a blank review record as unreviewed", () => {
    const out = personPageMentionRows([rows[3]], { personHasVerifiedLink: false });
    expect(out).toEqual([{ row: rows[3], role: "mention", verified: false }]);
  });

  it("without any verified link, unreviewed rows are mentions only, never participants", () => {
    const out = personPageMentionRows(rows.filter((r) => r.relevance_status !== "accepted"), { personHasVerifiedLink: false });
    expect(out.map((r) => [r.row.id, r.role])).toEqual([["music-director", "mention"], ["chamber-music", "mention"]]);
  });
});

describe("raw names never create person links (static)", () => {
  it("fallback, episode page and prerender resolve people through verified links", () => {
    const related = read("src/components/smart-player/RelatedEpisodes.tsx");
    expect(related).not.toContain('.overlaps("people"');
    expect(related).not.toContain("sharedValues(source.people");
    expect(related).toContain("get_shared_verified_people_v1");
    const similar = read("src/components/SimilarEpisodes.tsx");
    expect(similar).toContain("get_shared_verified_people_v1");
    const episode = read("src/pages/EpisodeDetail.tsx");
    expect(episode).toContain("get_episode_person_links_v1");
    expect(episode).not.toContain('.in("name", peopleNames)');
    expect(episode).toContain("verifiedPeople.map((row) => buildPersonJsonLd(row, origin))");
    const prerender = read("supabase/functions/prerender/index.ts");
    expect(prerender).toContain("get_episode_person_links_v1");
    expect(prerender).not.toContain('.in("name", episodePeopleNames)');
    expect(prerender).toContain("personPageMentionRows(");
    const guards = read("src/lib/recommendationGuards.ts");
    expect(guards).not.toContain("overlaps(source.people");
    expect(guards).not.toContain("...(ctx.people || [])");
  });

  it("episode-card person chips resolve per episode in one batch", () => {
    const hook = read("src/hooks/useLinkableEntities.ts");
    expect(hook).toContain('rpc("get_linkable_episode_people_v1", { p_episode_ids: episodeIds })');
    expect(hook).toContain("pendingEpisodePeople");
    const card = read("src/components/EpisodeCard.tsx");
    expect(card.match(/\{ episodeId: e\.id \}/g)?.length).toBe(2);
    const prerender = read("supabase/functions/prerender/index.ts");
    expect(prerender).toContain("{ personHasVerifiedLink: hasVerified === true }");
    const page = read("src/pages/PersonDetailPage.tsx");
    expect(page).toContain('rpc("person_has_verified_link_v1"');
    const sql = read("drizzle/migrations/0087_person_link_review_nonblank_and_episode_chips.sql");
    expect(sql).toContain("nullif(btrim(coalesce(p_validation_source, '')), '') IS NOT NULL");
    expect(sql).toContain("NOT public.person_has_verified_link_v1(m.person_id, m.episode_id)");
  });

  it("recommendation RPCs score and explain only verified shared person ids", () => {
    const sql = read("drizzle/migrations/0083_verified_person_identity_recommendations.sql");
    expect(sql).toContain("public.verified_person_overlap_v1(src_person_ids, e.id)");
    expect(sql).toContain("public.verified_person_overlap_v1(src_person_ids, c.eid)");
    expect(sql).toContain("src_people := ARRAY[]::text[];");
    expect(sql).toContain("public.person_link_trusted_v1(pem.person_id, pem.validation_source)");
    expect(sql).toContain("m.validation_source IS NOT NULL");
    expect(sql).toContain("runner_pause_reason_v1");
    expect(sql).toContain("Daily dispatch cap reached");
  });
});
