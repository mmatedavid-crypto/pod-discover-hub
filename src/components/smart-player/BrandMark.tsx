// Subtle "P" brand mark used as a faint background motif inside Smart Player surfaces.
export function PlayerBrandMark({
  className = "",
  size = 220,
  opacity = 0.05,
}: { className?: string; size?: number; opacity?: number }) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none select-none absolute font-bold leading-none text-[hsl(var(--brand-red))] ${className}`}
      style={{ fontSize: size, opacity, lineHeight: 1 }}
    >
      P
    </span>
  );
}
