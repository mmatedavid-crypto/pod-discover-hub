import { defineMcp } from "@lovable.dev/mcp-js";
import searchPodcasts from "./tools/search-podcasts";
import getPodcast from "./tools/get-podcast";
import searchEpisodes from "./tools/search-episodes";
import getToplist from "./tools/get-toplist";

export default defineMcp({
  name: "podiverzum-mcp",
  title: "Podiverzum – Magyar podcast katalógus",
  version: "0.1.0",
  instructions:
    "A podiverzum.hu magyar podcast katalógus eszközei. Használd a `search_podcasts` és `search_episodes` tool-okat kereséshez, a `get_podcast` tool-t egy műsor részleteihez slug alapján, és a `get_toplist` tool-t az aktuális magyar toplistához.",
  tools: [searchPodcasts, getPodcast, searchEpisodes, getToplist],
});
