import { Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { X, Sparkles } from "lucide-react";
import { useSmartPlayer, formatTime } from "./SmartPlayerProvider";
import { PlayerProgress } from "./PlayerControls";
import { PlayerBrandMark } from "./BrandMark";
import { SmartDiscoveryPanel } from "./SmartDiscoveryPanel";
import { SmartPlayerChapters } from "./SmartPlayerChapters";
import { ShareMomentButton } from "./ShareMomentCard";
import { EpisodeMarks } from "@/components/EpisodeMarks";
import { LikeDislikeButtons } from "@/components/taste/LikeDislikeButtons";
import { t, formatSpeedLabel } from "@/lib/playerLocale";
import { SMART_PLAYER_RECOMMENDATIONS_ENABLED } from "./recommendationsConfig";
import { imageSrcSet, optimizedImageUrl } from "@/lib/image";


export function SmartPlayerBar() {
  const {
    playerVisible, currentEpisode, isPlaying, isLoading, error, flags,
    toggle, seekBy, currentTime, duration, expanded, setExpanded, stop, previewActive,
    playbackRate, setPlaybackRate, autoplayMode, setAutoplayMode,
  } = useSmartPlayer();

  const SPEEDS = [1, 1.25, 1.5, 1.75, 2, 0.75];
  const cycleSpeed = () => {
    const idx = SPEEDS.indexOf(playbackRate);
    const next = SPEEDS[(idx + 1) % SPEEDS.length] ?? 1;
    setPlaybackRate(next);
  };

  // Show whenever an episode is loaded (e.g., via list play buttons),
  // not just when flag-gated. Without this, taps on Play would have no UI feedback.
  if (!currentEpisode) return null;
  void playerVisible;

  const ep = currentEpisode;

  const href = ep.podcastSlug && ep.episodeSlug ? `/podcast/${ep.podcastSlug}/${ep.episodeSlug}` : null;
  const hasDuration = isFinite(duration) && duration > 0;
  const showPreviewChip = previewActive && !(flags.enabled && flags.show_on_public_episode_pages);

  return (
    <>
      <div
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        role="region"
        aria-label="Podiverzum lejátszó"
      >
        {showPreviewChip && (
          <div className="absolute -top-4 left-3 text-[8px] uppercase tracking-[0.16em] text-muted-foreground bg-card border border-border rounded-t px-1.5 py-0.5">
            {t("preview")}
          </div>
        )}
        <div className="container mx-auto px-3 py-2 flex items-center gap-3">
          {ep.imageUrl && (
            <img
              src={optimizedImageUrl(ep.imageUrl, { width: 56, height: 56 }) || ep.imageUrl}
              srcSet={imageSrcSet(ep.imageUrl, [40, 56, 80])}
              sizes="40px"
              alt=""
              loading="eager"
              fetchPriority="high"
              decoding="async"
              className="h-10 w-10 rounded-md object-cover shrink-0 border border-border"
            />
          )}
          <button
            className="min-w-0 flex-1 text-left"
            onClick={() => setExpanded(true)}
            aria-label={t("open")}
          >
            <div className="text-sm font-medium truncate">{ep.title}</div>
            <div className="text-[11px] text-muted-foreground truncate">
              {ep.podcastTitle}
              {hasDuration && (
                <span className="ml-2 tabular-nums">· {formatTime(currentTime)} / {formatTime(duration)}</span>
              )}
              {isLoading && !error && <span className="ml-2">· {t("loading")}</span>}
              {error && <span className="ml-2 text-amber-500">· {t("playbackError")}</span>}
            </div>
          </button>
          {!error && (
            <button
              onClick={cycleSpeed}
              className={`text-xs px-2 py-1 rounded-md border tabular-nums shrink-0 min-w-[44px] ${
                playbackRate !== 1
                  ? "border-primary bg-primary/15 text-primary font-semibold"
                  : "border-border bg-card hover:bg-secondary text-muted-foreground"
              }`}
              aria-label={`${t("playbackSpeed")}: ${formatSpeedLabel(playbackRate)}`}
              title={t("playbackSpeed")}
            >{formatSpeedLabel(playbackRate)}</button>
          )}
          {!error && SMART_PLAYER_RECOMMENDATIONS_ENABLED && (
            <div
              className="hidden xs:inline-flex items-center rounded-md border border-border bg-card/60 overflow-hidden shrink-0 sm:inline-flex"
              role="group"
              aria-label="Mit indítson az adás végén"
              title={
                autoplayMode === "series"
                  ? "Folytatás sorrendben: ugyanennek a műsornak a következő része indul"
                  : "Kapcsolódó: más műsorból hasonló téma indul"
              }
            >
              <button
                onClick={() => setAutoplayMode("related")}
                className={`text-[10px] uppercase tracking-wider px-2 py-1 transition-colors ${
                  autoplayMode === "related"
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                aria-pressed={autoplayMode === "related"}
              >Kapcsolódó</button>
              <button
                onClick={() => setAutoplayMode("series")}
                className={`text-[10px] uppercase tracking-wider px-2 py-1 transition-colors ${
                  autoplayMode === "series"
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                aria-pressed={autoplayMode === "series"}
              >Sorrendben</button>
            </div>
          )}
          {!error && (
            <div className="hidden sm:flex items-center gap-1">
              <button onClick={() => seekBy(-15)} className="text-xs px-2 py-1 rounded-md hover:bg-secondary" aria-label={t("back15")}>−15</button>
              <button onClick={() => seekBy(30)} className="text-xs px-2 py-1 rounded-md hover:bg-secondary" aria-label={t("fwd30")}>+30</button>
            </div>
          )}

          {error && ep.externalUrl ? (
            <a
              href={ep.externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground shrink-0"
            >{t("openOriginal")}</a>
          ) : (
            <button
              onClick={toggle}
              className="h-9 w-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0"
              aria-label={isPlaying ? t("pause") : t("play")}
            >
              {isPlaying ? "❚❚" : "▶"}
            </button>
          )}
          <div className="hidden sm:flex items-center gap-1.5 shrink-0">
            <EpisodeMarks episodeId={ep.id} compact />
          </div>
          <ShareMomentButton className="hidden sm:flex" />
          <button
            onClick={() => setExpanded(true)}
            className="inline-flex h-9 w-9 sm:h-auto sm:w-auto items-center justify-center gap-1 rounded-full border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 shrink-0 sm:px-2.5 sm:py-1 text-xs"
            aria-label={SMART_PLAYER_RECOMMENDATIONS_ENABLED ? "Kapcsolódó epizódok" : "Lejátszó részletei"}
            title={SMART_PLAYER_RECOMMENDATIONS_ENABLED ? "Kapcsolódó epizódok és értékelés" : "Lejátszó részletei és értékelés"}
          >
            <Sparkles className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
            <span className="hidden sm:inline font-medium tracking-wide">
              {SMART_PLAYER_RECOMMENDATIONS_ENABLED ? "Kapcsolódó" : "Részletek"}
            </span>
          </button>
          <button
            onClick={stop}
            className="h-9 w-9 rounded-full border border-border bg-background/60 text-muted-foreground hover:text-foreground hover:bg-secondary flex items-center justify-center shrink-0 transition-colors"
            aria-label={t("close")}
            title={t("close")}
          ><X className="h-4 w-4" /></button>
        </div>
        <div className="container mx-auto px-3 pb-2">
          <PlayerProgress compact />
        </div>
      </div>



      {expanded && (
        <div
          className="fixed inset-0 z-50 bg-background/95 backdrop-blur flex flex-col overflow-hidden"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
          role="dialog"
          aria-label="Podiverzum lejátszó részletei"
        >
          <PlayerBrandMark className="-right-10 -bottom-20" size={360} opacity={0.035} />
          <div className="flex items-center justify-between p-3 border-b border-border">
            <button onClick={() => setExpanded(false)} className="text-sm text-muted-foreground">▾ {t("close")}</button>
            <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-accent">
              <Sparkles className="h-3.5 w-3.5" />
              Podiverzum lejátszó
            </div>
            {href ? (
              <Link
                to={href}
                onClick={() => setExpanded(false)}
                className="text-xs text-accent hover:underline"
                title="Ugrás az epizód oldalára"
              >Epizód oldal ↗</Link>
            ) : <span className="w-20" />}

          </div>
          <div className="flex-1 overflow-auto p-6 flex flex-col items-center gap-5">
            {ep.imageUrl && (
              <img
                src={optimizedImageUrl(ep.imageUrl, { width: 320, height: 320 }) || ep.imageUrl}
                srcSet={imageSrcSet(ep.imageUrl, [224, 320, 448])}
                sizes="224px"
                alt=""
                loading="lazy"
                fetchPriority="low"
                decoding="async"
                className="h-56 w-56 rounded-xl object-cover border border-border"
              />
            )}
            <div className="text-center max-w-md">
              <div className="text-lg font-semibold">{ep.title}</div>
              <div className="text-sm text-muted-foreground mt-1">{ep.podcastTitle}</div>
              <div className="mt-3 flex flex-col items-center gap-1.5">
                <LikeDislikeButtons episodeId={ep.id} source="smart_player" />
                <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Tanítsd az ízlésed
                </div>
              </div>
            </div>

            {error ? (
              <div className="w-full max-w-md rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-center">
                <div className="mb-3">{t("fallbackUnavailable")}</div>
                {ep.externalUrl && (
                  <a
                    href={ep.externalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center text-sm px-4 py-2 rounded-md bg-primary text-primary-foreground"
                  >{t("openOriginal")}</a>
                )}
              </div>
            ) : (
              <>
                <div className="w-full max-w-md">
                  <PlayerProgress />
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => seekBy(-15)} className="px-3 py-2 rounded-md bg-secondary text-sm" aria-label={t("back15")}>−15s</button>
                  <button
                    onClick={toggle}
                    className="h-14 w-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-lg"
                    aria-label={isPlaying ? t("pause") : t("play")}
                  >
                    {isPlaying ? "❚❚" : "▶"}
                  </button>
                  <button onClick={() => seekBy(30)} className="px-3 py-2 rounded-md bg-secondary text-sm" aria-label={t("fwd30")}>+30s</button>
                </div>
                <SpeedSection />
                <div className="w-full max-w-2xl mt-2 border-t border-border pt-5">
                  <SmartPlayerChapters episodeId={ep.id} />
                </div>
                {SMART_PLAYER_RECOMMENDATIONS_ENABLED && (
                  <div className="w-full max-w-3xl mt-2 border-t border-border pt-5">
                    <SmartDiscoveryPanel />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function SpeedSection() {
  const { playbackRate, setPlaybackRate } = useSmartPlayer();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return (
    <div className="w-full max-w-md flex flex-col items-center gap-2" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
        aria-expanded={open}
      >
        {t("playbackSpeed")} · {formatSpeedLabel(playbackRate)}
      </button>
      {open && (
        <div className="w-full flex flex-wrap justify-center gap-2 px-4">
          {[0.5, 1, 1.25, 1.5, 2].map((s) => (
            <button
              key={s}
              onClick={() => { setPlaybackRate(s); setOpen(false); }}
              className={`text-xs px-3 py-1.5 rounded-md border min-w-[56px] ${
                playbackRate === s
                  ? "border-primary bg-primary/15 text-primary font-semibold"
                  : "border-border bg-card hover:bg-secondary"
              }`}
              aria-pressed={playbackRate === s}
            >{formatSpeedLabel(s)}</button>
          ))}
        </div>
      )}
    </div>
  );
}
