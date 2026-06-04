import { forwardRef, useState } from "react";
import { imageSrcSet, optimizedImageUrl } from "@/lib/image";

function initials(title: string) {
  const normalized = (title || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return (
    normalized
      .replace(/[^A-Za-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "P"
  );
}

function bgFor(title: string) {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 25% 90%)`;
}

type Props = {
  title: string;
  src?: string | null;
  className?: string;
  size?: "sm" | "md" | "lg";
  loading?: "eager" | "lazy";
  fetchPriority?: "high" | "low" | "auto";
  imageSize?: number;
  imageWidths?: number[];
  sizes?: string;
};

export const PodcastCover = forwardRef<HTMLDivElement, Props>(function PodcastCover(
  {
    title,
    src,
    className = "",
    size = "md",
    loading = "lazy",
    fetchPriority = "auto",
    imageSize,
    imageWidths,
    sizes,
  },
  ref,
) {
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const showImg = src && !broken;
  const sizeCls = size === "sm" ? "text-xs" : size === "lg" ? "text-3xl" : "text-base";
  const pixelSize = imageSize || (size === "sm" ? 96 : size === "lg" ? 320 : 192);
  const responsiveWidths = imageWidths || (size === "lg" ? [192, 320, 480] : [64, 96, 128]);
  const imageSizes = sizes || (size === "lg" ? "(max-width: 640px) 160px, 320px" : "(max-width: 640px) 64px, 96px");
  const optimizedSrc = optimizedImageUrl(src, { width: pixelSize, height: pixelSize });
  const srcSet = imageSrcSet(src, responsiveWidths);
  return (
    <div
      ref={ref}
      className={`relative aspect-square w-full overflow-hidden rounded-md border border-border ${className}`}
      style={{ background: bgFor(title) }}
    >
      {/* Always-rendered initials fallback — visible until image loads, or if missing/broken */}
      <div
        aria-hidden={showImg && loaded}
        className={`absolute inset-0 flex items-center justify-center font-semibold text-foreground/70 ${sizeCls}`}
      >
        {initials(title)}
      </div>
      {showImg && (
        <img
          src={optimizedSrc || (src as string)}
          srcSet={srcSet}
          sizes={imageSizes}
          alt={title}
          loading={loading}
          fetchPriority={fetchPriority}
          decoding="async"
          width={pixelSize}
          height={pixelSize}
          onLoad={() => setLoaded(true)}
          onError={() => setBroken(true)}
          className={`relative w-full h-full object-cover transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"}`}
        />
      )}
    </div>
  );
});
