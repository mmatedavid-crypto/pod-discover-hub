import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { getSupabase, json, err } from "../supabase";
import { PERSON_JSONLD_SELECT, isSafeIndexablePerson } from "../../personSchema";
import {
  clampEvidencePhrase,
  episodeUrl,
  isPublicHungarianPodcast,
  isPublicOrganizationRow,
  isSafePersonMentionRow,
  organizationUrl,
  parseEpisodeRef,
  personUrl,
  podcastUrl,
  stripForbidden,
  topicUrl,
} from "../entityResolve";

const EPISODE_SELECT =
  "id,title,display_title,slug,published_at,duration_seconds,summary,ai_summary,description,podcast_id,podcasts!inner(id,slug,title,display_title,language,language_decision,rss_status)";

export default defineTool({
  name: "get_episode_context",
  title: "Epizód publikus kontextus",
  description:
    "Egy Podiverzum epizód biztonságos, publikus kontextusa (összefoglaló, személyek, szervezetek, témák) grounding célra. Átiratot vagy átirat-részletet NEM ad vissza.",
  inputSchema: {
    episode: z
      .string()
      .trim()
      .min(3)
      .describe(
        "Epizód azonosító (UUID) VAGY Podiverzum URL / 'podcast-slug/epizod-slug' útvonal (pl. https://podiverzum.hu/podcast/partizan-podcast/valami).",
      ),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ episode }) => {
    try {
      const sb = getSupabase();
      const ref = parseEpisodeRef(episode);
      let row: Record<string, any> | null = null;

      if (ref.id) {
        const { data, error } = await sb.from("episodes").select(EPISODE_SELECT).eq("id", ref.id).maybeSingle();
        if (error) return err(error.message);
        row = data as any;
      } else if (ref.episodeSlug) {
        let q = sb.from("episodes").select(EPISODE_SELECT).eq("slug", ref.episodeSlug).limit(5);
        if (ref.podcastSlug) q = q.eq("podcasts.slug", ref.podcastSlug);
        const { data, error } = await q;
        if (error) return err(error.message);
        row = ((data as any[]) || [])[0] || null;
      }

      if (!row) return err(`Epizód nem található: ${episode}`);
      if (!isPublicHungarianPodcast(row.podcasts)) return err("Az epizód nem része a publikus magyar katalógusnak.");

      const [{ data: personRows }, { data: orgRows }, { data: topicRows }, { data: transcriptRows }, { data: linkRows }] =
        await Promise.all([
          sb
            .from("person_episode_mentions")
            .select(
              `mention_type,role_type,confidence,role_confidence,final_relevance_score,relevance_status,validation_source,evidence,people!inner(${PERSON_JSONLD_SELECT})`,
            )
            .eq("episode_id", row.id)
            .or("relevance_status.is.null,relevance_status.neq.rejected")
            .order("final_relevance_score", { ascending: false, nullsFirst: false })
            .limit(40),
          sb
            .from("episode_organization_map")
            .select("role,confidence,source_evidence,organizations!inner(id,name,slug,org_type,is_public,is_indexable,ai_recommended_action)")
            .eq("episode_id", row.id)
            .gte("confidence", 0.6)
            .order("confidence", { ascending: false, nullsFirst: false })
            .limit(20),
          sb
            .from("episode_topic_map")
            .select("confidence,topics!inner(id,name,slug,is_public)")
            .eq("episode_id", row.id)
            .order("confidence", { ascending: false, nullsFirst: false })
            .limit(20),
          sb.from("episode_transcripts").select("public_display").eq("episode_id", row.id).limit(1),
          // Same per-episode identity gate as the public episode page: a name match is not
          // the same person; only people this RPC returns may be linked, verified flag says
          // whether the link was reviewed.
          sb.rpc("get_episode_person_links_v1", { p_episode_id: row.id }),
        ]);

      const linkable = new Map<string, boolean>(
        ((linkRows as any[]) || []).map((l) => [String(l.person_id), l.verified === true]),
      );
      const people = ((personRows as any[]) || [])
        .filter((m) => isSafePersonMentionRow(m) && !isExcludedPersonMention(m) && isSafeIndexablePerson(m.people))
        .filter((m) => linkable.has(String(m.people.id)))
        .map((m) => {
          const verified = linkable.get(String(m.people.id)) === true && isVerifiedPersonMention(m);
          return {
            id: m.people.id,
            name: m.people.name,
            slug: m.people.slug,
            url: personUrl(m.people.slug),
            mention_type: verified ? m.mention_type : "mention",
            role_type: verified ? m.role_type : "mention",
            identity_verified: verified,
            confidence: m.role_confidence ?? m.confidence ?? null,
            evidence_phrase: clampEvidencePhrase(m.evidence, 160),
            evidence_kind: "extracted_metadata",
          };
        });

      const organizations = ((orgRows as any[]) || [])
        .filter((m) => isPublicOrganizationRow(m.organizations))
        .map((m) => ({
          id: m.organizations.id,
          name: m.organizations.name,
          slug: m.organizations.slug,
          org_type: m.organizations.org_type,
          url: organizationUrl(m.organizations.slug),
          role: m.role,
          confidence: m.confidence ?? null,
          evidence_phrase: clampEvidencePhrase(m?.source_evidence?.evidence, 160),
          evidence_kind: "extracted_metadata",
        }));

      const topics = ((topicRows as any[]) || [])
        .filter((t) => t.topics && t.topics.is_public === true && t.topics.is_indexable === true)
        .map((t) => ({
          id: t.topics.id,
          name: t.topics.name,
          slug: t.topics.slug,
          url: topicUrl(t.topics.slug),
          confidence: t.confidence ?? null,
        }));

      const transcriptPublic = ((transcriptRows as any[]) || [])[0]?.public_display === true;
      const summary = row.ai_summary || row.summary || row.description || "";

      return json(
        stripForbidden({
          episode: {
            id: row.id,
            title: row.display_title || row.title,
            slug: row.slug,
            published_at: row.published_at,
            duration_seconds: row.duration_seconds ?? null,
            summary: clampEvidencePhrase(summary, 1200),
            url: episodeUrl(row.podcasts?.slug, row.slug),
          },
          podcast: {
            id: row.podcasts?.id,
            title: row.podcasts?.display_title || row.podcasts?.title,
            slug: row.podcasts?.slug,
            url: podcastUrl(row.podcasts?.slug),
          },
          people,
          organizations,
          topics,
          transcript_available_for_public_display: transcriptPublic,
          transcript_notice:
            "Átirat-tartalom ebben a fázisban semmilyen esetben nem kerül visszaadásra; az evidence_phrase entitás-kinyerésből származó metaadat.",
        }),
      );
    } catch (e: any) {
      return err(e?.message || "unknown error");
    }
  },
});
