import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { getSupabase, json, err } from "../supabase";

export default defineTool({
  name: "search_episodes",
  title: "Epizód keresés",
  description:
    "Magyar podcast epizódok szemantikus + kulcsszavas keresése (search-hybrid v13). Címre, leírásra és tartalomra keres.",
  inputSchema: {
    query: z.string().trim().min(1).describe("Keresőkifejezés."),
    limit: z.number().int().min(1).max(30).optional().describe("Max találat (alap: 10)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, limit }) => {
    try {
      const url = process.env.SUPABASE_URL;
      const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
      if (!url || !key) return err("Missing SUPABASE env");
      const res = await fetch(`${url}/functions/v1/search-hybrid`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ q: query, limit: limit ?? 10, rerank: false }),
      });
      if (!res.ok) return err(`search-hybrid ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = await res.json();
      const items = (data?.episodes || data?.items || []).slice(0, limit ?? 10).map((e: any) => ({
        id: e.id,
        title: e.title,
        podcast: e.podcast_title || e.podcast,
        published_at: e.published_at,
        summary: e.ai_summary || e.description?.slice(0, 300),
        url:
          e.podcast_slug && e.slug
            ? `https://podiverzum.hu/podcast/${e.podcast_slug}/${e.slug}`
            : undefined,
      }));
      return json({ count: items.length, items });
    } catch (e: any) {
      return err(e?.message || "unknown error");
    }
  },
});
