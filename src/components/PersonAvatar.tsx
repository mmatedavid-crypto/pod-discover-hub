// Unified monogram avatar — one global Podiverzum brand style.
// Public images are intentionally disabled site-wide (app_settings.person_pages.images_enabled=false).
// No random/per-person colors. No black/red variants. One subtle brand gradient everywhere.

const SIZE_MAP: Record<string, { box: string; text: string }> = {
  sm: { box: "h-10 w-10", text: "text-xs" },
  md: { box: "h-12 w-12", text: "text-sm" },
  lg: { box: "h-20 w-20", text: "text-xl" },
  xl: { box: "h-28 w-28", text: "text-3xl" },
};

export function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() || "").join("") || "?";
}

export default function PersonAvatar({ name, size = "md", className = "" }: { name: string; size?: keyof typeof SIZE_MAP; className?: string }) {
  const { box, text } = SIZE_MAP[size] || SIZE_MAP.md;
  return (
    <div
      aria-hidden
      className={`${box} ${className} rounded-full bg-gradient-to-br from-primary/15 via-card to-card border border-border/80 flex items-center justify-center ${text} font-semibold text-foreground/85 shrink-0`}
    >
      {initialsOf(name)}
    </div>
  );
}
