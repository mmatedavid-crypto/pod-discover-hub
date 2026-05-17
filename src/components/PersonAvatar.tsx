// Unified monogram avatar for People hub + person detail.
// Public images are intentionally disabled site-wide for now (app_settings.person_pages.images_enabled=false).
// Stable neutral gradient derived from a hash of the canonical name.

const SIZE_MAP: Record<string, { box: string; text: string; px: number }> = {
  sm: { box: "h-10 w-10", text: "text-xs", px: 40 },
  md: { box: "h-12 w-12", text: "text-sm", px: 48 },
  lg: { box: "h-20 w-20", text: "text-xl", px: 80 },
  xl: { box: "h-28 w-28", text: "text-3xl", px: 112 },
};

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function gradientFor(name: string): string {
  // Stable, low-saturation gradients inside the brand palette using HSL semantic tokens.
  const variants = [
    "from-primary/25 to-primary/5",
    "from-accent/25 to-primary/5",
    "from-secondary to-card",
    "from-primary/20 to-accent/10",
    "from-muted to-card",
    "from-accent/20 to-secondary",
  ];
  return variants[hashCode(name.toLowerCase()) % variants.length];
}

export function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() || "").join("") || "?";
}

export default function PersonAvatar({ name, size = "md", className = "" }: { name: string; size?: keyof typeof SIZE_MAP; className?: string }) {
  const { box, text } = SIZE_MAP[size] || SIZE_MAP.md;
  const grad = gradientFor(name);
  return (
    <div
      aria-hidden
      className={`${box} ${className} rounded-full bg-gradient-to-br ${grad} border border-border flex items-center justify-center ${text} font-semibold text-foreground/80 shrink-0`}
    >
      {initialsOf(name)}
    </div>
  );
}
