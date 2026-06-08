import { useEffect, useRef, useState } from "react";
import { Share2, X, Download, Link2, Check } from "lucide-react";
import { toPng } from "html-to-image";
import { useSmartPlayer, formatTime } from "./SmartPlayerProvider";
import { imageSrcSet, optimizedImageUrl } from "@/lib/image";

export function ShareMomentButton({ className = "" }: { className?: string }) {
  const { currentEpisode, currentTime } = useSmartPlayer();
  const [open, setOpen] = useState(false);
  if (!currentEpisode) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`h-9 w-9 rounded-full border border-border bg-background/60 text-muted-foreground hover:text-foreground hover:bg-secondary flex items-center justify-center shrink-0 transition-colors ${className}`}
        aria-label="Pillanat megosztása"
        title="Pillanat megosztása"
      >
        <Share2 className="h-4 w-4" />
      </button>
      {open && (
        <ShareMomentModal
          onClose={() => setOpen(false)}
          episode={currentEpisode}
          atSec={Math.floor(currentTime)}
        />
      )}
    </>
  );
}

function ShareMomentModal({
  onClose,
  episode,
  atSec,
}: {
  onClose: () => void;
  episode: ReturnType<typeof useSmartPlayer>["currentEpisode"];
  atSec: number;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const url =
    episode?.podcastSlug && episode?.episodeSlug
      ? `https://podiverzum.hu/podcast/${episode.podcastSlug}/${episode.episodeSlug}?t=${atSec}`
      : typeof window !== "undefined"
        ? window.location.href
        : "";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const downloadPng = async () => {
    if (!cardRef.current || busy) return;
    setBusy(true);
    try {
      const dataUrl = await toPng(cardRef.current, {
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: "#0b0b0e",
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `podiverzum-${episode?.episodeSlug || "moment"}-${atSec}s.png`;
      a.click();
    } catch (e) {
      console.error("share image error", e);
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  };

  const nativeShare = async () => {
    if (!navigator.share) {
      copyLink();
      return;
    }
    try {
      await navigator.share({
        title: episode?.title,
        text: `${episode?.title} — ${formatTime(atSec)}-tól`,
        url,
      });
    } catch {
      /* user cancelled */
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] bg-background/90 backdrop-blur flex items-start sm:items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md bg-card border border-border rounded-2xl p-4 sm:p-6 my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 h-8 w-8 rounded-full hover:bg-secondary flex items-center justify-center"
          aria-label="Bezárás"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="text-sm font-semibold mb-3">Pillanat megosztása</div>

        <div
          ref={cardRef}
          className="rounded-xl overflow-hidden p-5 text-white relative"
          style={{
            background:
              "linear-gradient(135deg,#0b0b0e 0%,#15131c 50%,#1a0f1a 100%)",
            width: "100%",
            aspectRatio: "4 / 5",
          }}
        >
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] opacity-70">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: "hsl(355 85% 60%)" }}
            />
            Podiverzum
          </div>

          <div className="flex gap-4 mt-5">
            {episode?.imageUrl ? (
              <img
                src={optimizedImageUrl(episode.imageUrl, { width: 128, height: 128 }) || episode.imageUrl}
                srcSet={imageSrcSet(episode.imageUrl, [80, 128, 160])}
                sizes="80px"
                alt=""
                crossOrigin="anonymous"
                loading="lazy"
                decoding="async"
                className="h-20 w-20 rounded-lg object-cover border border-white/10"
              />
            ) : (
              <div className="h-20 w-20 rounded-lg bg-white/10" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[11px] uppercase tracking-[0.18em] opacity-70 truncate">
                {episode?.podcastTitle}
              </div>
              <div className="text-base font-semibold leading-snug line-clamp-3 mt-1">
                {episode?.title}
              </div>
            </div>
          </div>

          <div className="mt-6">
            <div className="text-[10px] uppercase tracking-[0.2em] opacity-60">
              Hallgasd meg itt
            </div>
            <div
              className="text-3xl font-bold tabular-nums mt-1"
              style={{ color: "hsl(355 85% 65%)" }}
            >
              {formatTime(atSec)}
            </div>
          </div>

          <div className="absolute bottom-5 left-5 right-5">
            <div className="h-1 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full"
                style={{
                  width: "38%",
                  background:
                    "linear-gradient(90deg, hsl(355 85% 60%), hsl(15 85% 60%))",
                }}
              />
            </div>
            <div className="mt-3 text-[11px] opacity-80 truncate">
              podiverzum.hu
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <button
            onClick={nativeShare}
            className="flex flex-col items-center gap-1 text-xs py-2.5 rounded-lg border border-border hover:bg-secondary"
          >
            <Share2 className="h-4 w-4" /> Megosztás
          </button>
          <button
            onClick={copyLink}
            className="flex flex-col items-center gap-1 text-xs py-2.5 rounded-lg border border-border hover:bg-secondary"
          >
            {copied ? <Check className="h-4 w-4 text-green-500" /> : <Link2 className="h-4 w-4" />}
            {copied ? "Másolva" : "Link másolása"}
          </button>
          <button
            onClick={downloadPng}
            disabled={busy}
            className="flex flex-col items-center gap-1 text-xs py-2.5 rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
          >
            <Download className="h-4 w-4" /> {busy ? "Készül…" : "PNG"}
          </button>
        </div>

        <div className="mt-3 text-[11px] text-muted-foreground break-all">
          {url}
        </div>
      </div>
    </div>
  );
}
