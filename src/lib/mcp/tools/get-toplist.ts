import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { getSupabase, json, err } from "../supabase";

export default defineTool({
  name: "get_toplist",
  title: "Podiverzum toplista",
  description:
    "A Podiverzum aktuális magyar podcast toplistája (Apple + Spotify + YouTube fúzió, RRF-alapú).",
  inputSchema: {
    limit: z.number().int().min(1).max(50).optional().describe("Max találatszám (alap: 20)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }) => {
    try {
      const sb = getSupabase();
      const { data, error } = await sb.rpc("get_trending_podcasts", { p_limit: limit ?? 20 });
      if (error) return err(error.message);
      const items = (data || []).map((p: any, i: number) => ({
        rank: i + 1,
        title: p.title,
        slug: p.slug,
        trending_score: p.trending_score,
        source_count: p.source_count,
        best_rank: p.best_rank,
        url: p.slug ? `https://podiverzum.hu/podcast/${p.slug}` : undefined,
      }));
      return json({ count: items.length, items });
    } catch (e: any) {
      return err(e?.message || "unknown error");
    }
  },
});
