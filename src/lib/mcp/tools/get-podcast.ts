import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { getSupabase, json, err } from "../supabase";

export default defineTool({
  name: "get_podcast",
  title: "Podcast részletek",
  description:
    "Egy podcast teljes adatai slug alapján, a legutóbbi 10 epizóddal együtt.",
  inputSchema: {
    slug: z.string().trim().min(1).describe("Podcast slug (pl. 'partizan-podcast')."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ slug }) => {
    try {
      const sb = getSupabase();
      const { data: podcast, error } = await sb
        .from("podcasts")
        .select("*")
        .eq("slug", slug)
        .maybeSingle();
      if (error) return err(error.message);
      if (!podcast) return err(`Podcast not found: ${slug}`);
      const { data: episodes } = await sb
        .from("episodes")
        .select("id, slug, title, description, published_at, duration_seconds")
        .eq("podcast_id", (podcast as any).id)
        .order("published_at", { ascending: false })
        .limit(10);
      return json({
        podcast: { ...podcast, url: `https://podiverzum.hu/podcast/${(podcast as any).slug}` },
        recent_episodes: (episodes || []).map((e: any) => ({
          ...e,
          url: `https://podiverzum.hu/podcast/${(podcast as any).slug}/${e.slug}`,
        })),
      });
    } catch (e: any) {
      return err(e?.message || "unknown error");
    }
  },
});
