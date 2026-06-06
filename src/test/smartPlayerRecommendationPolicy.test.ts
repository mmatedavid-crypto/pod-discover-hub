import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SMART_PLAYER_RECOMMENDATIONS_ENABLED } from "@/components/smart-player/recommendationsConfig";

const root = process.cwd();
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");

describe("smart player recommendation policy", () => {
  it("keeps cross-podcast smart recommendations disabled until quality is trusted", () => {
    expect(SMART_PLAYER_RECOMMENDATIONS_ENABLED).toBe(false);

    const provider = read("src/components/smart-player/SmartPlayerProvider.tsx");
    const bar = read("src/components/smart-player/SmartPlayerBar.tsx");
    const episodePlayer = read("src/components/smart-player/EpisodeAudioPlayer.tsx");
    const similarPodcasts = read("src/components/SimilarPodcasts.tsx");
    const chapters = read("src/components/smart-player/SmartPlayerChapters.tsx");
    const locale = read("src/lib/playerLocale.ts");

    expect(provider).toContain("if (!SMART_PLAYER_RECOMMENDATIONS_ENABLED) return \"series\"");
    expect(provider).toContain("if (!SMART_PLAYER_RECOMMENDATIONS_ENABLED) return;");
    expect(bar).toContain("!error && SMART_PLAYER_RECOMMENDATIONS_ENABLED");
    expect(bar).toContain("SMART_PLAYER_RECOMMENDATIONS_ENABLED ? \"Kapcsolódó epizódok\" : \"Lejátszó részletei\"");
    expect(bar).toContain("SMART_PLAYER_RECOMMENDATIONS_ENABLED ? \"Kapcsolódó\" : \"Részletek\"");
    expect(bar).toContain("{SMART_PLAYER_RECOMMENDATIONS_ENABLED && (");
    expect(bar).toContain("SMART_PLAYER_RECOMMENDATIONS_ENABLED && (\n                  <div className=\"w-full max-w-3xl mt-2 border-t border-border pt-5\">");
    expect(episodePlayer).toContain("{SMART_PLAYER_RECOMMENDATIONS_ENABLED && (");
    expect(episodePlayer).toContain("Kapcsolódó epizódok");
    expect(episodePlayer).toContain("<SmartDiscoveryPanel episodeIdOverride={episode.id} variant=\"compact\" />");
    expect(similarPodcasts).toContain("SMART_PLAYER_RECOMMENDATIONS_ENABLED");
    expect(similarPodcasts).toContain("if (!SMART_PLAYER_RECOMMENDATIONS_ENABLED) return null");
    expect(bar).toContain("Podiverzum lejátszó");
    expect(chapters).toContain("Bevezető átugrása");
    expect(chapters).toContain("Ehhez az epizódhoz még nincsenek fejezetek.");
    expect(chapters).toContain("function safeChapterText");
    expect(chapters).toContain("sanitizeHungarianPublicText");
    expect(chapters).toContain("const title = safeChapterText(c.title) || `Fejezet ${i + 1}`");
    expect(chapters).toContain("const summary = safeChapterText(c.summary, 12)");
    expect(chapters).not.toContain("{c.title}");
    expect(chapters).not.toContain("{c.summary}");
    expect(locale).toContain('playbackError: "Lejátszási gond"');
    expect(bar).not.toContain("Smart ajánlások");
    expect(episodePlayer).not.toContain("Smart Player ajánlások");
    expect(chapters).not.toContain("Skip intro");
    expect(chapters).not.toContain("AI fejezetek");
  });

  it("keeps dormant related episodes ready for safe consumer-facing reactivation", () => {
    const related = read("src/components/smart-player/RelatedEpisodes.tsx");
    const similar = read("src/components/SimilarEpisodes.tsx");

    expect(related).toContain("id,podcast_id,title,display_title,slug,image_url");
    expect(related).toContain("if (!SMART_PLAYER_RECOMMENDATIONS_ENABLED) return []");
    expect(related).toContain("image_url: r.image_url");
    expect(related).toContain("imageUrl: r.image_url || r.podcast_image_url");
    expect(related).toContain("r.image_url || r.podcast_image_url");
    expect(related).toContain("related_reason?: string | null");
    expect(related).toContain("sanitizeHungarianPublicText(r.related_reason)");
    expect(related).toContain("Erős tartalmi kapcsolat más magyar műsorból");
    expect(related).not.toContain("epizód-index");
    expect(related).not.toContain("% tartalmi");
    expect(related).not.toContain("% hasonlóság");
    expect(related).not.toContain("imageUrl: r.podcast_image_url");
    expect(related).not.toContain("src={optimizedImageUrl(r.podcast_image_url");
    expect(similar).toContain("sanitizeHungarianPublicText(r.related_reason)");
    expect(similar).toContain("function hasSafeRelatedReason");
    expect(similar).toContain("hydrated.filter(hasSafeRelatedReason)");
    expect(similar).not.toContain("relatedReasonFromSimilarity");
  });

  it("keeps dormant smart discovery fallback on the accepted Hungarian catalog", () => {
    const discovery = read("src/components/smart-player/SmartDiscoveryPanel.tsx");
    const related = read("src/components/smart-player/RelatedEpisodes.tsx");

    expect(discovery).toContain("SMART_PLAYER_RECOMMENDATIONS_ENABLED");
    expect(discovery).toContain("if (!SMART_PLAYER_RECOMMENDATIONS_ENABLED) return []");
    expect(discovery).toContain("podcasts!inner(slug,title,display_title,image_url,category,language_decision,rss_status,rank_label)");
    expect(discovery).toContain('.eq("podcasts.language_decision", "accept_hungarian")');
    expect(discovery).not.toContain('.eq("podcasts.is_hungarian", true)');
    expect(discovery).not.toContain("category,is_hungarian,rss_status");
    expect(related).toContain("language_decision,rank_label");
    expect(related).toContain('.eq("podcasts.language_decision", "accept_hungarian")');
    expect(related).toContain('row.podcasts?.language_decision !== "accept_hungarian"');
    expect(related).not.toContain("is_hungarian");
  });

  it("keeps the DB compatibility policy hard-blocking religion/non-religion false positives", () => {
    const migration = read("supabase/migrations/20260605003000_recommendation_compatibility_v5_entity_bridge.sql");
    const reassertMigration = read("supabase/migrations/20260605203000_reassert_recommendation_compatibility_v5_content_bridge.sql");
    const diagnosticsMigration = read("supabase/migrations/20260605232000_reassert_similar_episode_diagnostics.sql");
    const surfaceLock = read("supabase/migrations/20260605224000_lock_smart_player_recommendation_surface.sql");

    expect(migration).toContain("recommendation_is_compatible");
    expect(migration).toContain("recommendation_has_content_bridge");
    expect(migration).toContain("p_source_group = 'religion'");
    expect(migration).toContain("p_candidate_group = 'religion'");
    expect(migration).toContain("THEN false");
    expect(migration).toContain("p_source_group <> 'general' AND p_candidate_group <> 'general' AND p_source_group <> p_candidate_group");
    expect(migration).toContain("THEN p_has_topic_bridge");
    expect(migration).toContain("'related_episode_quality_policy'");
    expect(migration).toContain("'religion_cross_group', 'hard_block'");
    expect(migration).toContain("'different_specific_groups', 'explicit_bridge_required'");
    expect(migration).toContain("'specific_to_general', 'explicit_bridge_required'");
    expect(migration).toContain("'bridge_sources', jsonb_build_array('topics', 'people', 'mentioned', 'companies')");
    expect(migration).toContain("'version', 5");
    expect(reassertMigration).toContain("recommendation_has_content_bridge");
    expect(reassertMigration).toContain("'public_affairs_override_terms'");
    expect(reassertMigration).toContain("production drift left the");
    expect(reassertMigration).toContain("GRANT EXECUTE ON FUNCTION public.recommendation_has_content_bridge");
    expect(diagnosticsMigration).toContain("recommendation_diagnostics_policy");
    expect(diagnosticsMigration).toContain("related_reason text");
    expect(diagnosticsMigration).toContain("Kapcsolódó személyek alapján.");
    expect(diagnosticsMigration).toContain("Kapcsolódó szervezet vagy márka alapján.");
    expect(diagnosticsMigration).toContain("Hasonló témák:");
    expect(diagnosticsMigration).toContain("public_surface_locked_until_quality_trusted");

    expect(surfaceLock).toContain("smart_player_recommendation_surface_policy");
    expect(surfaceLock).toContain("'enabled', false");
    expect(surfaceLock).toContain("quality_gate_required_before_public_enable");
    expect(surfaceLock).toContain("REVOKE EXECUTE ON FUNCTION public.get_related_episodes_by_embedding(uuid, integer, boolean) FROM PUBLIC, anon, authenticated");
    expect(surfaceLock).toContain("REVOKE EXECUTE ON FUNCTION public.similar_episodes(uuid, integer) FROM PUBLIC, anon, authenticated");
    expect(surfaceLock).toContain("REVOKE EXECUTE ON FUNCTION public.smart_player_discover(uuid, integer) FROM PUBLIC, anon, authenticated");
    expect(surfaceLock).toContain("GRANT EXECUTE ON FUNCTION public.get_related_episodes_by_embedding(uuid, integer, boolean) TO service_role");
  });
});
