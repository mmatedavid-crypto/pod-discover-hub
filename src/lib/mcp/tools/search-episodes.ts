import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { json, err } from "../supabase";
import { shapeSearchEpisode, stripForbidden } from "../entityResolve";

export default defineTool({
  name: "search_episodes",
  title: "Epizód keresés",
  description:
    "Magyar podcast epizódok szemantikus + kulcsszavas keresése (search-hybrid v13). Címre, leírásra és tartalomra keres. Átirat-részletet nem ad vissza; részletes kontextushoz használd a `get_episode_context` tool-t.",
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
      const lim = limit ?? 10;
      const res = await fetch(`${url}/functions/v1/search-hybrid`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ q: query, limit: lim, rerank: false }),
      });
      if (!res.ok) return err(`search-hybrid ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = await res.json();
      const raw: any[] = data?.episodes || data?.items || [];
      const items = raw.slice(0, lim).map((e) => shapeSearchEpisode(e));
      return json(
        stripForbidden({
          count: items.length,
          confidence_band: typeof data?.confidence_band === "string" ? data.confidence_band : undefined,
          semantic: typeof data?.semantic === "boolean" ? data.semantic : undefined,
          engine: typeof data?.engine === "string" ? data.engine : undefined,
          items,
        }),
      );
    } catch (e: any) {
      return err(e?.message || "unknown error");
    }
  },
});
