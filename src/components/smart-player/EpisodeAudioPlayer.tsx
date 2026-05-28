import { useSmartPlayer, SmartPlayerEpisode, detectAudioSource } from "./SmartPlayerProvider";
import { PlayerProgress } from "./PlayerControls";
import { SmartDiscoveryPanel } from "./SmartDiscoveryPanel";
import { getProgress } from "@/lib/playerProgress";
import { t, formatSpeedLabel } from "@/lib/playerLocale";
import { PlayerBrandMark } from "./BrandMark";
import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EpisodeMarks } from "@/components/EpisodeMarks";
import { ShareMomentButton } from "./ShareMomentCard";

type Props = {
  episode: {
    id: string;
    title: string;
    display_title?: string | null;
    audio_url?: string | null;
    episode_url?: string | null;
    image_url?: string | null;
    slug?: string | null;
  };
  podcast: {
    id: string;
    title: string;
    display_title?: string | null;
    image_url?: string | null;
    slug?: string | null;
  };
};

export function EpisodeAudioPlayer({ episode, podcast }: Props) {
  const {
    playerVisible, previewActive, flags, currentEpisode, isPlaying, error,
    play, toggle, seekBy, playbackRate, setPlaybackRate,
  } = useSmartPlayer();
  if (!playerVisible) return null;

  const showPreviewLabel = previewActive && !(flags.enabled && flags.show_on_public_episode_pages);
  const src = detectAudioSource(episode);
  const epTitle = episode.display_title || episode.title;
  const podTitle = podcast.display_title || podcast.title;
  const img = episode.image_url || podcast.image_url || null;
  const externalHref = episode.episode_url || episode.audio_url || null;

  const isCurrent = currentEpisode?.id === episode.id;
  const showErrorFallback = isCurrent && !!error;

  if (!src || showErrorFallback) {
    return (
      <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
        {showPreviewLabel && (
          <div className="text-[10px] uppercase tracking-[0.18em] text-amber-500/80 mb-1">
            {t("preview")}
          </div>
        )}
        <div className="mb-3">{t("fallbackUnavailable")}</div>
        {externalHref && (
          <a
            href={externalHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground"
          >{t("openOriginal")}</a>
        )}
      </div>
    );
  }

  const ep: SmartPlayerEpisode = {
    id: episode.id,
    title: epTitle,
    podcastId: podcast.id,
    podcastTitle: podTitle,
    podcastSlug: podcast.slug || null,
    episodeSlug: episode.slug || null,
    imageUrl: img,
    audioUrl: src.url,
    externalUrl: externalHref,
  };
  const prog = getProgress(episode.id);
  const canResume = !!prog && prog.currentTime > 30 && !prog.completed;

  const onPrimary = () => (isCurrent ? toggle() : play(ep, { resume: canResume }));

  return (
    <div className="relative mt-5 rounded-2xl border border-border bg-card p-4 overflow-hidden">
      <PlayerBrandMark className="-right-6 -bottom-12" size={220} opacity={0.045} />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-[hsl(var(--brand-red)/0.05)]"
      />
      <div className="relative">
        {showPreviewLabel && (
          <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t("preview")}
          </div>
        )}
        <div className="flex gap-4">
          {img && (
            <img
              src={img}
              alt=""
              className="h-20 w-20 rounded-lg object-cover shrink-0 border border-border"
              loading="lazy"
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate" title={epTitle}>{epTitle}</div>
                <div className="text-xs text-muted-foreground truncate">{podTitle}</div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <EpisodeMarks episodeId={episode.id} compact />
                {isCurrent && <ShareMomentButton />}
              </div>
            </div>
            {canResume && !isCurrent && (
              <div className="mt-2">
                <button
                  onClick={() => play(ep, { resume: true })}
                  className="text-xs px-2 py-1 rounded-md bg-secondary"
                >{t("resumeFrom")}</button>
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <button
            onClick={() => isCurrent && seekBy(-15)}
            disabled={!isCurrent}
            className="px-2 py-1 rounded-md text-xs hover:bg-secondary disabled:opacity-40"
            aria-label={t("back15")}
          >−15s</button>
          <button
            onClick={onPrimary}
            className="h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-base shadow-[0_4px_18px_-6px_hsl(var(--brand-red)/0.55)]"
            aria-label={isCurrent && isPlaying ? t("pause") : t("play")}
          >
            {isCurrent && isPlaying ? "❚❚" : "▶"}
          </button>
          <button
            onClick={() => isCurrent && seekBy(30)}
            disabled={!isCurrent}
            className="px-2 py-1 rounded-md text-xs hover:bg-secondary disabled:opacity-40"
            aria-label={t("fwd30")}
          >+30s</button>
          <SpeedPicker
            disabled={!isCurrent}
            value={playbackRate}
            onChange={setPlaybackRate}
          />
        </div>
        {isCurrent && (
          <div className="mt-3">
            <PlayerProgress />
          </div>
        )}
      </div>

      <div className="relative mt-6 border-t border-border pt-5">
        <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-accent" />
          <span>Smart Player ajánlások</span>
        </div>
        <SmartDiscoveryPanel episodeIdOverride={episode.id} variant="compact" />
      </div>
    </div>
  );
}



function SpeedPicker({
  value, onChange, disabled,
}: { value: number; onChange: (n: number) => void; disabled?: boolean }) {
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
    <div className="relative ml-auto" ref={ref}>
      <button
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className="text-xs px-2 py-1 rounded-md bg-secondary disabled:opacity-40"
        aria-label={t("playbackSpeed")}
        aria-expanded={open}
      >{formatSpeedLabel(value)}</button>
      {open && (
        <div className="absolute right-0 bottom-full mb-1 z-10 bg-popover border border-border rounded-md shadow-lg p-1 flex flex-col min-w-[80px]">
          {[0.5, 1, 1.25, 1.5, 2].map((s) => (
            <button
              key={s}
              onClick={() => { onChange(s); setOpen(false); }}
              className={`text-xs px-3 py-1.5 rounded text-left ${
                value === s ? "bg-primary/15 text-primary font-semibold" : "hover:bg-secondary"
              }`}
            >{formatSpeedLabel(s)}</button>
          ))}
        </div>
      )}
    </div>
  );
}
