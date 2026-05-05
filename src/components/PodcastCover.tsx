import { useState } from "react";

function initials(title: string) {
  return title
    .replace(/[^A-Za-z0-9 ]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "P";
}

// Deterministic muted background per title
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
};

export function PodcastCover({ title, src, className = "", size = "md" }: Props) {
  const [broken, setBroken] = useState(false);
  const showImg = src && !broken;
  const sizeCls =
    size === "sm" ? "text-xs" : size === "lg" ? "text-3xl" : "text-base";
  return (
    <div
      className={`aspect-square w-full overflow-hidden rounded-md border border-border ${className}`}
      style={!showImg ? { background: bgFor(title) } : undefined}
    >
      {showImg ? (
        <img
          src={src as string}
          alt={title}
          loading="lazy"
          onError={() => setBroken(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className={`w-full h-full flex items-center justify-center font-semibold text-foreground/70 ${sizeCls}`}>
          {initials(title)}
        </div>
      )}
    </div>
  );
}
