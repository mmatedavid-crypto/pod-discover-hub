import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { imageSrcSetForAspect, optimizedImageUrl } from "@/lib/image";

const root = process.cwd();
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");

describe("episode thumbnail loading policy", () => {
  it("fills the rail cover with the episode artwork instead of a tiny floating thumbnail", () => {
    const card = read("src/components/EpisodeCard.tsx");

    expect(card).toContain("function railBackdropStyle");
    expect(card).toContain("style={railBackdropStyle(podTitle)}");
    // Rail cover image fills the 16:10 area.
    expect(card).toContain('className="absolute inset-0 h-full w-full object-cover"');
    expect(card).toContain('sizes="(max-width: 640px) 80vw, 340px"');
    expect(card).toContain("imageSrcSetForAspect(coverImage, [320, 480, 640], 16 / 10)");
    // Old tiny floating thumbnail must not return.
    expect(card).not.toContain('className="absolute left-3 top-3 w-16 rounded-md shadow-lg ring-1 ring-border/70 sm:w-20"');
  });

  it("requests aspect-matched rail thumbnail variants instead of square crops", () => {
    const image = read("src/lib/image.ts");
    const smartDiscovery = read("src/components/smart-player/SmartDiscoveryPanel.tsx");
    const related = read("src/components/smart-player/RelatedEpisodes.tsx");
    const toplista = read("src/pages/ToplistaAllTimePage.tsx");
    const hetiArticle = read("src/pages/HetiArticlePage.tsx");
    const buzzsprout = "https://storage.buzzsprout.com/variants/abc123/cover.jpg";

    expect(image).toContain("export function imageSrcSetForAspect");
    expect(image).toContain("const h = Math.max(32, Math.round(w / ratio))");
    expect(smartDiscovery).toContain("imageSrcSetForAspect(r.image_url || r.podcast_image_url, [200, 280, 360], 2)");
    expect(related).toContain("imageSrcSetForAspect(r.image_url || r.podcast_image_url, [180, 240, 320], 2)");
    expect(toplista).toContain("imageSrcSetForAspect(src, [320, 480, 640], 16 / 9)");
    expect(hetiArticle).toContain("imageSrcSetForAspect(post.cover_image_url, [640, 960, 1280], 16 / 9)");
    expect(imageSrcSetForAspect(buzzsprout, [320, 480, 640], 16 / 10)).toBe(
      "https://images.weserv.nl/?url=https%3A%2F%2Fstorage.buzzsprout.com%2Fvariants%2Fabc123%2Fcover.jpg&w=320&h=200&fit=cover&q=78 320w, https://images.weserv.nl/?url=https%3A%2F%2Fstorage.buzzsprout.com%2Fvariants%2Fabc123%2Fcover.jpg&w=480&h=300&fit=cover&q=78 480w, https://images.weserv.nl/?url=https%3A%2F%2Fstorage.buzzsprout.com%2Fvariants%2Fabc123%2Fcover.jpg&w=640&h=400&fit=cover&q=78 640w",
    );
  });

  it("keeps podcast episode thumbnails near rendered size", () => {
    const detail = read("src/pages/PodcastDetail.tsx");

    expect(detail).toContain("imageSize={96}");
    expect(detail).toContain("imageWidths={[64, 96, 160]}");
    expect(detail).toContain('sizes="(max-width: 640px) 64px, 80px"');
    expect(detail).toContain('loading={i === 0 ? "eager" : "lazy"}');
    expect(detail).toContain('fetchPriority={i === 0 ? "high" : "low"}');
    expect(detail).not.toContain("imageWidths={[96, 160, 240]}");
    expect(detail).not.toContain('fetchPriority={i < 4 ? "high" : "auto"}');
    expect(detail).not.toContain('loading={i < 4 ? "eager" : "lazy"}');
  });

  it("does not render every podcast detail episode thumbnail at once", () => {
    const detail = read("src/pages/PodcastDetail.tsx");

    expect(detail).toContain("PODCAST_EPISODE_INITIAL_RENDER_COUNT = 20");
    expect(detail).toContain("PODCAST_EPISODE_RENDER_STEP = 20");
    expect(detail).toContain("const visibleEpisodes = filtered.slice(0, visibleCount)");
    expect(detail).toContain("setVisibleCount(PODCAST_EPISODE_INITIAL_RENDER_COUNT)");
    expect(detail).toContain("További epizódok");
    expect(detail).toContain("visibleEpisodes.map");
    expect(detail).not.toContain("filtered.map((e, i)");
  });

  it("limits high-priority episode thumbnail fetches to the lead visible card", () => {
    const card = read("src/components/EpisodeCard.tsx");

    expect(card).toContain('fetchPriority={imagePriority ? "high" : "low"}');
    expect(card).toContain("imagePriority={i === 0}");
    expect(card).not.toContain("imagePriority={i < 4}");
    expect(card).not.toContain("imagePriority={i < 3}");
    expect(card).not.toContain('fetchPriority={imagePriority ? "high" : "auto"}');
  });

  it("prioritizes first-viewport podcast and episode hero artwork", () => {
    const podcast = read("src/pages/PodcastDetail.tsx");
    const episode = read("src/pages/EpisodeDetail.tsx");

    expect(podcast).toContain('size="lg"');
    expect(podcast).toContain('loading="eager"');
    expect(podcast).toContain('fetchPriority="high"');
    expect(episode).toContain('size="lg"');
    expect(episode).toContain('loading="eager"');
    expect(episode).toContain('fetchPriority="high"');
  });

  it("downsizes Omny episode artwork instead of loading large Portfolio thumbnails", () => {
    const image = read("src/lib/image.ts");
    const largeOmny = "https://www.omnycontent.com/d/clips/show/episode/image.jpg?t=1780578252&amp;size=Large";
    const portfolioOmny = "https://www.omnycontent.com/d/clips/9c1a4b9e-f661-4da4-8ca4-af3900d468eb/552b480a-d676-4899-a9b8-b39c01049404/0b5ba5c5-26a2-4697-96a7-b45f00d67fdc/image.jpg?t=1780578252&amp;size=Large";

    expect(image).toContain('url.hostname.includes("omnycontent.com")');
    expect(image).toContain('url.searchParams.set("size", width <= 160 ? "Small" : width <= 720 ? "Medium" : "Large")');
    expect(optimizedImageUrl(largeOmny, { width: 96, height: 96 })).toBe(
      "https://www.omnycontent.com/d/clips/show/episode/image.jpg?t=1780578252&size=Small",
    );
    expect(optimizedImageUrl(largeOmny, { width: 280, height: 140 })).toBe(
      "https://www.omnycontent.com/d/clips/show/episode/image.jpg?t=1780578252&size=Medium",
    );
    expect(optimizedImageUrl(portfolioOmny, { width: 640, height: 400 })).toBe(
      "https://www.omnycontent.com/d/clips/9c1a4b9e-f661-4da4-8ca4-af3900d468eb/552b480a-d676-4899-a9b8-b39c01049404/0b5ba5c5-26a2-4697-96a7-b45f00d67fdc/image.jpg?t=1780578252&size=Medium",
    );
    expect(optimizedImageUrl(portfolioOmny, { width: 960, height: 960 })).toBe(
      "https://www.omnycontent.com/d/clips/9c1a4b9e-f661-4da4-8ca4-af3900d468eb/552b480a-d676-4899-a9b8-b39c01049404/0b5ba5c5-26a2-4697-96a7-b45f00d67fdc/image.jpg?t=1780578252&size=Large",
    );
  });

  it("warms connections for high-volume podcast image CDNs", () => {
    const html = read("index.html");

    expect(html).toContain('<link rel="preconnect" href="https://d3t3ozftmdmh3i.cloudfront.net"');
    expect(html).toContain('<link rel="preconnect" href="https://i1.sndcdn.com"');
    expect(html).toContain('<link rel="preconnect" href="https://megaphone.imgix.net"');
    expect(html).toContain('<link rel="preconnect" href="https://storage.buzzsprout.com"');
    expect(html).toContain('<link rel="preconnect" href="https://image.simplecastcdn.com"');
    expect(html).toContain('<link rel="preconnect" href="https://www.omnycontent.com"');
    expect(html).toContain('<link rel="preconnect" href="https://images.weserv.nl"');
    expect(html).toContain('<link rel="dns-prefetch" href="//pbcdn1.podbean.com"');
    expect(html).toContain('<link rel="dns-prefetch" href="//media.rss.com"');
  });

  it("downsizes major podcast CDN thumbnails instead of loading original artwork", () => {
    const image = read("src/lib/image.ts");
    const soundcloud = "http://i1.sndcdn.com/avatars-000204653867-hrztkz-original.jpg";
    const megaphone = "https://megaphone.imgix.net/podcasts/00126bac-1147-11ef-9b57-4bde938efee0/image/art.jpg?ixlib=rails-4.3.1&max-w=3000&max-h=3000&fit=crop&auto=format,compress";
    const simplecast = "https://image.simplecastcdn.com/images/a/b/3000x3000/show.jpg?aid=rss_feed";
    const transistor = "https://img.transistorcdn.com/key/rs:fill:0:0:1/w:1400/h:1400/q:60/mb:500000/source.jpg";

    expect(image).toContain('url.hostname.includes("sndcdn.com")');
    expect(image).toContain('url.hostname.endsWith(".imgix.net")');
    expect(image).toContain('url.hostname === "image.simplecastcdn.com"');
    expect(image).toContain('url.hostname === "img.transistorcdn.com"');

    expect(optimizedImageUrl(soundcloud, { width: 96, height: 96 })).toBe(
      "http://i1.sndcdn.com/avatars-000204653867-hrztkz-t300x300.jpg",
    );
    expect(optimizedImageUrl(megaphone, { width: 96, height: 96 })).toBe(
      "https://megaphone.imgix.net/podcasts/00126bac-1147-11ef-9b57-4bde938efee0/image/art.jpg?ixlib=rails-4.3.1&fit=crop&auto=format%2Ccompress&w=96&h=96&q=78",
    );
    expect(optimizedImageUrl(simplecast, { width: 96, height: 96 })).toBe(
      "https://image.simplecastcdn.com/images/a/b/96x96/show.jpg?aid=rss_feed",
    );
    expect(optimizedImageUrl(transistor, { width: 96, height: 96 })).toBe(
      "https://img.transistorcdn.com/key/rs:fill:0:0:1/w:96/h:96/q:78/mb:500000/source.jpg",
    );
  });

  it("proxies high-volume non-resizable podcast CDN artwork at rendered size", () => {
    const image = read("src/lib/image.ts");
    const anchorCloudfront = "https://d3t3ozftmdmh3i.cloudfront.net/staging/podcast_uploaded_nologo/25377869/25377869-1777663099901-c6e6422a4d959.jpg";
    const buzzsprout = "https://storage.buzzsprout.com/variants/abc123/cover.jpg";
    const rssCom = "https://media.rss.com/show/2026/cover.jpg";
    const podbean = "https://pbcdn1.podbean.com/imglogo/ep-logo/pbblog123/show.jpg";

    expect(image).toContain("const IMAGE_PROXY_HOSTS = new Set");
    expect(image).toContain('"d3t3ozftmdmh3i.cloudfront.net"');
    expect(image).toContain('"storage.buzzsprout.com"');
    expect(image).toContain('"media.rss.com"');
    expect(image).toContain('"pbcdn1.podbean.com"');
    expect(image).toContain("https://images.weserv.nl/");

    expect(optimizedImageUrl(anchorCloudfront, { width: 96, height: 96 })).toBe(
      "https://images.weserv.nl/?url=https%3A%2F%2Fd3t3ozftmdmh3i.cloudfront.net%2Fstaging%2Fpodcast_uploaded_nologo%2F25377869%2F25377869-1777663099901-c6e6422a4d959.jpg&w=96&h=96&fit=cover&q=78",
    );
    expect(optimizedImageUrl(buzzsprout, { width: 160, height: 160 })).toBe(
      "https://images.weserv.nl/?url=https%3A%2F%2Fstorage.buzzsprout.com%2Fvariants%2Fabc123%2Fcover.jpg&w=160&h=160&fit=cover&q=78",
    );
    expect(optimizedImageUrl(rssCom, { width: 80, height: 80 })).toBe(
      "https://images.weserv.nl/?url=https%3A%2F%2Fmedia.rss.com%2Fshow%2F2026%2Fcover.jpg&w=80&h=80&fit=cover&q=78",
    );
    expect(optimizedImageUrl(podbean, { width: 80, height: 80 })).toBe(
      "https://images.weserv.nl/?url=https%3A%2F%2Fpbcdn1.podbean.com%2Fimglogo%2Fep-logo%2Fpbblog123%2Fshow.jpg&w=80&h=80&fit=cover&q=78",
    );
  });

  it("uses episode thumbnails before podcast fallback in shared episode cards", () => {
    const card = read("src/components/EpisodeCard.tsx");

    expect(card).toContain("image_url?: string | null");
    expect(card).toContain("const coverImage = e.image_url || p.image_url || null");
    expect(card).toContain("const coverTitle = e.image_url ? epTitle : podTitle");
    expect(card).toContain("imageUrl: coverImage");
    expect(card).toContain("src={coverImage}");
    expect(card).not.toContain("imageUrl: p.image_url || null");
    expect(card).not.toContain("src={p.image_url}");
  });

  it("passes homepage rail episode images separately from podcast fallback images", () => {
    const index = read("src/pages/Index.tsx");
    const migration = read("supabase/migrations/20260605011500_homepage_rails_episode_images_wrapper.sql");

    expect(index).toContain("get_homepage_rails_with_images_v1");
    expect(index).toContain("image_url: r.episode_image_url || r.image_url || null");
    expect(index).toContain("image_url: r.podcast_image_url");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.get_homepage_rails_with_images_v1");
    expect(migration).toContain("jsonb_set(x.item, '{episode_image_url}', to_jsonb(e.image_url), true)");
    expect(migration).toContain("homepage_rails_image_policy");
  });

  it("requests episode images on public EpisodeList data sources", () => {
    const search = read("src/lib/search.ts");
    const category = read("src/pages/CategoryDetail.tsx");
    const daily = read("src/pages/DailyBriefPage.tsx");
    const entity = read("src/pages/EntityPage.tsx");
    const episodeDetail = read("src/pages/EpisodeDetail.tsx");
    const person = read("src/pages/PersonDetailPage.tsx");
    const topic = read("src/pages/TopicDetailPage.tsx");
    const searchHybrid = read("supabase/functions/search-hybrid/index.ts");

    expect(search).toContain("id,title,display_title,slug,image_url");
    expect(searchHybrid).toContain("id,title,display_title,slug,image_url");
    expect(category).toContain("id,title,display_title,slug,image_url");
    expect(category).toContain("episodes!inner(id,title,display_title,slug,image_url");
    expect(daily).toContain("id,title,display_title,slug,image_url");
    expect(daily).toContain("image_url: r.image_url");
    expect(entity).toContain("id,title,display_title,slug,image_url");
    expect(episodeDetail).toContain("id,title,display_title,slug,image_url");
    expect(person).toContain("id, title, display_title, slug, image_url");
    expect(topic).toContain("id, title, display_title, slug, image_url");
  });

  it("keeps personalized and related episode images distinct from podcast images", () => {
    const personalized = read("src/components/home/PersonalizedHomeRails.tsx");
    const recommendedForYou = read("src/components/taste/RecommendedForYou.tsx");
    const similar = read("src/components/SimilarEpisodes.tsx");
    const mood = read("src/pages/MoodCollectionPage.tsx");
    const tasteRecommend = read("supabase/functions/taste-recommend/index.ts");

    expect(personalized).toContain("image_url: r.podcast_image_url || null");
    expect(personalized).toContain("image_url: r.image_url || null");
    expect(personalized).not.toContain("image_url: r.podcast_image_url || r.image_url");
    expect(tasteRecommend).toContain("slug, image_url, published_at");
    expect(tasteRecommend).toContain("image_url: e.image_url");
    expect(recommendedForYou).toContain("image_url: string | null");
    expect(recommendedForYou).toContain("ep.image_url || ep.podcast?.image_url");
    expect(similar).toContain("image_url: r.image_url");
    expect(similar).toContain("id,image_url,topics,people,mentioned,companies");
    expect(mood).toContain("image_url: r.image_url || null");
  });

  it("uses episode artwork before podcast fallback in public share recommendations", () => {
    const shareRecs = read("src/components/share/ShareRecommendedEpisodes.tsx");

    expect(shareRecs).toContain("image_url?: string | null");
    expect(shareRecs).toContain("episode_image_url?: string | null");
    expect(shareRecs).toContain('rpc("get_homepage_rails_with_images_v1"');
    expect(shareRecs).toContain("const coverImage = ep.episode_image_url || ep.image_url || ep.podcast_image_url");
    expect(shareRecs).toContain("const coverTitle = ep.episode_image_url || ep.image_url ? title : podcastTitle");
    expect(shareRecs).toContain("src={coverImage}");
    expect(shareRecs).not.toContain('rpc("get_homepage_rails_v1"');
    expect(shareRecs).not.toContain("src={ep.podcast_image_url}");
  });

  it("optimizes search hero and smart player artwork instead of using raw feed images", () => {
    const searchPage = read("src/pages/SearchPage.tsx");
    const smartPlayer = read("src/components/smart-player/SmartPlayerBar.tsx");

    for (const source of [searchPage, smartPlayer]) {
      expect(source).toContain('import { imageSrcSet, optimizedImageUrl } from "@/lib/image"');
      expect(source).toContain("optimizedImageUrl(");
      expect(source).toContain("imageSrcSet(");
      expect(source).toContain('decoding="async"');
    }

    expect(searchPage).toContain("optimizedImageUrl(heroPodcast.image_url, { width: 128, height: 128 })");
    expect(searchPage).toContain("optimizedImageUrl(heroPerson.image_url, { width: 128, height: 128 })");
    expect(searchPage).toContain("optimizedImageUrl(heroOrganization.image_url, { width: 128, height: 128 })");
    expect(searchPage).toContain('alt={heroPerson.name}\n                  loading="eager"\n                  fetchPriority="high"');
    expect(searchPage).toContain('alt={(heroPodcast as any).display_title || heroPodcast.title}\n                  loading="eager"\n                  fetchPriority="high"');
    expect(searchPage).toContain('alt={heroOrganization.name}\n                  loading="eager"\n                  fetchPriority="high"');
    expect(searchPage).toContain("optimizedImageUrl(c.image_url, { width: 80, height: 80 })");
    expect(searchPage).toContain('alt={c.title}\n                        loading="lazy"\n                        fetchPriority="low"');
    expect(searchPage).not.toContain("<img src={heroPodcast.image_url}");
    expect(searchPage).not.toContain("<img src={heroPerson.image_url}");
    expect(searchPage).not.toContain("<img src={heroOrganization.image_url}");
    expect(searchPage).not.toContain("<img src={c.image_url}");

    expect(smartPlayer).toContain("optimizedImageUrl(ep.imageUrl, { width: 56, height: 56 })");
    expect(smartPlayer).toContain("optimizedImageUrl(ep.imageUrl, { width: 320, height: 320 })");
    expect(smartPlayer).toContain('sizes="40px"\n              alt=""\n              loading="eager"\n              fetchPriority="high"');
    expect(smartPlayer).toContain('sizes="224px"\n                alt=""\n                loading="lazy"\n                fetchPriority="low"');
    expect(smartPlayer).not.toContain("<img src={ep.imageUrl}");
  });

  it("optimizes public profile, account avatar and share-card artwork", () => {
    const publicProfile = read("src/pages/PublicProfilePage.tsx");
    const userMenu = read("src/components/UserMenu.tsx");
    const shareMoment = read("src/components/smart-player/ShareMomentCard.tsx");

    for (const source of [publicProfile, userMenu, shareMoment]) {
      expect(source).toContain('import { imageSrcSet, optimizedImageUrl } from "@/lib/image"');
      expect(source).toContain("optimizedImageUrl(");
      expect(source).toContain("imageSrcSet(");
      expect(source).toContain('decoding="async"');
    }

    expect(publicProfile).toContain("optimizedImageUrl(profile.avatar_url, { width: 96, height: 96 })");
    expect(publicProfile).toContain("optimizedImageUrl(e.podcasts.image_url, { width: 64, height: 64 })");
    expect(publicProfile).not.toContain("<img src={profile.avatar_url}");
    expect(publicProfile).not.toContain("<img src={e.podcasts.image_url}");

    expect(userMenu).toContain("optimizedImageUrl(profile.avatar_url, { width: 56, height: 56 })");
    expect(userMenu).not.toContain("<img src={profile.avatar_url}");

    expect(shareMoment).toContain("optimizedImageUrl(episode.imageUrl, { width: 128, height: 128 })");
    expect(shareMoment).toContain('crossOrigin="anonymous"');
    expect(shareMoment).not.toContain("src={episode.imageUrl}");
  });

  it("optimizes person avatars and Heti article covers on public pages", () => {
    const avatar = read("src/components/PersonAvatar.tsx");
    const personDetail = read("src/pages/PersonDetailPage.tsx");
    const hetiArticle = read("src/pages/HetiArticlePage.tsx");
    const orgCard = read("src/components/OrgCard.tsx");

    for (const source of [avatar, orgCard]) {
      expect(source).toContain('import { imageSrcSet, optimizedImageUrl } from "@/lib/image"');
      expect(source).toContain("optimizedImageUrl(");
      expect(source).toContain("imageSrcSet(");
      expect(source).toContain('decoding="async"');
    }
    expect(hetiArticle).toContain('import { imageSrcSetForAspect, optimizedImageUrl } from "@/lib/image"');
    expect(hetiArticle).toContain("optimizedImageUrl(");
    expect(hetiArticle).toContain("imageSrcSetForAspect(");
    expect(hetiArticle).toContain('decoding="async"');

    expect(avatar).toContain("const pixelSize = size === \"xl\" ? 160 : size === \"lg\" ? 112 : size === \"sm\" ? 56 : 80");
    expect(avatar).toContain("optimizedImageUrl(imageUrl, { width: pixelSize, height: pixelSize })");
    expect(avatar).toContain('fetchPriority = "low"');
    expect(avatar).toContain("fetchPriority={fetchPriority}");
    expect(personDetail).toContain('loading="eager" fetchPriority="high"');
    expect(avatar).not.toContain("src={imageUrl}");

    expect(hetiArticle).toContain("optimizedImageUrl(post.cover_image_url, { width: 960, height: 540 })");
    expect(hetiArticle).toContain('sizes="(max-width: 768px) 100vw, 768px"');
    expect(hetiArticle).toContain('fetchPriority="high"');
    expect(hetiArticle).not.toContain("src={post.cover_image_url}");
    expect(hetiArticle).not.toContain("imageSrcSet(post.cover_image_url, [640, 960, 1280])");

    expect(orgCard).toContain("optimizedImageUrl(o.logo_url, { width: 96, height: 96 })");
    expect(orgCard).toContain("imageSrcSet(o.logo_url, [48, 96, 144])");
    expect(orgCard).toContain('sizes="48px"');
    expect(orgCard).not.toContain("src={o.logo_url}");
  });

  it("keeps all-time toplist thumbnails optimized and non-empty", () => {
    const page = read("src/pages/ToplistaAllTimePage.tsx");

    expect(page).toContain('import { imageSrcSet, imageSrcSetForAspect, optimizedImageUrl } from "@/lib/image"');
    expect(page).toContain("function optimizedRowImage");
    expect(page).toContain("function rowImageSrcSet");
    expect(page).toContain("if (r.youtube_video_id) return undefined");
    expect(page).toContain("imageSrcSetForAspect(src, [320, 480, 640], 16 / 9)");
    expect(page).toContain("fetchPriority={i === 0 ? \"high\" : \"low\"}");
    expect(page).toContain('sizes="(max-width: 768px) 100vw, 33vw"');
    expect(page).toContain('sizes="56px"');
    expect(page).toContain("width={480}");
    expect(page).toContain("height={270}");
    expect(page).toContain("width={56}");
    expect(page).toContain("height={56}");
    expect(page).not.toContain('src={r.episode_image || r.podcast_image || ""}');
  });

  it("keeps repeated episode thumbnails lazy and low priority outside lead artwork", () => {
    const recommended = read("src/components/taste/RecommendedForYou.tsx");
    const library = read("src/components/home/MyLibraryRails.tsx");
    const continueListening = read("src/components/ContinueListening.tsx");
    const discovery = read("src/components/smart-player/SmartDiscoveryPanel.tsx");
    const related = read("src/components/smart-player/RelatedEpisodes.tsx");
    const profile = read("src/pages/PublicProfilePage.tsx");
    const account = read("src/pages/EnPodiverzumomPage.tsx");
    const startSwipe = read("src/pages/StartSwipePage.tsx");

    for (const source of [recommended, library, continueListening, discovery, related, profile, account, startSwipe]) {
      expect(source).toContain('loading="lazy"');
      expect(source).toContain('fetchPriority="low"');
      expect(source).toContain('decoding="async"');
    }

    expect(discovery).toContain("imageSrcSetForAspect(r.image_url || r.podcast_image_url, [200, 280, 360], 2)");
    expect(related).toContain("imageSrcSetForAspect(r.image_url || r.podcast_image_url, [180, 240, 320], 2)");
    expect(recommended).toContain("imageSrcSet(ep.image_url || ep.podcast?.image_url, [64, 96, 128])");
    expect(library).toContain("imageSrcSet(img, [56, 80, 112])");
    expect(continueListening).toContain("imageSrcSet(it.imageUrl, [56, 80, 112])");
    expect(account).toContain("imageSrcSet(e.podcasts.image_url, [48, 64, 96])");
    expect(account).toContain("imageSrcSet(p.image_url, [56, 80, 112])");
    expect(profile).toContain("imageSrcSet(e.podcasts.image_url, [48, 64, 96])");
    expect(startSwipe).toContain("imageSrcSet(src, [80, 112, 160])");
    expect(startSwipe).toContain("imageSrcSet(p.image, [128, 160, 240])");
  });

  it("prioritizes only the lead trending podcast cover while keeping list covers low priority", () => {
    const podcastCard = read("src/components/PodcastCard.tsx");
    const trending = read("src/components/TrendingPodcasts.tsx");
    const toplista = read("src/pages/ToplistaPage.tsx");

    expect(podcastCard).toContain('<PodcastCover title={title} src={p.image_url} loading="lazy" fetchPriority="low" />');
    expect(trending).toContain('loading={lead ? "eager" : "lazy"}');
    expect(trending).toContain('fetchPriority={lead ? "high" : "low"}');
    expect(toplista).toContain('<PodcastCover title={title} src={p.image_url} size="sm" loading="lazy" fetchPriority="low" />');
    expect(trending).not.toContain('<PodcastCover title={title} src={p.image_url} size={lead ? "lg" : undefined} />');
  });
});
