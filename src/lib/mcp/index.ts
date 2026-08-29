import { defineMcp } from "@lovable.dev/mcp-js";
import searchPodcasts from "./tools/search-podcasts";
import getPodcast from "./tools/get-podcast";
import searchEpisodes from "./tools/search-episodes";
import getToplist from "./tools/get-toplist";
import findMentions from "./tools/find-mentions";
import getEpisodeContext from "./tools/get-episode-context";

export default defineMcp({
  name: "podiverzum-mcp",
  title: "Podiverzum – Magyar podcast katalógus",
  version: "0.2.0",
  instructions:
    "A podiverzum.hu magyar podcast katalógus read-only adateszközei. Ajánlott folyamat: `search_episodes` a témára → `get_episode_context` a kiválasztott epizód publikus kontextusához (összefoglaló, személyek, szervezetek, témák). Megnevezett személyre vagy szervezetre használd a `find_mentions` tool-t (kanonikus, publikus entitás + említő epizódok). Műsorszintű adatokhoz `search_podcasts` / `get_podcast`, aktuális magyar toplistához `get_toplist`. FONTOS: az `evidence_phrase` értékek entitás-kinyerésből származó metaadat-bizonyítékok, NEM szó szerinti átirat-idézetek — ne idézd őket idézőjelben a műsorban elhangzott mondatként. Átirat vagy időbélyeges átirat-részlet ezen a felületen nem elérhető. Hivatkozásnál mindig a visszaadott publikus Podiverzum URL-t használd.",
  tools: [searchPodcasts, getPodcast, searchEpisodes, getToplist, findMentions, getEpisodeContext],
});
