import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowLeft, ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import Layout from "@/components/Layout";
import NotFoundState from "@/components/NotFoundState";
import { PodcastDetailSkeleton } from "@/components/Skeletons";
import { PodcastCover } from "@/components/PodcastCover";
import { supabase } from "@/integrations/supabase/client";
import { breadcrumbJsonLd, ogImageUrl, setSeo } from "@/lib/seo";
import { snippet, stripHtml } from "@/lib/text";
import { useSmartPlayer } from "@/components/smart-player/SmartPlayerProvider";
import { playableAudioUrl } from "@/lib/playerAudio";
import { playbackPageUrl } from "@/lib/playerFallback";
import {
  ANNUAL_ARCHIVE_MIN_EPISODES,
  ANNUAL_ARCHIVE_PAGE_SIZE,
  buildArchivePaginationMeta,
  formatAnnualArchiveCopy,
  parseStrictArchivePage,
  parseStrictArchiveYear,
  podcastYearArchiveCanonicalUrl,
  podcastYearArchivePath,
} from "../../supabase/functions/_shared/podcast-annual-archive";

type ArchivePayload = {
  found: boolean;
  reason?: string;
  podcast?: {
    id: string;
    slug: string;
    title: string;
    display_title: string | null;
    image_url: string | null;
  };
  year?: number;
  page?: number;
  page_size?: number;
  total_count?: number;
  total_pages?: number;
  episodes?: Array<{
    id: string;
    slug: string;
    title: string;
    display_title: string | null;
    published_at: string | null;
    card_summary: string | null;
    summary: string | null;
    description: string | null;
    audio_url: string | null;
    audio_health_status: string | null;
    audio_manual_override: string | null;
    image_url: string | null;
    episode_url: string | null;
    spotify_url: string | null;
    apple_url: string | null;
    youtube_url: string | null;
  }>;
  available_years?: Array<{ year: number; episode_count: number }>;
  years?: Array<{ year: number; episode_count: number }>;
};

export default function PodcastYearArchivePage() {
  const { podcastSlug, year: yearParam, page: pageParam } = useParams();
  const [redirectTo, setRedirectTo] = useState<string | null>(null);
  const [archive, setArchive] = useState<ArchivePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const { play, toggle, currentEpisode, isPlaying } = useSmartPlayer();

  const parsedYear = parseStrictArchiveYear(yearParam);
  const parsedPage = pageParam === undefined ? 1 : parseStrictArchivePage(pageParam);

  useEffect(() => {
    let cancelled = false;
    setRedirectTo(null);
    setArchive(null);

    if (!podcastSlug || !parsedYear || !parsedPage) {
      setLoading(false);
      setSeo({
        title: "Az archívum oldal nem található | Podiverzum",
        description: "A keresett éves archívum oldal nem létezik.",
        noindex: true,
      });
      return;
    }

    (async () => {
      setLoading(true);
      const { data: redirRows } = await (supabase as any).rpc("resolve_podcast_redirect_v1", {
        p_podcast_slug: podcastSlug,
        p_episode_slug: null,
        p_year: parsedYear,
        p_page: parsedPage,
      });
      const redir = Array.isArray(redirRows) ? redirRows[0] : redirRows;
      if (!cancelled && typeof redir?.redirect_path === "string" && redir.redirect_path) {
        setRedirectTo(redir.redirect_path);
        setLoading(false);
        return;
      }

      if (!cancelled && pageParam !== undefined && parsedPage === 1) {
        setRedirectTo(podcastYearArchivePath(podcastSlug, parsedYear, 1));
        setLoading(false);
        return;
      }

      const { data, error } = await (supabase as any).rpc("get_podcast_year_archive_page_v1", {
        p_podcast_slug: podcastSlug,
        p_year: parsedYear,
        p_page: parsedPage,
        p_page_size: ANNUAL_ARCHIVE_PAGE_SIZE,
      });
      if (cancelled) return;
      if (error || !data?.found || !data?.podcast || Number(data.total_count || 0) < ANNUAL_ARCHIVE_MIN_EPISODES) {
        setArchive(null);
        setLoading(false);
        setSeo({
          title: "Az archívum oldal nem található | Podiverzum",
          description: "A keresett éves archívum oldal nem létezik vagy üres.",
          noindex: true,
        });
        return;
      }

      const payload = data as ArchivePayload;
      setArchive(payload);
      setLoading(false);

      const pod = payload.podcast!;
      const podTitle = pod.display_title || pod.title;
      const totalCount = Number(payload.total_count || 0);
      const pagination = buildArchivePaginationMeta(pod.slug, parsedYear, parsedPage, totalCount, ANNUAL_ARCHIVE_PAGE_SIZE);
      const site = "https://podiverzum.hu";
      const canonical = podcastYearArchiveCanonicalUrl(site, pod.slug, parsedYear, parsedPage);
      const copy = formatAnnualArchiveCopy({
        podcastTitle: podTitle,
        year: parsedYear,
        page: parsedPage,
        totalCount,
        totalPages: pagination.totalPages,
        startIndex: pagination.startIndex,
        endIndex: pagination.endIndex,
      });

      setSeo({
        title: copy.title,
        description: copy.description,
        canonical,
        prevHref: pagination.prevPath ? `${site}${pagination.prevPath}` : null,
        nextHref: pagination.nextPath ? `${site}${pagination.nextPath}` : null,
        image: ogImageUrl({ kind: "podcast", title: `${podTitle} (${parsedYear})`, subtitle: "Archívum", image: pod.image_url }),
        jsonLd: [
          {
            "@context": "https://schema.org",
            "@type": "ItemList",
            name: copy.heading,
            numberOfItems: totalCount,
            itemListElement: (payload.episodes || []).map((e, i) => ({
              "@type": "ListItem",
              position: pagination.startIndex + i,
              url: `${site}/podcast/${pod.slug}/${e.slug}`,
              name: e.display_title || e.title,
            })),
          },
          breadcrumbJsonLd([
            { name: "Podcastek", url: `${site}/toplista` },
            { name: podTitle, url: `${site}/podcast/${pod.slug}` },
            { name: `Epizódok ${parsedYear}`, url: podcastYearArchiveCanonicalUrl(site, pod.slug, parsedYear, 1) },
            ...(parsedPage > 1 ? [{ name: `${parsedPage}. oldal`, url: canonical }] : []),
          ]),
        ],
      });
    })();

    return () => { cancelled = true; };
  }, [podcastSlug, parsedYear, parsedPage, pageParam]);

  if (redirectTo) return <Navigate to={redirectTo} replace />;
  if (loading) return <Layout><PodcastDetailSkeleton /></Layout>;
  if (!archive?.found || !archive.podcast || !parsedYear || !parsedPage) {
    return (
      <NotFoundState
        title="Az archívum oldal nem található"
        message="A megadott év vagy oldalszám nem létezik ehhez a podcasthoz."
      />
    );
  }

  const pod = archive.podcast;
  const podTitle = pod.display_title || pod.title;
  const eps = archive.episodes || [];
  const totalCount = Number(archive.total_count || 0);
  const pagination = buildArchivePaginationMeta(pod.slug, parsedYear, parsedPage, totalCount, ANNUAL_ARCHIVE_PAGE_SIZE);
  const copy = formatAnnualArchiveCopy({
    podcastTitle: podTitle,
    year: parsedYear,
    page: parsedPage,
    totalCount,
    totalPages: pagination.totalPages,
    startIndex: pagination.startIndex,
    endIndex: pagination.endIndex,
  });
  const availableYears = (archive.available_years || archive.years || []).filter((y) => y.episode_count >= ANNUAL_ARCHIVE_MIN_EPISODES);

  const PaginationBar = () => {
    if (pagination.totalPages <= 1) return null;
    return (
      <nav aria-label="Oldalszámozás" className="my-6 flex flex-wrap items-center justify-between gap-3 border-y border-border py-3">
        <div className="flex items-center gap-2">
          {pagination.prevPath ? (
            <Link
              to={pagination.prevPath}
              rel="prev"
              className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary"
            >
              <ChevronLeft className="h-4 w-4" /> Előző
            </Link>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md border border-border/50 px-3 py-1.5 text-sm text-muted-foreground opacity-50">
              <ChevronLeft className="h-4 w-4" /> Előző
            </span>
          )}
          {pagination.nextPath ? (
            <Link
              to={pagination.nextPath}
              rel="next"
              className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary"
            >
              Következő <ChevronRight className="h-4 w-4" />
            </Link>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md border border-border/50 px-3 py-1.5 text-sm text-muted-foreground opacity-50">
              Következő <ChevronRight className="h-4 w-4" />
            </span>
          )}
        </div>
        <ol className="flex flex-wrap items-center gap-1.5">
          {pagination.pageNumbers.map((item, idx) =>
            item === "ellipsis" ? (
              <li key={`el-${idx}`} className="px-1.5 text-sm text-muted-foreground">…</li>
            ) : item === parsedPage ? (
              <li key={item}>
                <span aria-current="page" className="inline-flex min-w-8 items-center justify-center rounded-md bg-primary px-2.5 py-1 text-sm font-semibold text-primary-foreground">
                  {item}
                </span>
              </li>
            ) : (
              <li key={item}>
                <Link
                  to={podcastYearArchivePath(pod.slug, parsedYear, item)}
                  className="inline-flex min-w-8 items-center justify-center rounded-md border border-border bg-card px-2.5 py-1 text-sm text-foreground transition-colors hover:border-primary/40 hover:text-primary"
                >
                  {item}
                </Link>
              </li>
            )
          )}
        </ol>
      </nav>
    );
  };

  return (
    <Layout>
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="mb-4">
          <Link
            to={`/podcast/${pod.slug}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-primary"
          >
            <ArrowLeft className="h-4 w-4" /> {podTitle}
          </Link>
        </div>

        <header className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl">
            <PodcastCover
              src={pod.image_url}
              title={podTitle}
              size="md"
              className="h-full w-full"
            />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {copy.heading}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {copy.intro}
            </p>
          </div>
        </header>

        {availableYears.length > 1 && (
          <nav aria-label="Évek választása" className="mt-6 flex flex-wrap gap-2">
            {availableYears.map((y) => (
              <Link
                key={y.year}
                to={podcastYearArchivePath(pod.slug, y.year, 1)}
                aria-current={y.year === parsedYear ? "page" : undefined}
                className={
                  y.year === parsedYear
                    ? "inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
                    : "inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:border-primary/40 hover:text-primary"
                }
              >
                <span>{y.year}</span>
                <span className="text-xs opacity-75">{y.episode_count}</span>
              </Link>
            ))}
          </nav>
        )}

        <PaginationBar />

        <ol className="divide-y divide-border" start={pagination.startIndex}>
          {eps.map((ep) => {
            const audioUrl = playableAudioUrl(ep);
            const isCurrent = currentEpisode?.id === ep.id;
            const summaryText = snippet(stripHtml(ep.card_summary || ep.summary || ep.description || ""), 220);
            return (
              <li key={ep.id} className="py-4">
                <div className="flex items-start gap-3">
                  {audioUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        if (isCurrent) {
                          toggle();
                          return;
                        }
                        play({
                          id: ep.id,
                          title: ep.display_title || ep.title,
                          podcastId: pod.id,
                          podcastTitle: podTitle,
                          podcastSlug: pod.slug,
                          episodeSlug: ep.slug,
                          imageUrl: ep.image_url || pod.image_url || null,
                          audioUrl,
                          externalUrl: playbackPageUrl(ep, audioUrl),
                        });
                      }}
                      aria-label={isCurrent && isPlaying ? "Szünet" : `Lejátszás: ${ep.display_title || ep.title}`}
                      className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card text-foreground transition-colors hover:border-primary hover:text-primary"
                    >
                      {isCurrent && isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}
                    </button>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <Link
                        to={`/podcast/${pod.slug}/${ep.slug}`}
                        className="font-medium text-foreground transition-colors hover:text-primary"
                      >
                        {ep.display_title || ep.title}
                      </Link>
                      {ep.published_at && (
                        <time dateTime={ep.published_at} className="shrink-0 text-xs text-muted-foreground">
                          {ep.published_at.slice(0, 10)}
                        </time>
                      )}
                    </div>
                    {summaryText && (
                      <p className="mt-1 text-sm text-muted-foreground">{summaryText}</p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        <PaginationBar />
      </div>
    </Layout>
  );
}