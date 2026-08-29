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
  normalizeEntityText,
  organizationUrl,
  personUrl,
  podcastUrl,
  stripForbidden,
} from "../entityResolve";

const ORG_SELECT =
  "id,name,slug,normalized_name,is_public,is_indexable,org_type,ai_recommended_action,episode_count,gated_episode_count";

type Sb = ReturnType<typeof getSupabase>;

async function resolvePerson(sb: Sb, norm: string) {
  const { data: exact } = await sb.from("people").select(PERSON_JSONLD_SELECT).eq("normalized_name", norm).limit(5);
  let rows = (exact || []).filter(isSafeIndexablePerson);
  if (!rows.length) {
    const { data: aliases } = await sb
      .from("person_aliases")
      .select("person_id, confidence")
      .eq("status", "accepted")
      .eq("normalized_alias", norm)
      .limit(10);
    const ids = (aliases || []).map((a: any) => a.person_id).filter(Boolean);
    if (ids.length) {
      const { data: aliasPeople } = await sb.from("people").select(PERSON_JSONLD_SELECT).in("id", ids);
      rows = (aliasPeople || []).filter(isSafeIndexablePerson);
    }
  }
  if (!rows.length) return null;
  rows.sort(
    (a: any, b: any) =>
      Number(b.gated_episode_count || b.episode_count || 0) - Number(a.gated_episode_count || a.episode_count || 0),
  );
  return rows[0] as Record<string, any>;
}

async function resolveOrganization(sb: Sb, norm: string) {
  const { data: exact } = await sb.from("organizations").select(ORG_SELECT).eq("normalized_name", norm).limit(5);
  let rows = (exact || []).filter(isPublicOrganizationRow);
  if (!rows.length) {
    const { data: aliases } = await sb
      .from("organization_aliases")
      .select("organization_id")
      .eq("status", "accepted")
      .eq("normalized_alias", norm)
      .limit(10);
    const ids = (aliases || []).map((a: any) => a.organization_id).filter(Boolean);
    if (ids.length) {
      const { data: aliasOrgs } = await sb.from("organizations").select(ORG_SELECT).in("id", ids);
      rows = (aliasOrgs || []).filter(isPublicOrganizationRow);
    }
  }
  if (!rows.length) return null;
  rows.sort(
    (a: any, b: any) =>
      Number(b.gated_episode_count || b.episode_count || 0) - Number(a.gated_episode_count || a.episode_count || 0),
  );
  return rows[0] as Record<string, any>;
}

const EPISODE_JOIN =
  "episodes!inner(id,title,display_title,slug,published_at,podcast_id,podcasts!inner(id,slug,title,display_title,language,language_decision,rss_status))";

export default defineTool({
  name: "find_mentions",
  title: "Említések keresése (személy / szervezet)",
  description:
    "Megkeresi azokat a magyar podcast epizódokat, amelyekben egy kanonikus, publikus személy vagy szervezet említésre kerül. Rövid, metaadatból kinyert bizonyíték-kifejezést ad (NEM szó szerinti átirat-idézetet) és publikus Podiverzum URL-eket a hivatkozáshoz.",
  inputSchema: {
    entity: z.string().trim().min(2).describe("Személy vagy szervezet neve (ékezetek/kisbetű mindegy)."),
    entity_type: z
      .enum(["auto", "person", "organization"])
      .optional()
      .describe("Entitás típusa (alap: auto — a legerősebb biztonságos találat)."),
    date_from: z.string().trim().min(4).optional().describe("Legkorábbi megjelenés ISO dátumként (pl. 2026-01-01)."),
    date_to: z.string().trim().min(4).optional().describe("Legkésőbbi megjelenés ISO dátumként."),
    limit: z.number().int().min(1).max(30).optional().describe("Max találat (alap: 10)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ entity, entity_type, date_from, date_to, limit }) => {
    try {
      const sb = getSupabase();
      const lim = limit ?? 10;
      const norm = normalizeEntityText(entity);
      if (!norm) return err("Nem értelmezhető entitásnév.");
      const wanted = entity_type ?? "auto";

      const person = wanted === "organization" ? null : await resolvePerson(sb, norm);
      const org = wanted === "person" ? null : await resolveOrganization(sb, norm);

      let kind: "person" | "organization" | null = null;
      if (person && org) {
        const pc = Number(person.gated_episode_count || person.episode_count || 0);
        const oc = Number(org.gated_episode_count || org.episode_count || 0);
        kind = pc >= oc ? "person" : "organization";
      } else if (person) kind = "person";
      else if (org) kind = "organization";

      if (!kind) {
        return json({
          resolved: false,
          query: entity,
          message: "Nincs kanonikus, publikus személy vagy szervezet erre a névre a Podiverzum katalógusban.",
        });
      }

      const items: Record<string, unknown>[] = [];

      if (kind === "person" && person) {
        let q = sb
          .from("person_episode_mentions")
          .select(
            `id,mention_type,role_type,confidence,role_confidence,final_relevance_score,relevance_status,source,evidence,${EPISODE_JOIN}`,
          )
          .eq("person_id", person.id)
          .or("relevance_status.is.null,relevance_status.neq.rejected")
          .order("final_relevance_score", { ascending: false, nullsFirst: false })
          .limit(lim * 3);
        if (date_from) q = q.gte("episodes.published_at", date_from);
        if (date_to) q = q.lte("episodes.published_at", date_to);
        const { data, error } = await q;
        if (error) return err(error.message);
        for (const m of (data as any[]) || []) {
          if (!isSafePersonMentionRow(m)) continue;
          const ep = m.episodes;
          if (!ep || !isPublicHungarianPodcast(ep.podcasts)) continue;
          items.push({
            episode: {
              id: ep.id,
              title: ep.display_title || ep.title,
              slug: ep.slug,
              published_at: ep.published_at,
              url: episodeUrl(ep.podcasts?.slug, ep.slug),
            },
            podcast: {
              id: ep.podcasts?.id,
              title: ep.podcasts?.display_title || ep.podcasts?.title,
              slug: ep.podcasts?.slug,
              url: podcastUrl(ep.podcasts?.slug),
            },
            mention_type: m.mention_type,
            role_type: m.role_type,
            confidence: m.role_confidence ?? m.confidence ?? null,
            relevance_score: m.final_relevance_score ?? null,
            source: m.source,
            evidence_phrase: clampEvidencePhrase(m.evidence, 240),
            evidence_kind: "extracted_metadata",
          });
          if (items.length >= lim) break;
        }
      } else if (org) {
        let q = sb
          .from("episode_organization_map")
          .select(`id,role,confidence,source,source_evidence,${EPISODE_JOIN}`)
          .eq("organization_id", org.id)
          .gte("confidence", 0.6)
          .order("confidence", { ascending: false, nullsFirst: false })
          .limit(lim * 3);
        if (date_from) q = q.gte("episodes.published_at", date_from);
        if (date_to) q = q.lte("episodes.published_at", date_to);
        const { data, error } = await q;
        if (error) return err(error.message);
        for (const m of (data as any[]) || []) {
          const ep = m.episodes;
          if (!ep || !isPublicHungarianPodcast(ep.podcasts)) continue;
          items.push({
            episode: {
              id: ep.id,
              title: ep.display_title || ep.title,
              slug: ep.slug,
              published_at: ep.published_at,
              url: episodeUrl(ep.podcasts?.slug, ep.slug),
            },
            podcast: {
              id: ep.podcasts?.id,
              title: ep.podcasts?.display_title || ep.podcasts?.title,
              slug: ep.podcasts?.slug,
              url: podcastUrl(ep.podcasts?.slug),
            },
            mention_type: m.role,
            role_type: m.role,
            confidence: m.confidence ?? null,
            source: m.source,
            evidence_phrase: clampEvidencePhrase(m?.source_evidence?.evidence, 240),
            evidence_kind: "extracted_metadata",
          });
          if (items.length >= lim) break;
        }
      }

      const canonical =
        kind === "person"
          ? { type: "person", id: person!.id, name: person!.name, slug: person!.slug, url: personUrl(person!.slug) }
          : { type: "organization", id: org!.id, name: org!.name, slug: org!.slug, url: organizationUrl(org!.slug) };

      return json(
        stripForbidden({
          resolved: true,
          entity: canonical,
          evidence_notice:
            "Az evidence_phrase entitás-kinyerésből származó metaadat-bizonyíték, nem szó szerinti átirat-idézet.",
          count: items.length,
          items,
        }),
      );
    } catch (e: any) {
      return err(e?.message || "unknown error");
    }
  },
});
