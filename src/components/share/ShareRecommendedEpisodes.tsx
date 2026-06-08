import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Pause, Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PodcastCover } from "@/components/PodcastCover";
import { Skeleton } from "@/components/ui/skeleton";
import { logPlayerEvent } from "@/lib/playerEvents";

type Row = {
  episode_id: string;
  title: string;
  display_title: string | null;
  slug: string;
  image_url?: string | null;
  episode_image_url?: string | null;
  audio_url: string | null;
  topics: string[] | null;
  podcast_id: string;
  podcast_slug: string;
  podcast_title: string;
  podcast_display_title: string | null;
  podcast_image_url: string | null;
};

type Props = {
  tags?: string[];
  shareId?: string | null;
  autoplayTop?: boolean;
};

const LIMIT = 3;
const PREVIEW_SECONDS = 25;
const NEWS_LIKE_RX = /\b(hírek|hír|hírösszefoglaló|hírháttér|hírpercek|krónika|infostart|napi hírek|reggeli hírek|esti hírek|friss hírek|news|bulletin)\b/i;
const BULLETIN_LIKE_RX = /\b(hírek röviden|röviden|hírpercek|hírgyors|napi hírek|friss hírek|reggeli hírek|déli hírek|esti hírek|éjszakai hírek|hírösszefoglaló|infostart hírek|percben|perces hír|bulletin)\b/i;
const INTEREST_GROUPS: Record<string, string[]> = {
  tech: ["tech", "technológia", "technologia", "mi", "ai", "mesterséges intelligencia", "startup", "jövő", "jovo", "digitális", "digitalis"],
  business: ["gazdaság", "gazdasag", "pénz", "penz", "pénzügy", "penzugy", "üzlet", "uzlet", "business", "befektetés", "befektetes", "tőzsde", "tozsde", "vállalkozás", "vallalkozas", "karrier"],
  public_affairs: ["közélet", "kozelet", "politika", "hírek", "hirek", "társadalom", "tarsadalom", "geopolitika", "közbeszéd", "kozbeszed"],
  culture: ["kultúra", "kultura", "film", "mozi", "sorozat", "zene", "könyv", "konyv", "irodalom", "színház", "szinhaz"],
  science: ["tudomány", "tudomany", "űr", "ur", "kutatás", "kutatas", "természet", "termeszet"],
  mind: ["pszichológia", "pszichologia", "mentális", "mentalis", "önismeret", "onismeret", "lélek", "lelek"],
  health: ["egészség", "egeszseg", "életmód", "eletmod", "orvos", "sport", "edzés", "edzes"],
  crime: ["bűnügy", "bunugy", "true crime", "krimi", "nyomozás", "nyomozas"],
  travel: ["utazás", "utazas", "világ", "vilag", "külföld", "kulfold"],
  food: ["gasztronómia", "gasztronomia", "kaja", "étel", "etel", "főzés", "fozes"],
  humor: ["humor", "standup", "stand-up", "szórakozás", "szorakozas"],
};

function normalizeInterest(value: string | null | undefined): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function interestGroupsForText(value: string | null | undefined): string[] {
  const text = normalizeInterest(value);
  if (!text) return [];
  const groups: string[] = [];
  for (const [group, terms] of Object.entries(INTEREST_GROUPS)) {
    if (terms.some((term) => text.includes(normalizeInterest(term)))) groups.push(group);
  }
  return groups;
}

function expandTasteTags(tags: string[]): Set<string> {
  const out = new Set<string>();
  for (const tag of tags) {
    const normalized = normalizeInterest(tag);
    if (!normalized || normalized.length < 3) continue;
    out.add(normalized);
    for (const group of interestGroupsForText(normalized)) {
      out.add(group);
      for (const term of INTEREST_GROUPS[group] || []) out.add(normalizeInterest(term));
    }
  }
  return out;
}

function rowHaystack(r: Row): string {
  return [
    r.title,
    r.display_title,
    r.podcast_title,
    r.podcast_display_title,
    ...(r.topics || []),
  ].filter(Boolean).join(" ").toLowerCase();
}

function rowInterestKeys(r: Row): Set<string> {
  const keys = new Set<string>();
  for (const value of [rowHaystack(r), ...(r.topics || [])]) {
    const normalized = normalizeInterest(value);
    if (normalized.length >= 3) keys.add(normalized);
    for (const group of interestGroupsForText(value)) keys.add(group);
  }
  return keys;
}

function isBulletinLike(r: Row): boolean {
  return BULLETIN_LIKE_RX.test(rowHaystack(r)) || /^\s*\d{1,2}\s*[-–—]\s+/.test(r.title || "");
}

function isNewsLike(r: Row): boolean {
  return isBulletinLike(r) || NEWS_LIKE_RX.test(rowHaystack(r));
}

function newsPolicyForTags(tags: string[]): { allowNews: boolean; allowBulletins: boolean } {
  const expanded = expandTasteTags(tags);
  const signal = ["public_affairs", "kozelet", "közélet", "politika", "hirek", "hírek", "geopolitika"]
    .filter((key) => expanded.has(normalizeInterest(key))).length;
  return {
    allowNews: signal >= 3,
    allowBulletins: signal >= 5,
  };
}

/**
 * Recommended episodes shown on the public share page.
 * Goal: convert FB-driven swipe-share traffic into real listens BEFORE they bounce.
 * Picks top-ranked fresh HU episodes; if `tags` provided, re-ranks by topic overlap.
 */
export function ShareRecommendedEpisodes({ tags, shareId, autoplayTop = false }: Props) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const since30d = new Date(Date.now() - 30 * 86400_000).toISOString();
      const { data: rails } = await supabase
        .rpc("get_homepage_rails_with_images_v1" as never, {
          _trending_limit: 20,
          _evergreen_limit: 10,
          _category_limit: 0,
          _max_categories: 0,
        } as never);

      let data = [
        ...(((rails as any)?.trending ?? []) as any[]),
        ...(((rails as any)?.evergreen ?? []) as any[]),
      ];

      if (!data.length) {
        const fallback = await supabase
          .from("mv_homepage_feed" as any)
          .select("episode_id,title,display_title,slug,audio_url,topics,podcast_id,podcast_slug,podcast_title,podcast_display_title,podcast_image_url,pod_rank,published_at")
          .gte("published_at", since30d)
          .lte("pod_rank", 4)
          .not("audio_url", "is", null)
          .order("published_at", { ascending: false, nullsFirst: false })
          .limit(60);
        data = fallback.data || [];
      }

      if (cancelled || !data.length) return;

      const inputTags = tags ?? [];
      const tagSet = expandTasteTags(inputTags);
      const newsPolicy = newsPolicyForTags(inputTags);
      const scored = (data as Row[]).map((r, index) => {
        const keys = rowInterestKeys(r);
        let overlap = 0;
        for (const key of keys) if (tagSet.has(key)) overlap += 1;
        const bulletinPenalty = isBulletinLike(r) ? (newsPolicy.allowBulletins ? -10 : -80) : 0;
        const newsPenalty = isNewsLike(r) ? (newsPolicy.allowNews ? -3 : -30) : 0;
        const audioPenalty = r.audio_url ? 0 : -100;
        const orderScore = Math.max(0, 8 - index / 2);
        return { r, score: overlap * 20 + orderScore + bulletinPenalty + newsPenalty + audioPenalty };
      });
      scored.sort((a, b) => b.score - a.score);

      const picked: Row[] = [];
      const seenPodcasts = new Set<string>();
      for (const s of scored) {
        if (picked.length >= LIMIT) break;
        if (seenPodcasts.has(s.r.podcast_id)) continue;
        if (!s.r.audio_url) continue;
        if (!newsPolicy.allowBulletins && isBulletinLike(s.r)) continue;
        if (!newsPolicy.allowNews && isNewsLike(s.r)) continue;
        picked.push(s.r as Row);
        seenPodcasts.add(s.r.podcast_id);
      }
      setRows(picked);
    })();
    return () => { cancelled = true; };
  }, [tags?.join("|")]);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const startPlayback = (ep: Row) => {
    if (!ep.audio_url) return;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    const a = new Audio(ep.audio_url);
    a.preload = "none";
    audioRef.current = a;
    const stopAsComplete = () => {
      a.pause();
      setPlayingId(null);
      logPlayerEvent({
        eventType: "play_complete",
        episodeId: ep.episode_id,
        podcastId: ep.podcast_id,
        meta: { source: "share_recommendations", share_id: shareId ?? null, preview_capped: true },
      });
    };
    a.ontimeupdate = () => {
      if (a.currentTime >= PREVIEW_SECONDS) stopAsComplete();
    };
    a.onended = () => {
      setPlayingId(null);
      logPlayerEvent({
        eventType: "play_complete",
        episodeId: ep.episode_id,
        podcastId: ep.podcast_id,
        meta: { source: "share_recommendations", share_id: shareId ?? null },
      });
    };
    a.play().then(() => {
      setPlayingId(ep.episode_id);
      logPlayerEvent({
        eventType: "play_start",
        episodeId: ep.episode_id,
        podcastId: ep.podcast_id,
        meta: { source: "share_recommendations", share_id: shareId ?? null },
      });
    }).catch(() => {
      setPlayingId(null);
    });
  };

  const togglePlay = (ep: Row) => {
    if (!ep.audio_url) return;
    if (playingId === ep.episode_id && audioRef.current) {
      audioRef.current.pause();
      logPlayerEvent({
        eventType: "play_pause",
        episodeId: ep.episode_id,
        podcastId: ep.podcast_id,
        meta: { source: "share_recommendations", share_id: shareId ?? null },
      });
      setPlayingId(null);
      return;
    }
    startPlayback(ep);
  };

  // Autoplay top recommendation as an audio reward (best-effort; mobile may block).
  useEffect(() => {
    if (!autoplayTop || !rows || rows.length === 0) return;
    const top = rows[0];
    if (!top.audio_url) return;
    const t = window.setTimeout(() => startPlayback(top), 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoplayTop, rows?.[0]?.episode_id]);

  const heading = useMemo(() => {
    return tags && tags.length > 0
      ? "Hallgasd most — neked való epizódok"
      : "Hallgasd most — friss magyar epizódok";
  }, [tags]);

  if (rows === null) {
    return (
      <section className="mt-10">
        <div className="mb-3 text-[10px] uppercase tracking-[0.25em] text-primary">Ajánljuk</div>
        <h2 className="mb-4 text-xl font-semibold md:text-2xl">{heading}</h2>
        <div className="space-y-3">
          {Array.from({ length: LIMIT }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-2xl" />
          ))}
        </div>
      </section>
    );
  }

  if (rows.length === 0) return null;

  return (
    <section className="mt-10" aria-labelledby="share-recs-heading">
      <div className="mb-3 text-[10px] uppercase tracking-[0.25em] text-primary">Ajánljuk</div>
      <h2 id="share-recs-heading" className="mb-4 text-xl font-semibold md:text-2xl">
        {heading}
      </h2>
      <ul className="space-y-3">
        {rows.map((ep, idx) => {
          const epHref = `/podcast/${ep.podcast_slug}/${ep.slug}`;
          const isPlaying = playingId === ep.episode_id;
          const title = ep.display_title || ep.title;
          const podcastTitle = ep.podcast_display_title || ep.podcast_title;
          const coverImage = ep.episode_image_url || ep.image_url || ep.podcast_image_url;
          const coverTitle = ep.episode_image_url || ep.image_url ? title : podcastTitle;
          const isTop = idx === 0;
          return (
            <li
              key={ep.episode_id}
              className={`group flex items-center gap-3 rounded-2xl border bg-card p-3 transition hover:shadow-sm ${
                isTop ? "border-primary/50 ring-1 ring-primary/20" : "border-border hover:border-primary/40"
              }`}
            >
              <button
                onClick={() => togglePlay(ep)}
                disabled={!ep.audio_url}
                className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted disabled:opacity-50"
                aria-label={isPlaying ? `Szünet: ${title}` : `Lejátszás: ${title}`}
              >
                <PodcastCover
                  src={coverImage}
                  title={coverTitle}
                  className="absolute inset-0 h-full w-full"
                />
                <span className="relative z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/70 text-white backdrop-blur-sm">
                  {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-[1px]" />}
                </span>
              </button>
              <Link to={epHref} className="min-w-0 flex-1">
                {isTop && (
                  <div className="mb-0.5 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-primary">
                    {isPlaying ? `Előnézet · ${PREVIEW_SECONDS}s` : "Ízlésed alapján"}
                  </div>
                )}
                <div className="truncate text-[11px] uppercase tracking-wider text-muted-foreground">
                  {podcastTitle}
                </div>
                <div className="line-clamp-2 text-sm font-medium leading-snug text-foreground group-hover:text-primary">
                  {title}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 text-center">
        <Link
          to="/"
          className="inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Több epizód a főoldalon →
        </Link>
      </div>
    </section>
  );
}
