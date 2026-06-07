import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { optimizedImageUrl } from "@/lib/image";

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
    // Old tiny floating thumbnail must not return.
    expect(card).not.toContain('className="absolute left-3 top-3 w-16 rounded-md shadow-lg ring-1 ring-border/70 sm:w-20"');
  });

  it("keeps podcast episode thumbnails near rendered size", () => {
    const detail = read("src/pages/PodcastDetail.tsx");

    expect(detail).toContain("imageSize={96}");
    expect(detail).toContain("imageWidths={[64, 96, 160]}");
    expect(detail).toContain('sizes="(max-width: 640px) 64px, 80px"');
    expect(detail).not.toContain("imageWidths={[96, 160, 240]}");
  });

  it("downsizes Omny episode artwork instead of loading large Portfolio thumbnails", () => {
    const image = read("src/lib/image.ts");
    const largeOmny = "https://www.omnycontent.com/d/clips/show/episode/image.jpg?t=1780578252&amp;size=Large";

    expect(image).toContain('url.hostname.includes("omnycontent.com")');
    expect(image).toContain('url.searchParams.set("size", width <= 160 ? "Small" : width <= 360 ? "Medium" : "Large")');
    expect(optimizedImageUrl(largeOmny, { width: 96, height: 96 })).toBe(
      "https://www.omnycontent.com/d/clips/show/episode/image.jpg?t=1780578252&size=Small",
    );
    expect(optimizedImageUrl(largeOmny, { width: 280, height: 140 })).toBe(
      "https://www.omnycontent.com/d/clips/show/episode/image.jpg?t=1780578252&size=Medium",
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

  it("keeps all-time toplist thumbnails optimized and non-empty", () => {
    const page = read("src/pages/ToplistaAllTimePage.tsx");

    expect(page).toContain('import { imageSrcSet, optimizedImageUrl } from "@/lib/image"');
    expect(page).toContain("function optimizedRowImage");
    expect(page).toContain("function rowImageSrcSet");
    expect(page).toContain("if (r.youtube_video_id) return undefined");
    expect(page).toContain("fetchPriority={i === 0 ? \"high\" : \"auto\"}");
    expect(page).toContain('sizes="(max-width: 768px) 100vw, 33vw"');
    expect(page).toContain('sizes="56px"');
    expect(page).toContain("width={480}");
    expect(page).toContain("height={270}");
    expect(page).toContain("width={56}");
    expect(page).toContain("height={56}");
    expect(page).not.toContain('src={r.episode_image || r.podcast_image || ""}');
  });
});
