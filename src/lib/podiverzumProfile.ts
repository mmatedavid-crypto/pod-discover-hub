/**
 * Podiverzum Profile — visual "horoscope" generator.
 * Turns a user's swipe taste into:
 *   - Aura (color palette + animated gradient seeds)
 *   - Constellation (deterministic star layout from top topics)
 *   - Barnum-style poetic verdict
 *   - Unique PDV-XXXX code
 *
 * All deterministic on the input → same swipes produce the same visual,
 * but different swipes produce visibly different results.
 */

/* ---------------- mood → color mapping ---------------- */
// Curated HSL hues. Values are [hue, sat%, light%] in HSL.
const MOOD_COLORS: Record<string, [number, number, number]> = {
  // calm / introspective
  "merengő": [220, 55, 55],
  "introspektív": [240, 50, 50],
  "nosztalgikus": [25, 55, 60],
  "melankolikus": [235, 40, 45],
  "meditatív": [180, 45, 55],
  "csendes": [210, 30, 60],

  // energetic / playful
  "izgatott": [20, 85, 60],
  "energikus": [12, 90, 58],
  "vicces": [45, 90, 60],
  "humoros": [42, 88, 62],
  "játékos": [310, 75, 65],
  "ironikus": [285, 65, 55],

  // serious / hard
  "kritikus": [355, 70, 50],
  "elemzős": [200, 60, 45],
  "kemény": [0, 65, 45],
  "mély": [255, 60, 40],
  "tárgyilagos": [195, 25, 55],

  // warm / human
  "őszinte": [15, 70, 60],
  "személyes": [340, 60, 65],
  "inspiráló": [50, 90, 60],
  "motiváló": [35, 90, 58],
  "kíváncsi": [165, 65, 55],
  "felfedező": [150, 60, 55],

  // dark / edgy
  "sötét": [260, 50, 30],
  "feszült": [10, 70, 45],
  "izgalmas": [355, 80, 55],
};

const FALLBACK_PALETTE: Array<[number, number, number]> = [
  [220, 55, 55],
  [285, 60, 55],
  [25, 75, 60],
  [165, 55, 50],
];

export type AuraPalette = {
  /** 3-4 hsl strings, ordered by weight */
  colors: string[];
  /** primary hsl for accents */
  primary: string;
  /** human label for the aura "essence" */
  essence: string;
};

export function buildAura(
  moodTagsWeighted: Record<string, number>,
): AuraPalette {
  // pick up to 4 moods with weights
  const entries = Object.entries(moodTagsWeighted)
    .filter(([t]) => MOOD_COLORS[t.toLowerCase()])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  const picks = entries.length
    ? entries.map(([t]) => MOOD_COLORS[t.toLowerCase()]!)
    : FALLBACK_PALETTE;

  const colors = picks.map(([h, s, l]) => `hsl(${h} ${s}% ${l}%)`);

  // Essence label = first mood translated to a poetic phrase
  const topMood = entries[0]?.[0]?.toLowerCase();
  const essence = essenceLabel(topMood, entries[1]?.[0]?.toLowerCase());

  return {
    colors,
    primary: colors[0],
    essence,
  };
}

function essenceLabel(top?: string, second?: string): string {
  const pairs: Record<string, string> = {
    "merengő": "éjszakai óceán",
    "introspektív": "csendes belső tó",
    "nosztalgikus": "őszi délután",
    "melankolikus": "kék óra",
    "meditatív": "hajnali köd",
    "csendes": "üres katedrális",
    "izgatott": "augusztusi vihar",
    "energikus": "neon nagyváros",
    "vicces": "vasárnapi piknik",
    "humoros": "fényes konyha",
    "játékos": "rózsaszín naplemente",
    "ironikus": "lila füst",
    "kritikus": "borostyán üveg",
    "elemzős": "tiszta műhely",
    "kemény": "vörös agyag",
    "mély": "indigó kút",
    "tárgyilagos": "ezüst műszer",
    "őszinte": "meleg konyhafény",
    "személyes": "régi fénykép",
    "inspiráló": "arany hajnal",
    "motiváló": "narancs futópálya",
    "kíváncsi": "smaragd erdő",
    "felfedező": "új térkép",
    "sötét": "viharos éjszaka",
    "feszült": "feszes húr",
    "izgalmas": "tűzijáték",
  };
  const a = top && pairs[top];
  const b = second && pairs[second];
  if (a && b) return `${a} ${b.toLowerCase()}tel`;
  if (a) return a;
  return "kavargó köd, váratlan fénnyel";
}

/* ---------------- constellation ---------------- */

export type Star = {
  label: string;
  x: number; // 0..1
  y: number; // 0..1
  radius: number; // px
  brightness: number; // 0..1
};

export type Constellation = {
  stars: Star[];
  /** index pairs to connect with lines */
  edges: Array<[number, number]>;
  /** poetic name for the constellation */
  name: string;
};

// Deterministic PRNG from string seed
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed: number) {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildConstellation(
  topTopics: Array<{ label: string; weight: number; superCount?: number }>,
  seedKey: string,
): Constellation {
  const rng = mulberry32(hashSeed(seedKey || "podiverzum"));
  const stars: Star[] = [];
  const picks = topTopics.slice(0, 7);
  const maxW = Math.max(1, ...picks.map(p => p.weight));

  // Poisson-ish layout: try positions, reject if too close to existing
  const MIN_DIST = 0.18;
  for (const p of picks) {
    let placed: { x: number; y: number } | null = null;
    for (let tries = 0; tries < 40 && !placed; tries++) {
      const x = 0.08 + rng() * 0.84;
      const y = 0.12 + rng() * 0.76;
      const ok = stars.every(s => Math.hypot(s.x - x, s.y - y) > MIN_DIST);
      if (ok) placed = { x, y };
    }
    if (!placed) placed = { x: rng(), y: rng() };
    const w = p.weight / maxW;
    const isSuper = (p.superCount ?? 0) > 0;
    stars.push({
      label: p.label,
      x: placed.x,
      y: placed.y,
      radius: isSuper ? 6 + w * 4 : 3 + w * 3.5,
      brightness: isSuper ? 1 : 0.55 + w * 0.45,
    });
  }

  // Edges: connect each star to the nearest 1-2 unvisited
  const edges: Array<[number, number]> = [];
  const used = new Set<string>();
  for (let i = 0; i < stars.length; i++) {
    const dists = stars
      .map((s, j) => ({ j, d: Math.hypot(s.x - stars[i].x, s.y - stars[i].y) }))
      .filter(d => d.j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2);
    for (const { j } of dists) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (used.has(key)) continue;
      used.add(key);
      edges.push([i, j]);
    }
  }

  return { stars, edges, name: constellationName(seedKey, picks[0]?.label) };
}

const NAME_PREFIX = ["Lyra", "Aurora", "Nox", "Vox", "Echo", "Vela", "Sol", "Umbra", "Stella", "Cassia"];
const NAME_SUFFIX = ["Curiosa", "Profunda", "Vivax", "Silens", "Audax", "Lucida", "Errans", "Nocturna", "Magna", "Arcana"];

function constellationName(seed: string, topTopic?: string): string {
  const rng = mulberry32(hashSeed(seed + "name"));
  const a = NAME_PREFIX[Math.floor(rng() * NAME_PREFIX.length)];
  const b = NAME_SUFFIX[Math.floor(rng() * NAME_SUFFIX.length)];
  return `${a} ${b}`;
}

/* ---------------- Barnum verdict ---------------- */

const VERDICT_OPENERS = [
  "Te az a hallgató vagy, aki",
  "Olyan ember vagy, aki",
  "Téged azok a hangok vonzanak, amelyek",
  "Az ízlésed olyan, mint egy",
];

const VERDICT_MIDS = [
  "a részleteket is észreveszi, de sosem téveszti szem elől a nagy képet",
  "egyszerre keresi a mélységet és a könnyű nevetést",
  "szereti, ha egy beszélgetés gondolkodásra kényszerít, de nem akar tőle kimerülni",
  "a csendes, lassú témákat is bevállalja, ha érzi, hogy valódi",
  "a komoly dolgokat is el tudja viselni, ha van bennük egy csipet humor",
  "nem szereti a felszínes hype-ot, de a túl komoly dolgokat sem mindig veszi be",
];

const VERDICT_CLOSERS = [
  "A héten egy váratlan beszélgetés átrendezi a fejedben a sorrendet.",
  "A következő epizód, amit befejezel, eszedbe fog jutni hetekig.",
  "Valaki, akit régen hallgattál, hamarosan újra megszólal.",
  "Egy téma, amit eddig kerültél, most furcsán vonzani fog.",
  "A te ízlésed pont a kettő között van — és ez most az erősséged.",
];

export function buildVerdict(seedKey: string): string {
  const rng = mulberry32(hashSeed(seedKey + "verdict"));
  const open = VERDICT_OPENERS[Math.floor(rng() * VERDICT_OPENERS.length)];
  const mid = VERDICT_MIDS[Math.floor(rng() * VERDICT_MIDS.length)];
  const close = VERDICT_CLOSERS[Math.floor(rng() * VERDICT_CLOSERS.length)];
  return `${open} ${mid}. ${close}`;
}

/* ---------------- Unique code ---------------- */

export function buildPdvCode(seedKey: string): string {
  const h = hashSeed(seedKey);
  const num = (h % 9000) + 1000; // 4 digits
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const a = letters[(h >>> 4) % letters.length];
  const b = letters[(h >>> 9) % letters.length];
  const c = letters[(h >>> 14) % letters.length];
  return `PDV-${num}-${a}${b}${c}`;
}
