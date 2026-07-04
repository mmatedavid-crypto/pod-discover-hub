import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { getSupabase, json, err } from "../supabase";

export default defineTool({
  name: "search_podcasts",
  title: "Podcast keresés",
  description:
    "Magyar podcastok keresése név/leírás alapján a podiverzum.hu katalógusban. Visszaadja a slug, cím, kategória, rank és publikus URL adatokat.",
  inputSchema: {
    query: z.string().trim().min(1).describe("Keresőkifejezés (podcast név vagy téma)."),
    limit: z.number().int().min(1).max(50).optional().describe("Max találatszám (alap: 15)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, limit }) => {
    try {
      const sb = getSupabase();
      const lim = limit ?? 15;
      const { data, error } = await sb
        .from("podcasts")
        .select("id, slug, title, description, categories, rank_label, podiverzum_rank, image_url, language")
        .ilike("language", "hu%")
        .eq("rss_status", "active")
        .or(`title.ilike.%${query}%,description.ilike.%${query}%`)
        .order("podiverzum_rank", { ascending: false, nullsFirst: false })
        .limit(lim);
      if (error) return err(error.message);
      const items = (data || []).map((p: any) => ({
        ...p,
        url: `https://podiverzum.hu/podcast/${p.slug}`,
      }));
      return json({ count: items.length, items });
    } catch (e: any) {
      return err(e?.message || "unknown error");
    }
  },
});
