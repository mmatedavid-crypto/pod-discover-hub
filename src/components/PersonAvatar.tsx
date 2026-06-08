// Person avatar — Wikimedia image when available, monogram fallback.
import { imageSrcSet, optimizedImageUrl } from "@/lib/image";

const SIZE_MAP: Record<string, { box: string; text: string }> = {
  sm: { box: "h-10 w-10", text: "text-xs" },
  md: { box: "h-12 w-12", text: "text-sm" },
  lg: { box: "h-20 w-20", text: "text-xl" },
  xl: { box: "h-28 w-28", text: "text-3xl" },
};

export function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() || "").join("") || "?";
}

export default function PersonAvatar({
  name,
  size = "md",
  className = "",
  imageUrl,
}: {
  name: string;
  size?: keyof typeof SIZE_MAP;
  className?: string;
  imageUrl?: string | null;
}) {
  const { box, text } = SIZE_MAP[size] || SIZE_MAP.md;
  const pixelSize = size === "xl" ? 160 : size === "lg" ? 112 : size === "sm" ? 56 : 80;
  if (imageUrl) {
    return (
      <img
        src={optimizedImageUrl(imageUrl, { width: pixelSize, height: pixelSize }) || imageUrl}
        srcSet={imageSrcSet(imageUrl, [Math.max(40, pixelSize - 32), pixelSize, pixelSize + 48])}
        sizes={`${pixelSize}px`}
        alt={name}
        loading="lazy"
        decoding="async"
        width={pixelSize}
        height={pixelSize}
        className={`${box} ${className} rounded-full object-cover border border-border/80 shrink-0 bg-card`}
      />
    );
  }
  return (
    <div
      aria-hidden
      className={`${box} ${className} rounded-full bg-gradient-to-br from-primary/15 via-card to-card border border-border/80 flex items-center justify-center ${text} font-semibold text-foreground/85 shrink-0`}
    >
      {initialsOf(name)}
    </div>
  );
}
