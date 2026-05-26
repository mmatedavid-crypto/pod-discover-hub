// Determinisztikus, dekoratív "barcode" SVG a receipt aljára.
// NEM olvasható EAN/Code128 — szándékosan csak vizuális hangulat.
// Ugyanaz a `seed` mindig ugyanazt a barcode-ot adja.

export function Barcode({
  seed,
  width = 280,
  height = 56,
  bars = 48,
}: {
  seed: string;
  width?: number;
  height?: number;
  bars?: number;
}) {
  // Egyszerű, determinisztikus PRNG a seedből.
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const rng = () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 1000) / 1000;
  };

  const segments: { x: number; w: number }[] = [];
  let cursor = 0;
  const usable = width - 8; // 4px padding mindkét oldalon
  for (let i = 0; i < bars; i++) {
    const w = 1 + Math.floor(rng() * 3); // 1, 2, vagy 3 px
    const gap = 1 + Math.floor(rng() * 2); // 1 vagy 2 px gap
    if (cursor + w > usable) break;
    segments.push({ x: 4 + cursor, w });
    cursor += w + gap;
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      {segments.map((s, i) => (
        <rect key={i} x={s.x} y={0} width={s.w} height={height} fill="#0a0a0a" />
      ))}
    </svg>
  );
}
