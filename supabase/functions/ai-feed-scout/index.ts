// AI podcast scout: Firecrawl scrape → Gemini extract → PodcastIndex validate → pi_feed_staging.
// Body: { sources?: string[], lang?: 'en'|'hu'|'all', model?: string, max_per_source?: number, dry_run?: boolean }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Curated default seeds. Each source declares its expected language so we
// don't accidentally mix English shows into Hungarian sources (or vice versa).
// lang_hint: ISO-639-1 ("en", "hu") — used in the Gemini prompt and validated
// against the PodcastIndex `language` field.
// EN-only scouting for now. We're not actively hunting HU feeds — if a HU
// podcast accidentally appears in an EN source it will be stored with its
// real language and silently skipped from the EN site (see multilingual plan).
const DEFAULT_SOURCES: { url: string; tag: string; lang_hint: string }[] = [
  // Apple Podcasts — overall charts (proven to scrape well via Firecrawl)
  { url: "https://podcasts.apple.com/us/charts", tag: "apple-us-charts", lang_hint: "en" },
  { url: "https://podcasts.apple.com/gb/charts", tag: "apple-gb-charts", lang_hint: "en" },
  { url: "https://podcasts.apple.com/ca/charts", tag: "apple-ca-charts", lang_hint: "en" },
  { url: "https://podcasts.apple.com/au/charts", tag: "apple-au-charts", lang_hint: "en" },
  // Apple Podcasts — genre charts (US). Each genre returns a top-N for that category.
  { url: "https://podcasts.apple.com/us/genre/podcasts-business/id1321", tag: "apple-us-business", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-news/id1311", tag: "apple-us-news", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-technology/id1318", tag: "apple-us-tech", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-sports/id1545", tag: "apple-us-sports", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-comedy/id1303", tag: "apple-us-comedy", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-education/id1304", tag: "apple-us-education", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-health-fitness/id1512", tag: "apple-us-health", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-society-culture/id1324", tag: "apple-us-society", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-science/id1533", tag: "apple-us-science", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-history/id1487", tag: "apple-us-history", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-tv-film/id1309", tag: "apple-us-tv-film", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-arts/id1301", tag: "apple-us-arts", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-music/id1310", tag: "apple-us-music", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-leisure/id1502", tag: "apple-us-leisure", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-true-crime/id1488", tag: "apple-us-true-crime", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-government/id1511", tag: "apple-us-government", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-religion-spirituality/id1314", tag: "apple-us-religion", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-fiction/id1483", tag: "apple-us-fiction", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-kids-family/id1305", tag: "apple-us-kids", lang_hint: "en" },
  // Apple GB genre charts — slightly different mix from US
  { url: "https://podcasts.apple.com/gb/genre/podcasts-business/id1321", tag: "apple-gb-business", lang_hint: "en" },
  { url: "https://podcasts.apple.com/gb/genre/podcasts-news/id1311", tag: "apple-gb-news", lang_hint: "en" },
  { url: "https://podcasts.apple.com/gb/genre/podcasts-comedy/id1303", tag: "apple-gb-comedy", lang_hint: "en" },
  // Spotify public top podcasts page (renders server-side enough for Firecrawl)
  { url: "https://podcastcharts.byspotify.com/", tag: "spotify-charts-global", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/us", tag: "spotify-charts-us", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/gb", tag: "spotify-charts-gb", lang_hint: "en" },
  // More Apple country charts (English-speaking markets — broader long tail)
  { url: "https://podcasts.apple.com/ie/charts", tag: "apple-ie-charts", lang_hint: "en" },
  { url: "https://podcasts.apple.com/nz/charts", tag: "apple-nz-charts", lang_hint: "en" },
  { url: "https://podcasts.apple.com/za/charts", tag: "apple-za-charts", lang_hint: "en" },
  { url: "https://podcasts.apple.com/in/charts", tag: "apple-in-charts", lang_hint: "en" },
  { url: "https://podcasts.apple.com/sg/charts", tag: "apple-sg-charts", lang_hint: "en" },
  { url: "https://podcasts.apple.com/ph/charts", tag: "apple-ph-charts", lang_hint: "en" },
  // Apple GB extended genre charts
  { url: "https://podcasts.apple.com/gb/genre/podcasts-technology/id1318", tag: "apple-gb-tech", lang_hint: "en" },
  { url: "https://podcasts.apple.com/gb/genre/podcasts-society-culture/id1324", tag: "apple-gb-society", lang_hint: "en" },
  { url: "https://podcasts.apple.com/gb/genre/podcasts-history/id1487", tag: "apple-gb-history", lang_hint: "en" },
  { url: "https://podcasts.apple.com/gb/genre/podcasts-science/id1533", tag: "apple-gb-science", lang_hint: "en" },
  { url: "https://podcasts.apple.com/gb/genre/podcasts-true-crime/id1488", tag: "apple-gb-true-crime", lang_hint: "en" },
  { url: "https://podcasts.apple.com/gb/genre/podcasts-health-fitness/id1512", tag: "apple-gb-health", lang_hint: "en" },
  { url: "https://podcasts.apple.com/gb/genre/podcasts-education/id1304", tag: "apple-gb-education", lang_hint: "en" },
  { url: "https://podcasts.apple.com/gb/genre/podcasts-sports/id1545", tag: "apple-gb-sports", lang_hint: "en" },
  // Apple US deeper subgenres (long-tail discovery)
  { url: "https://podcasts.apple.com/us/genre/podcasts-business-entrepreneurship/id1493", tag: "apple-us-entrepreneurship", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-business-investing/id1498", tag: "apple-us-investing", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-business-marketing/id1499", tag: "apple-us-marketing", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-business-management/id1490", tag: "apple-us-management", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-business-careers/id1501", tag: "apple-us-careers", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-news-politics/id1530", tag: "apple-us-politics", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-news-tech-news/id1448", tag: "apple-us-tech-news", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-news-business-news/id1530", tag: "apple-us-business-news", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-health-fitness-mental-health/id1517", tag: "apple-us-mental-health", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-health-fitness-nutrition/id1519", tag: "apple-us-nutrition", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-society-culture-philosophy/id1525", tag: "apple-us-philosophy", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-society-culture-relationships/id1526", tag: "apple-us-relationships", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-science-natural-sciences/id1535", tag: "apple-us-natural-sciences", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-science-social-sciences/id1539", tag: "apple-us-social-sciences", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-sports-football/id1546", tag: "apple-us-football", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-sports-basketball/id1547", tag: "apple-us-basketball", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-tv-film-after-shows/id1471", tag: "apple-us-aftershows", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-arts-books/id1482", tag: "apple-us-books", lang_hint: "en" },
  // Apple US — remaining major subgenres (long-tail completion)
  { url: "https://podcasts.apple.com/us/genre/podcasts-comedy-comedy-interviews/id1303", tag: "apple-us-comedy-interviews", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-comedy-stand-up/id1495", tag: "apple-us-standup", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-comedy-improv/id1496", tag: "apple-us-improv", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-education-courses/id1470", tag: "apple-us-courses", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-education-how-to/id1471", tag: "apple-us-howto", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-education-language-learning/id1469", tag: "apple-us-language", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-education-self-improvement/id1472", tag: "apple-us-self-improvement", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-fiction-comedy-fiction/id1485", tag: "apple-us-comedy-fiction", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-fiction-drama/id1486", tag: "apple-us-drama", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-fiction-science-fiction/id1487", tag: "apple-us-scifi", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-health-fitness-alternative-health/id1513", tag: "apple-us-alt-health", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-health-fitness-fitness/id1515", tag: "apple-us-fitness", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-health-fitness-medicine/id1518", tag: "apple-us-medicine", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-health-fitness-sexuality/id1520", tag: "apple-us-sexuality", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-kids-family-education-for-kids/id1493", tag: "apple-us-kids-edu", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-kids-family-parenting/id1492", tag: "apple-us-parenting", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-kids-family-stories-for-kids/id1494", tag: "apple-us-kids-stories", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-leisure-animation-manga/id1503", tag: "apple-us-anime", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-leisure-automotive/id1504", tag: "apple-us-automotive", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-leisure-aviation/id1505", tag: "apple-us-aviation", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-leisure-crafts/id1506", tag: "apple-us-crafts", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-leisure-games/id1507", tag: "apple-us-games", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-leisure-hobbies/id1508", tag: "apple-us-hobbies", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-leisure-home-garden/id1509", tag: "apple-us-home-garden", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-leisure-video-games/id1510", tag: "apple-us-video-games", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-music-music-commentary/id1521", tag: "apple-us-music-commentary", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-music-music-history/id1522", tag: "apple-us-music-history", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-music-music-interviews/id1523", tag: "apple-us-music-interviews", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-news-daily-news/id1531", tag: "apple-us-daily-news", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-news-news-commentary/id1532", tag: "apple-us-news-commentary", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-news-sports-news/id1525", tag: "apple-us-sports-news", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-religion-spirituality-buddhism/id1437", tag: "apple-us-buddhism", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-religion-spirituality-christianity/id1439", tag: "apple-us-christianity", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-religion-spirituality-judaism/id1440", tag: "apple-us-judaism", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-religion-spirituality-islam/id1438", tag: "apple-us-islam", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-religion-spirituality-hinduism/id1463", tag: "apple-us-hinduism", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-religion-spirituality-spirituality/id1444", tag: "apple-us-spirituality", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-science-astronomy/id1534", tag: "apple-us-astronomy", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-science-chemistry/id1536", tag: "apple-us-chemistry", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-science-earth-sciences/id1537", tag: "apple-us-earth-sciences", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-science-life-sciences/id1538", tag: "apple-us-life-sciences", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-science-mathematics/id1540", tag: "apple-us-math", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-science-nature/id1541", tag: "apple-us-nature", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-science-physics/id1542", tag: "apple-us-physics", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-society-culture-documentary/id1524", tag: "apple-us-documentary", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-society-culture-personal-journals/id1527", tag: "apple-us-journals", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-society-culture-places-travel/id1528", tag: "apple-us-travel", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-sports-baseball/id1548", tag: "apple-us-baseball", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-sports-cricket/id1549", tag: "apple-us-cricket", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-sports-fantasy-sports/id1550", tag: "apple-us-fantasy-sports", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-sports-golf/id1551", tag: "apple-us-golf", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-sports-hockey/id1552", tag: "apple-us-hockey", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-sports-rugby/id1553", tag: "apple-us-rugby", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-sports-running/id1554", tag: "apple-us-running", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-sports-soccer/id1555", tag: "apple-us-soccer", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-sports-swimming/id1556", tag: "apple-us-swimming", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-sports-tennis/id1557", tag: "apple-us-tennis", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-sports-volleyball/id1558", tag: "apple-us-volleyball", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-sports-wilderness/id1559", tag: "apple-us-wilderness", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-sports-wrestling/id1560", tag: "apple-us-wrestling", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-technology/id1318?chart=top-podcasts", tag: "apple-us-tech-top", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-tv-film-film-history/id1472", tag: "apple-us-film-history", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-tv-film-film-interviews/id1473", tag: "apple-us-film-interviews", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-tv-film-film-reviews/id1474", tag: "apple-us-film-reviews", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-tv-film-tv-reviews/id1475", tag: "apple-us-tv-reviews", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-arts-design/id1402", tag: "apple-us-design", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-arts-fashion-beauty/id1459", tag: "apple-us-fashion", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-arts-food/id1306", tag: "apple-us-food", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-arts-performing-arts/id1407", tag: "apple-us-performing", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-arts-visual-arts/id1406", tag: "apple-us-visual-arts", lang_hint: "en" },
  // Apple GB — remaining major genres
  { url: "https://podcasts.apple.com/gb/genre/podcasts-arts/id1301", tag: "apple-gb-arts", lang_hint: "en" },
  { url: "https://podcasts.apple.com/gb/genre/podcasts-fiction/id1483", tag: "apple-gb-fiction", lang_hint: "en" },
  { url: "https://podcasts.apple.com/gb/genre/podcasts-music/id1310", tag: "apple-gb-music", lang_hint: "en" },
  { url: "https://podcasts.apple.com/gb/genre/podcasts-leisure/id1502", tag: "apple-gb-leisure", lang_hint: "en" },
  { url: "https://podcasts.apple.com/gb/genre/podcasts-tv-film/id1309", tag: "apple-gb-tv-film", lang_hint: "en" },
  { url: "https://podcasts.apple.com/gb/genre/podcasts-religion-spirituality/id1314", tag: "apple-gb-religion", lang_hint: "en" },
  { url: "https://podcasts.apple.com/gb/genre/podcasts-government/id1511", tag: "apple-gb-government", lang_hint: "en" },
  { url: "https://podcasts.apple.com/gb/genre/podcasts-kids-family/id1305", tag: "apple-gb-kids", lang_hint: "en" },
  // Apple CA / AU / IE genre charts (most popular categories per market)
  { url: "https://podcasts.apple.com/ca/genre/podcasts-business/id1321", tag: "apple-ca-business", lang_hint: "en" },
  { url: "https://podcasts.apple.com/ca/genre/podcasts-news/id1311", tag: "apple-ca-news", lang_hint: "en" },
  { url: "https://podcasts.apple.com/ca/genre/podcasts-comedy/id1303", tag: "apple-ca-comedy", lang_hint: "en" },
  { url: "https://podcasts.apple.com/ca/genre/podcasts-true-crime/id1488", tag: "apple-ca-true-crime", lang_hint: "en" },
  { url: "https://podcasts.apple.com/ca/genre/podcasts-society-culture/id1324", tag: "apple-ca-society", lang_hint: "en" },
  { url: "https://podcasts.apple.com/au/genre/podcasts-business/id1321", tag: "apple-au-business", lang_hint: "en" },
  { url: "https://podcasts.apple.com/au/genre/podcasts-news/id1311", tag: "apple-au-news", lang_hint: "en" },
  { url: "https://podcasts.apple.com/au/genre/podcasts-comedy/id1303", tag: "apple-au-comedy", lang_hint: "en" },
  { url: "https://podcasts.apple.com/au/genre/podcasts-true-crime/id1488", tag: "apple-au-true-crime", lang_hint: "en" },
  { url: "https://podcasts.apple.com/au/genre/podcasts-sports/id1545", tag: "apple-au-sports", lang_hint: "en" },
  { url: "https://podcasts.apple.com/ie/genre/podcasts-news/id1311", tag: "apple-ie-news", lang_hint: "en" },
  { url: "https://podcasts.apple.com/ie/genre/podcasts-comedy/id1303", tag: "apple-ie-comedy", lang_hint: "en" },
  { url: "https://podcasts.apple.com/ie/genre/podcasts-society-culture/id1324", tag: "apple-ie-society", lang_hint: "en" },
  // Apple IN / SG / PH / NZ / ZA — top genres
  { url: "https://podcasts.apple.com/in/genre/podcasts-business/id1321", tag: "apple-in-business", lang_hint: "en" },
  { url: "https://podcasts.apple.com/in/genre/podcasts-technology/id1318", tag: "apple-in-tech", lang_hint: "en" },
  { url: "https://podcasts.apple.com/in/genre/podcasts-news/id1311", tag: "apple-in-news", lang_hint: "en" },
  { url: "https://podcasts.apple.com/sg/genre/podcasts-business/id1321", tag: "apple-sg-business", lang_hint: "en" },
  { url: "https://podcasts.apple.com/ph/genre/podcasts-comedy/id1303", tag: "apple-ph-comedy", lang_hint: "en" },
  { url: "https://podcasts.apple.com/nz/genre/podcasts-news/id1311", tag: "apple-nz-news", lang_hint: "en" },
  { url: "https://podcasts.apple.com/za/genre/podcasts-news/id1311", tag: "apple-za-news", lang_hint: "en" },
  // Spotify regional charts
  { url: "https://podcastcharts.byspotify.com/ca", tag: "spotify-charts-ca", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/au", tag: "spotify-charts-au", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/ie", tag: "spotify-charts-ie", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/nz", tag: "spotify-charts-nz", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/in", tag: "spotify-charts-in", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/za", tag: "spotify-charts-za", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/ph", tag: "spotify-charts-ph", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/sg", tag: "spotify-charts-sg", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/ng", tag: "spotify-charts-ng", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/ke", tag: "spotify-charts-ke", lang_hint: "en" },
  // Spotify Top Podcasters / Trending
  { url: "https://podcastcharts.byspotify.com/us/top-podcasts", tag: "spotify-us-top", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/us/top-trending-podcasts", tag: "spotify-us-trending", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/us/top-debut-podcasts", tag: "spotify-us-debut", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/gb/top-podcasts", tag: "spotify-gb-top", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/gb/top-trending-podcasts", tag: "spotify-gb-trending", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/ca/top-podcasts", tag: "spotify-ca-top", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/au/top-podcasts", tag: "spotify-au-top", lang_hint: "en" },
  // Spotify category charts (US)
  { url: "https://podcastcharts.byspotify.com/us/category/business", tag: "spotify-us-business", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/us/category/comedy", tag: "spotify-us-comedy", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/us/category/education", tag: "spotify-us-education", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/us/category/health-fitness", tag: "spotify-us-health", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/us/category/news", tag: "spotify-us-news", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/us/category/sports", tag: "spotify-us-sports", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/us/category/society-culture", tag: "spotify-us-society", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/us/category/technology", tag: "spotify-us-tech", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/us/category/true-crime", tag: "spotify-us-truecrime", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/us/category/tv-film", tag: "spotify-us-tvfilm", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/us/category/arts", tag: "spotify-us-arts", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/us/category/fiction", tag: "spotify-us-fiction", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/us/category/history", tag: "spotify-us-history", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/us/category/science", tag: "spotify-us-science", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/us/category/leisure", tag: "spotify-us-leisure", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/us/category/kids-family", tag: "spotify-us-kids", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/us/category/religion-spirituality", tag: "spotify-us-religion", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/us/category/music", tag: "spotify-us-music", lang_hint: "en" },
  // Spotify category charts (GB)
  { url: "https://podcastcharts.byspotify.com/gb/category/business", tag: "spotify-gb-business", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/gb/category/comedy", tag: "spotify-gb-comedy", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/gb/category/news", tag: "spotify-gb-news", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/gb/category/society-culture", tag: "spotify-gb-society", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/gb/category/true-crime", tag: "spotify-gb-truecrime", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/gb/category/sports", tag: "spotify-gb-sports", lang_hint: "en" },
  // Curated list sites that publish actual show names
  { url: "https://www.chartable.com/charts/itunes/us-all-podcasts-podcasts", tag: "chartable-us-all", lang_hint: "en" },
  { url: "https://www.chartable.com/charts/itunes/gb-all-podcasts-podcasts", tag: "chartable-gb-all", lang_hint: "en" },
  { url: "https://www.chartable.com/charts/itunes/us-business-podcasts", tag: "chartable-us-business", lang_hint: "en" },
  { url: "https://www.chartable.com/charts/itunes/us-technology-podcasts", tag: "chartable-us-tech", lang_hint: "en" },
  { url: "https://www.chartable.com/charts/itunes/us-news-podcasts", tag: "chartable-us-news", lang_hint: "en" },
  { url: "https://www.chartable.com/charts/itunes/us-comedy-podcasts", tag: "chartable-us-comedy", lang_hint: "en" },
  { url: "https://www.chartable.com/charts/itunes/us-society-culture-podcasts", tag: "chartable-us-society", lang_hint: "en" },
  { url: "https://www.chartable.com/charts/itunes/us-health-fitness-podcasts", tag: "chartable-us-health", lang_hint: "en" },
  { url: "https://www.chartable.com/charts/itunes/us-true-crime-podcasts", tag: "chartable-us-true-crime", lang_hint: "en" },
  { url: "https://www.chartable.com/charts/itunes/us-history-podcasts", tag: "chartable-us-history", lang_hint: "en" },
  { url: "https://www.chartable.com/charts/itunes/us-science-podcasts", tag: "chartable-us-science", lang_hint: "en" },
  { url: "https://www.podchaser.com/lists/the-100-best-podcasts-105ZB1NB7K", tag: "podchaser-top100", lang_hint: "en" },
  { url: "https://www.podchaser.com/charts/top-100", tag: "podchaser-top100-live", lang_hint: "en" },
  { url: "https://goodpods.com/leaderboard/top-100-all-time", tag: "goodpods-top100", lang_hint: "en" },
  { url: "https://goodpods.com/leaderboard/top-100-this-week", tag: "goodpods-week", lang_hint: "en" },
  // ===== Publishers / Networks — show catalog pages =====
  // Public broadcasters
  { url: "https://www.npr.org/podcasts-and-shows", tag: "pub-npr", lang_hint: "en" },
  { url: "https://www.npr.org/podcasts/", tag: "pub-npr-directory", lang_hint: "en" },
  { url: "https://www.bbc.co.uk/sounds/podcasts", tag: "pub-bbc-sounds", lang_hint: "en" },
  { url: "https://www.bbc.co.uk/programmes/genres/factual/podcasts", tag: "pub-bbc-factual", lang_hint: "en" },
  { url: "https://www.cbc.ca/listen/cbc-podcasts", tag: "pub-cbc", lang_hint: "en" },
  { url: "https://www.abc.net.au/listen/podcasts", tag: "pub-abc-au", lang_hint: "en" },
  { url: "https://www.rnz.co.nz/podcasts", tag: "pub-rnz", lang_hint: "en" },
  // News / magazine publishers
  { url: "https://www.nytimes.com/podcasts", tag: "pub-nyt", lang_hint: "en" },
  { url: "https://www.washingtonpost.com/podcasts/", tag: "pub-wapo", lang_hint: "en" },
  { url: "https://www.theguardian.com/news/series/all-podcasts", tag: "pub-guardian", lang_hint: "en" },
  { url: "https://www.theatlantic.com/podcasts/", tag: "pub-atlantic", lang_hint: "en" },
  { url: "https://www.newyorker.com/podcast", tag: "pub-newyorker", lang_hint: "en" },
  { url: "https://www.economist.com/podcasts", tag: "pub-economist", lang_hint: "en" },
  { url: "https://www.ft.com/podcasts", tag: "pub-ft", lang_hint: "en" },
  { url: "https://www.bloomberg.com/podcasts", tag: "pub-bloomberg", lang_hint: "en" },
  { url: "https://www.wsj.com/podcasts", tag: "pub-wsj", lang_hint: "en" },
  { url: "https://www.vox.com/podcasts", tag: "pub-vox", lang_hint: "en" },
  { url: "https://www.theverge.com/podcasts", tag: "pub-verge", lang_hint: "en" },
  { url: "https://www.wired.com/podcasts/", tag: "pub-wired", lang_hint: "en" },
  { url: "https://slate.com/podcasts", tag: "pub-slate", lang_hint: "en" },
  { url: "https://www.cnn.com/audio/podcasts", tag: "pub-cnn", lang_hint: "en" },
  { url: "https://www.npr.org/series/423302056/podcasts-from-npr-member-stations", tag: "pub-npr-stations", lang_hint: "en" },
  // Major podcast networks / studios
  { url: "https://wondery.com/shows/", tag: "pub-wondery", lang_hint: "en" },
  { url: "https://www.iheart.com/podcast/", tag: "pub-iheart", lang_hint: "en" },
  { url: "https://gimletmedia.com/shows/", tag: "pub-gimlet", lang_hint: "en" },
  { url: "https://www.pushkin.fm/podcasts", tag: "pub-pushkin", lang_hint: "en" },
  { url: "https://www.radiotopia.fm/podcasts", tag: "pub-radiotopia", lang_hint: "en" },
  { url: "https://prx.org/series", tag: "pub-prx", lang_hint: "en" },
  { url: "https://crooked.com/podcasts/", tag: "pub-crooked", lang_hint: "en" },
  { url: "https://www.maximumfun.org/podcasts/", tag: "pub-maxfun", lang_hint: "en" },
  { url: "https://earwolf.com/shows/", tag: "pub-earwolf", lang_hint: "en" },
  { url: "https://www.relay.fm/shows", tag: "pub-relay", lang_hint: "en" },
  { url: "https://atp.fm", tag: "pub-atp", lang_hint: "en" },
  { url: "https://twit.tv/shows", tag: "pub-twit", lang_hint: "en" },
  { url: "https://www.stitcher.com/networks", tag: "pub-stitcher-networks", lang_hint: "en" },
  { url: "https://www.cadence13.com/podcasts/", tag: "pub-cadence13", lang_hint: "en" },
  { url: "https://www.audacy.com/podcasts", tag: "pub-audacy", lang_hint: "en" },
  { url: "https://megaphone.fm/podcasts", tag: "pub-megaphone", lang_hint: "en" },
  // VC / tech / business networks
  { url: "https://a16z.com/podcasts/", tag: "pub-a16z", lang_hint: "en" },
  { url: "https://www.allinpodcast.co/", tag: "pub-allin", lang_hint: "en" },
  { url: "https://www.tedtalks.com/podcasts", tag: "pub-ted", lang_hint: "en" },
  { url: "https://hbr.org/podcasts", tag: "pub-hbr", lang_hint: "en" },
  { url: "https://podcasts.mckinsey.com/", tag: "pub-mckinsey", lang_hint: "en" },
  { url: "https://www.bain.com/insights/topics/bain-podcasts/", tag: "pub-bain", lang_hint: "en" },
  // Sports / entertainment networks
  { url: "https://www.theringer.com/podcasts", tag: "pub-ringer", lang_hint: "en" },
  { url: "https://www.barstoolsports.com/shows/podcasts", tag: "pub-barstool", lang_hint: "en" },
  { url: "https://www.espn.com/espnradio/podcast/index", tag: "pub-espn", lang_hint: "en" },
  { url: "https://meadowlark.media/podcasts/", tag: "pub-meadowlark", lang_hint: "en" },
  // Science / culture
  { url: "https://www.smithsonianmag.com/podcasts/", tag: "pub-smithsonian", lang_hint: "en" },
  { url: "https://www.nationalgeographic.com/podcasts/", tag: "pub-natgeo", lang_hint: "en" },
  { url: "https://www.nature.com/nature/podcast", tag: "pub-nature", lang_hint: "en" },
  { url: "https://www.scientificamerican.com/podcasts/", tag: "pub-sciam", lang_hint: "en" },
];

// Normalize PI/BCP-47 language string to ISO-639-1 prefix ("en-us" → "en").
function normLang(s: string | null | undefined): string | null {
  if (!s) return null;
  return String(s).toLowerCase().split(/[-_]/)[0] || null;
}

async function sha1Hex(input: string) {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function piSearch(term: string) {
  const apiKey = Deno.env.get("PODCAST_INDEX_API_KEY")!;
  const apiSecret = Deno.env.get("PODCAST_INDEX_API_SECRET")!;
  const date = Math.floor(Date.now() / 1000).toString();
  const auth = await sha1Hex(apiKey + apiSecret + date);
  const url = `https://api.podcastindex.org/api/1.0/search/byterm?q=${encodeURIComponent(term)}&max=3`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Podiverzum/1.0 ai-scout",
      "X-Auth-Date": date,
      "X-Auth-Key": apiKey,
      "Authorization": auth,
    },
  });
  if (!res.ok) return null;
  return res.json();
}

async function firecrawlScrape(url: string): Promise<string | null> {
  const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY not configured");
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
  });
  if (!res.ok) {
    console.warn(`firecrawl ${url} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return null;
  }
  const data = await res.json();
  return data?.data?.markdown || data?.markdown || null;
}

async function geminiExtract(markdown: string, sourceTag: string, langHint: string, max: number, model: string) {
  const apiKey = Deno.env.get("LOVABLE_API_KEY")!;
  const langName = langHint === "hu" ? "Hungarian" : langHint === "en" ? "English" : langHint;
  const prompt = `You are an expert podcast curator. Given the markdown of a webpage that lists or recommends podcasts, extract distinct podcasts.

STRICT LANGUAGE FILTER: Only return podcasts whose primary spoken language is ${langName} (${langHint}).
Skip any show in another language even if it appears on the page (e.g. cross-listed international shows).
If unsure about a podcast's language, omit it.

Return at most ${max} of the highest-quality, real podcasts (skip generic mentions, ads, blog posts).
For each podcast, provide:
- title: exact show name
- author: host or publisher (best guess if implied)
- reason: 1 short sentence why this is a notable podcast (from the page context)

Source tag: ${sourceTag}

PAGE MARKDOWN (truncated):
${markdown.slice(0, 50000)}`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      tools: [{
        type: "function",
        function: {
          name: "submit_podcasts",
          description: "Submit the extracted podcast list",
          parameters: {
            type: "object",
            properties: {
              podcasts: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    author: { type: "string" },
                    reason: { type: "string" },
                  },
                  required: ["title"],
                },
              },
            },
            required: ["podcasts"],
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "submit_podcasts" } },
    }),
  });
  if (!res.ok) {
    console.warn(`gemini extract failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return [];
  }
  const data = await res.json();
  const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) return [];
  try {
    const parsed = typeof args === "string" ? JSON.parse(args) : args;
    return Array.isArray(parsed.podcasts) ? parsed.podcasts : [];
  } catch {
    return [];
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const t0 = Date.now();
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const sources: { url: string; tag: string; lang_hint: string }[] = Array.isArray(body.sources) && body.sources.length
      ? body.sources.map((s: any) => {
          if (typeof s === "string") return { url: s, tag: new URL(s).hostname, lang_hint: body.lang_hint || "en" };
          return { url: s.url, tag: s.tag || new URL(s.url).hostname, lang_hint: s.lang_hint || body.lang_hint || "en" };
        })
      : DEFAULT_SOURCES;
    const model = body.model || "google/gemini-2.5-flash";
    const maxPerSource = Math.max(5, Math.min(50, Number(body.max_per_source) || 25));
    const dryRun = !!body.dry_run;
    const strictLang = body.strict_lang !== false; // default ON

    const candidates: { title: string; author?: string; reason?: string; sourceTag: string; langHint: string }[] = [];
    const sourceStats: Record<string, { scraped: boolean; extracted: number; lang_hint: string }> = {};

    for (const src of sources) {
      const md = await firecrawlScrape(src.url);
      if (!md) { sourceStats[src.tag] = { scraped: false, extracted: 0, lang_hint: src.lang_hint }; continue; }
      const extracted = await geminiExtract(md, src.tag, src.lang_hint, maxPerSource, model);
      sourceStats[src.tag] = { scraped: true, extracted: extracted.length, lang_hint: src.lang_hint };
      for (const p of extracted) {
        if (p?.title) candidates.push({
          title: String(p.title).trim(), author: p.author, reason: p.reason,
          sourceTag: src.tag, langHint: src.lang_hint,
        });
      }
    }

    // Dedupe candidates by title+author
    const seen = new Set<string>();
    const unique = candidates.filter((c) => {
      const key = `${c.title.toLowerCase()}|${(c.author || "").toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Validate via PodcastIndex search + language guard
    const validated: any[] = [];
    let piHits = 0, piMisses = 0, langMismatches = 0;
    for (const c of unique) {
      const term = c.author ? `${c.title} ${c.author}` : c.title;
      const result = await piSearch(term);
      const top = result?.feeds?.[0];
      if (!top || !top.url) { piMisses++; continue; }
      // Loose match: title token overlap
      const tNorm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const candTokens = new Set(tNorm(c.title).split(" ").filter((w) => w.length > 2));
      const piTokens = new Set(tNorm(top.title || "").split(" ").filter((w) => w.length > 2));
      let overlap = 0;
      for (const t of candTokens) if (piTokens.has(t)) overlap++;
      const score = candTokens.size ? overlap / candTokens.size : 0;
      if (score < 0.4) { piMisses++; continue; }

      // Script guard: when targeting Latin-script langs (en, es, etc.), reject titles
      // dominated by CJK / Arabic / Cyrillic / Hebrew / Thai / Hangul / Kana glyphs.
      const latinTargets = new Set(["en","es","pt","fr","de","it","nl","sv","da","no","pl","ro","hu"]);
      if (latinTargets.has(c.langHint)) {
        const t = String(top.title || "");
        if (/[\u4e00-\u9fff\u0600-\u06ff\u0400-\u04ff\u0590-\u05ff\u0e00-\u0e7f\uac00-\ud7af\u3040-\u30ff]/.test(t)) {
          langMismatches++;
          continue;
        }
      }

      // Language guard: PI language must match the source's lang_hint when known.
      // If PI has no language set, we trust the AI extract's filter and let it through.
      const piLang = normLang(top.language);
      if (strictLang && piLang && piLang !== c.langHint) {
        langMismatches++;
        continue;
      }


      piHits++;
      validated.push({ feed: top, candidate: c, lang_hint: c.langHint });
    }

    if (dryRun) {
      return new Response(JSON.stringify({
        ok: true, dry_run: true, sources: sourceStats,
        candidates: unique.length, pi_hits: piHits, pi_misses: piMisses, lang_mismatches: langMismatches,
        sample: validated.slice(0, 10).map((v) => ({
          title: v.feed.title, url: v.feed.url, lang: v.feed.language || null,
          source: v.candidate.sourceTag, expected_lang: v.lang_hint,
        })),
        elapsed_ms: Date.now() - t0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Skip rows already in podcasts or staging
    const urls = validated.map((v) => v.feed.url);
    const exSet = new Set<string>();
    for (let i = 0; i < urls.length; i += 200) {
      const slice = urls.slice(i, i + 200);
      const [{ data: p }, { data: s }] = await Promise.all([
        supabase.from("podcasts").select("rss_url").in("rss_url", slice),
        supabase.from("pi_feed_staging").select("rss_url").in("rss_url", slice),
      ]);
      (p || []).forEach((r: any) => exSet.add(r.rss_url));
      (s || []).forEach((r: any) => exSet.add(r.rss_url));
    }
    const fresh = validated.filter((v) => !exSet.has(v.feed.url));

    let inserted = 0, importId: string | null = null;
    if (fresh.length > 0) {
      const { data: imp, error: impErr } = await supabase.from("pi_dump_imports")
        .insert({ source: "ai_scout", status: "ingesting", snapshot_date: new Date().toISOString().slice(0, 10) })
        .select("id").single();
      if (impErr) throw impErr;
      importId = imp.id;

      const rows = fresh.map((v) => ({
        import_id: imp.id,
        pi_id: v.feed.id ?? null,
        rss_url: v.feed.url,
        title: v.feed.title || v.candidate.title || null,
        website_url: v.feed.link || null,
        image_url: v.feed.image || v.feed.artwork || null,
        description: v.feed.description || v.candidate.reason || null,
        // Always populate language: prefer PI value, fall back to source's lang_hint
        // so downstream filters (homepage, categories, search) never treat it as English-by-default.
        language: normLang(v.feed.language) || v.lang_hint,
        author: v.feed.author || v.feed.ownerName || v.candidate.author || null,
        episode_count: v.feed.episodeCount ?? null,
        newest_item_at: v.feed.newestItemPublishTime ? new Date(v.feed.newestItemPublishTime * 1000).toISOString() : null,
        last_http_status: v.feed.lastHttpStatus ?? null,
        dead: v.feed.dead === 1,
      }));

      const { error: upErr, count } = await supabase
        .from("pi_feed_staging")
        .upsert(rows, { onConflict: "rss_url", ignoreDuplicates: true, count: "exact" });
      if (upErr) throw upErr;
      inserted = count ?? rows.length;

      await supabase.from("pi_dump_imports").update({
        feeds_received: validated.length,
        skipped_duplicates: validated.length - fresh.length,
        status: "processing",
        notes: { sources: sourceStats, candidates: unique.length, pi_hits: piHits, pi_misses: piMisses, lang_mismatches: langMismatches },
        updated_at: new Date().toISOString(),
      }).eq("id", imp.id);
    }

    return new Response(JSON.stringify({
      ok: true,
      sources: sourceStats,
      candidates: unique.length,
      pi_hits: piHits,
      pi_misses: piMisses,
      lang_mismatches: langMismatches,
      already_known: validated.length - fresh.length,
      inserted,
      import_id: importId,
      elapsed_ms: Date.now() - t0,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("ai-feed-scout error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
