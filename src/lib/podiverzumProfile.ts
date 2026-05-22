/**
 * Podiverzum Profile — visual "horoscope" generator.
 *
 * Deterministic on input: same swipes -> same visuals.
 * Different swipes produce visibly different aura / constellation / verdict / element.
 *
 * v2 (2026-05-22):
 *   - Aura: weighted HSL blend over ALL matching moods, not just top 4
 *   - Verdict: composed from top mood + element + archetype, not fully random
 *   - Element: NEW (Fire / Water / Earth / Air) derived from mood energy axis
 *   - Constellation: Hungarian-friendly naming hinting at top topic
 */

/* =====================================================================
 * MOOD → COLOR + ENERGY axis
 * energy: -1 (csendes/befelé) … +1 (energikus/kifelé)
 * warmth: -1 (hideg) … +1 (meleg)
 * ===================================================================== */

type MoodMeta = {
  hsl: [number, number, number];
  energy: number; // -1..1
  warmth: number; // -1..1
  /** which classical element this mood pulls toward */
  element: "fire" | "water" | "earth" | "air";
};

const MOOD: Record<string, MoodMeta> = {
  // calm / introspective → water
  "merengő":      { hsl: [220, 55, 55], energy: -0.7, warmth: -0.3, element: "water" },
  "introspektív": { hsl: [240, 50, 50], energy: -0.6, warmth: -0.2, element: "water" },
  "nosztalgikus": { hsl: [25,  55, 60], energy: -0.3, warmth:  0.6, element: "water" },
  "melankolikus": { hsl: [235, 40, 45], energy: -0.7, warmth: -0.4, element: "water" },
  "meditatív":    { hsl: [180, 45, 55], energy: -0.8, warmth:  0.0, element: "water" },
  "csendes":      { hsl: [210, 30, 60], energy: -0.9, warmth: -0.1, element: "water" },
  "mély":         { hsl: [255, 60, 40], energy: -0.4, warmth: -0.2, element: "water" },

  // energetic / playful → fire / air
  "izgatott":   { hsl: [20,  85, 60], energy:  0.8, warmth:  0.7, element: "fire" },
  "energikus":  { hsl: [12,  90, 58], energy:  0.9, warmth:  0.8, element: "fire" },
  "vicces":     { hsl: [45,  90, 60], energy:  0.7, warmth:  0.8, element: "air"  },
  "humoros":    { hsl: [42,  88, 62], energy:  0.6, warmth:  0.7, element: "air"  },
  "játékos":    { hsl: [310, 75, 65], energy:  0.7, warmth:  0.5, element: "air"  },
  "ironikus":   { hsl: [285, 65, 55], energy:  0.4, warmth:  0.1, element: "air"  },
  "izgalmas":   { hsl: [355, 80, 55], energy:  0.8, warmth:  0.6, element: "fire" },

  // serious / hard → earth / fire
  "kritikus":     { hsl: [355, 70, 50], energy:  0.3, warmth: -0.4, element: "earth" },
  "elemzős":      { hsl: [200, 60, 45], energy:  0.1, warmth: -0.3, element: "earth" },
  "kemény":       { hsl: [0,   65, 45], energy:  0.5, warmth: -0.5, element: "fire"  },
  "tárgyilagos":  { hsl: [195, 25, 55], energy:  0.0, warmth: -0.5, element: "earth" },
  "feszült":      { hsl: [10,  70, 45], energy:  0.6, warmth: -0.2, element: "fire"  },
  "sötét":        { hsl: [260, 50, 30], energy: -0.2, warmth: -0.6, element: "water" },

  // warm / human → earth / air
  "őszinte":    { hsl: [15,  70, 60], energy:  0.1, warmth:  0.8, element: "earth" },
  "személyes":  { hsl: [340, 60, 65], energy:  0.0, warmth:  0.7, element: "earth" },
  "inspiráló":  { hsl: [50,  90, 60], energy:  0.7, warmth:  0.6, element: "air"   },
  "motiváló":   { hsl: [35,  90, 58], energy:  0.8, warmth:  0.6, element: "fire"  },
  "kíváncsi":   { hsl: [165, 65, 55], energy:  0.4, warmth:  0.3, element: "air"   },
  "felfedező":  { hsl: [150, 60, 55], energy:  0.5, warmth:  0.3, element: "air"   },
};

/* =====================================================================
 * AURA — weighted HSL blend
 * ===================================================================== */

export type AuraPalette = {
  colors: string[]; // 4 hsl strings, ordered by weight
  primary: string;
  essence: string;
};

/** Average HSL with proper circular hue mean. Returns hsl() string. */
function blendHsl(entries: Array<{ hsl: [number, number, number]; w: number }>): [number, number, number] {
  let sx = 0, sy = 0, ss = 0, sl = 0, sw = 0;
  for (const e of entries) {
    const [h, s, l] = e.hsl;
    const rad = (h * Math.PI) / 180;
    sx += Math.cos(rad) * e.w;
    sy += Math.sin(rad) * e.w;
    ss += s * e.w;
    sl += l * e.w;
    sw += e.w;
  }
  if (sw === 0) return [220, 55, 55];
  let hue = (Math.atan2(sy / sw, sx / sw) * 180) / Math.PI;
  if (hue < 0) hue += 360;
  return [Math.round(hue), Math.round(ss / sw), Math.round(sl / sw)];
}

const FALLBACK_PALETTE: Array<[number, number, number]> = [
  [220, 55, 55], [285, 60, 55], [25, 75, 60], [165, 55, 50],
];

export function buildAura(moodTagsWeighted: Record<string, number>): AuraPalette {
  const matched = Object.entries(moodTagsWeighted)
    .map(([t, w]) => ({ tag: t.toLowerCase(), w, meta: MOOD[t.toLowerCase()] }))
    .filter(x => x.meta && x.w > 0);

  if (matched.length === 0) {
    const colors = FALLBACK_PALETTE.map(([h, s, l]) => `hsl(${h} ${s}% ${l}%)`);
    return { colors, primary: colors[0], essence: "kavargó köd, váratlan fénnyel" };
  }

  // Sort by weight descending
  matched.sort((a, b) => b.w - a.w);

  // Primary = blend of TOP 50% of weight mass
  const totalW = matched.reduce((s, x) => s + x.w, 0);
  let cum = 0;
  const primaryPool: typeof matched = [];
  for (const m of matched) {
    primaryPool.push(m);
    cum += m.w;
    if (cum / totalW >= 0.5) break;
  }
  const primary = blendHsl(primaryPool.map(m => ({ hsl: m.meta.hsl, w: m.w })));

  // Secondary 3 colors = next strongest individual moods (or shifted primary if not enough)
  const palette: [number, number, number][] = [primary];
  for (const m of matched) {
    if (palette.length >= 4) break;
    // Skip if too close to existing hue
    const tooClose = palette.some(p => Math.abs(p[0] - m.meta.hsl[0]) < 18);
    if (!tooClose) palette.push(m.meta.hsl);
  }
  while (palette.length < 4) {
    const base = palette[0];
    palette.push([(base[0] + palette.length * 70) % 360, Math.max(40, base[1] - 10), base[2]]);
  }

  const colors = palette.map(([h, s, l]) => `hsl(${h} ${s}% ${l}%)`);
  const top = matched[0]?.tag;
  const second = matched[1]?.tag;
  return {
    colors,
    primary: colors[0],
    essence: essenceLabel(top, second),
  };
}

function essenceLabel(top?: string, second?: string): string {
  const pairs: Record<string, string> = {
    "merengő": "éjszakai óceán", "introspektív": "csendes belső tó",
    "nosztalgikus": "őszi délután", "melankolikus": "kék óra",
    "meditatív": "hajnali köd", "csendes": "üres katedrális",
    "izgatott": "augusztusi vihar", "energikus": "neon nagyváros",
    "vicces": "vasárnapi piknik", "humoros": "fényes konyha",
    "játékos": "rózsaszín naplemente", "ironikus": "lila füst",
    "kritikus": "borostyán üveg", "elemzős": "tiszta műhely",
    "kemény": "vörös agyag", "mély": "indigó kút",
    "tárgyilagos": "ezüst műszer", "őszinte": "meleg konyhafény",
    "személyes": "régi fénykép", "inspiráló": "arany hajnal",
    "motiváló": "narancs futópálya", "kíváncsi": "smaragd erdő",
    "felfedező": "új térkép", "sötét": "viharos éjszaka",
    "feszült": "feszes húr", "izgalmas": "tűzijáték",
  };
  const a = top && pairs[top];
  const b = second && pairs[second];
  if (a && b) return `${a}, ${b} hátterén`;
  if (a) return a;
  return "kavargó köd, váratlan fénnyel";
}

/* =====================================================================
 * ELEMENT — NEW layer (Fire / Water / Earth / Air)
 * ===================================================================== */

export type Element = {
  key: "fire" | "water" | "earth" | "air";
  label: string;
  symbol: string;
  tagline: string;
};

const ELEMENT_META: Record<Element["key"], Omit<Element, "key">> = {
  fire:  { label: "Tűz",    symbol: "△", tagline: "Lendület, indulat, akció." },
  water: { label: "Víz",    symbol: "▽", tagline: "Mélység, befelé fordulás, érzelem." },
  earth: { label: "Föld",   symbol: "▢", tagline: "Tényszerűség, nyugalom, alap." },
  air:   { label: "Levegő", symbol: "○", tagline: "Játékos elme, kíváncsiság, mozgás." },
};

export function buildElement(moodTagsWeighted: Record<string, number>): Element {
  const scores: Record<Element["key"], number> = { fire: 0, water: 0, earth: 0, air: 0 };
  for (const [tag, w] of Object.entries(moodTagsWeighted)) {
    const m = MOOD[tag.toLowerCase()];
    if (!m || w <= 0) continue;
    scores[m.element] += w;
  }
  const total = scores.fire + scores.water + scores.earth + scores.air;
  let winner: Element["key"] = "air";
  let best = -1;
  for (const k of Object.keys(scores) as Element["key"][]) {
    if (scores[k] > best) { best = scores[k]; winner = k; }
  }
  // If no signal, fallback air
  if (total === 0) winner = "air";
  return { key: winner, ...ELEMENT_META[winner] };
}

/* =====================================================================
 * CONSTELLATION
 * ===================================================================== */

export type Star = {
  label: string;
  x: number; y: number;
  radius: number;
  brightness: number;
};

export type Constellation = {
  stars: Star[];
  edges: Array<[number, number]>;
  name: string;
};

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
      x: placed.x, y: placed.y,
      radius: isSuper ? 6 + w * 4 : 3 + w * 3.5,
      brightness: isSuper ? 1 : 0.55 + w * 0.45,
    });
  }

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

const PREFIX = ["Lyra", "Aurora", "Nox", "Vox", "Echo", "Vela", "Sol", "Umbra", "Stella", "Cassia", "Astra", "Luna"];
const SUFFIX = ["Curiosa", "Profunda", "Vivax", "Silens", "Audax", "Lucida", "Errans", "Nocturna", "Magna", "Arcana", "Serena", "Ardens"];

function constellationName(seed: string, topTopic?: string): string {
  const rng = mulberry32(hashSeed(seed + "name"));
  const a = PREFIX[Math.floor(rng() * PREFIX.length)];
  const b = SUFFIX[Math.floor(rng() * SUFFIX.length)];
  return topTopic ? `${a} ${b} · ${topTopic}` : `${a} ${b}`;
}

/* =====================================================================
 * VERDICT — context-aware
 * ===================================================================== */

type VerdictCtx = {
  topMoods?: string[];      // lowercase
  topTopics?: string[];     // human label
  archetypeName?: string;
  element?: Element["key"];
};

const OPENERS_BY_ELEMENT: Record<Element["key"], string[]> = {
  fire: [
    "Tűz vagy: te az a hallgató vagy, aki",
    "Az energiád lobog — olyan ember, aki",
  ],
  water: [
    "Mély víz vagy: olyan hallgató, aki",
    "Befelé figyelsz — téged azok a hangok vonzanak, amelyek",
  ],
  earth: [
    "Földön állsz: olyan ember vagy, aki",
    "A te ízlésed szilárd — azokat a beszélgetéseket szereted, amelyek",
  ],
  air: [
    "Levegő vagy: kíváncsi hallgató, aki",
    "Az elméd mozgásban — olyan ember, aki",
  ],
};

const MIDS_BY_ELEMENT: Record<Element["key"], string[]> = {
  fire: [
    "nem fél a kemény kérdésektől, és a vitában is otthon érzi magát",
    "felpörög egy jó történettől, és továbbadná, mielőtt véget ér",
    "az indulatos témákat is bevállalja, ha érzi, hogy van bennük tét",
  ],
  water: [
    "csendben hallgatja végig azt is, ami másoknak hosszú lenne",
    "a részleteket is észreveszi, de sosem téveszti szem elől a nagy képet",
    "olyan beszélgetéseket keres, amelyek után még napokig gondolkodik",
  ],
  earth: [
    "nem szereti a felszínes hype-ot, és inkább a tényeket forgatja",
    "a komoly dolgokat is el tudja viselni, ha van bennük rendszer",
    "ott marad a hangnál, ahol valami valódit mondanak",
  ],
  air: [
    "egyszerre keresi a mélységet és a könnyű nevetést",
    "szereti, ha egy beszélgetés gondolkodásra kényszerít, de nem akar tőle kimerülni",
    "a sokféle témát szereti — egy nap politikát, másnap pszichológiát",
  ],
};

const CLOSERS = [
  "A héten egy váratlan beszélgetés átrendezi a fejedben a sorrendet.",
  "A következő epizód, amit befejezel, eszedbe fog jutni hetekig.",
  "Valaki, akit régen hallgattál, hamarosan újra megszólal.",
  "Egy téma, amit eddig kerültél, most furcsán vonzani fog.",
  "A te ízlésed pont a kettő között van — és ez most az erősséged.",
  "A héten egy interjú meg fog lepni, mert nem onnan jön, ahonnan vártad.",
];

export function buildVerdict(seedKey: string, ctx: VerdictCtx = {}): string {
  const rng = mulberry32(hashSeed(seedKey + "verdict"));
  const el = ctx.element ?? "air";
  const openers = OPENERS_BY_ELEMENT[el];
  const mids = MIDS_BY_ELEMENT[el];
  const open = openers[Math.floor(rng() * openers.length)];
  const mid = mids[Math.floor(rng() * mids.length)];
  const close = CLOSERS[Math.floor(rng() * CLOSERS.length)];

  // Optional topic injection: weave top topic into close if available
  let topicLine = "";
  if (ctx.topTopics && ctx.topTopics.length > 0) {
    const t1 = ctx.topTopics[0];
    const t2 = ctx.topTopics[1];
    topicLine = t2
      ? ` A két fő iránytűd most a(z) ${t1.toLowerCase()} és a(z) ${t2.toLowerCase()}.`
      : ` A fő iránytűd most a(z) ${t1.toLowerCase()}.`;
  }

  return `${open} ${mid}.${topicLine} ${close}`;
}

/* =====================================================================
 * Unique code
 * ===================================================================== */

export function buildPdvCode(seedKey: string): string {
  const h = hashSeed(seedKey);
  const num = (h % 9000) + 1000;
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const a = letters[(h >>> 4) % letters.length];
  const b = letters[(h >>> 9) % letters.length];
  const c = letters[(h >>> 14) % letters.length];
  return `PDV-${num}-${a}${b}${c}`;
}
