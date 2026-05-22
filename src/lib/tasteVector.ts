// Client-side taste vector math for "A Te Podiverzumod".
// All vectors are number[768]. We never persist them server-side in MVP.

export type Vec = number[];

export function zero(dim = 768): Vec {
  return new Array(dim).fill(0);
}

export function add(a: Vec, b: Vec): Vec {
  const out = new Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] + b[i];
  return out;
}

export function scale(a: Vec, k: number): Vec {
  return a.map(v => v * k);
}

export function norm(a: Vec): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s);
}

export function normalize(a: Vec): Vec {
  const n = norm(a);
  if (n === 0) return a.slice();
  return a.map(v => v / n);
}

export function cosine(a: Vec, b: Vec): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function mean(vecs: Vec[]): Vec {
  if (vecs.length === 0) return zero();
  const out = zero(vecs[0].length);
  for (const v of vecs) for (let i = 0; i < v.length; i++) out[i] += v[i];
  for (let i = 0; i < out.length; i++) out[i] /= vecs.length;
  return out;
}

// pairwise mean cosine among positives (coherence)
export function coherence(vecs: Vec[]): number {
  if (vecs.length < 2) return 0;
  let s = 0, n = 0;
  for (let i = 0; i < vecs.length; i++)
    for (let j = i + 1; j < vecs.length; j++) {
      s += cosine(vecs[i], vecs[j]);
      n++;
    }
  return n ? s / n : 0;
}

// pgvector literal format
export function toPgVector(v: Vec): string {
  return `[${v.join(",")}]`;
}

// Parse pgvector value coming from RPC — supabase-js returns it as a string "[0.1,0.2,...]".
export function parsePgVector(input: unknown): Vec | null {
  if (!input) return null;
  if (Array.isArray(input)) return input.map(Number);
  if (typeof input === "string") {
    const trimmed = input.replace(/^\[|\]$/g, "");
    if (!trimmed) return null;
    return trimmed.split(",").map(Number);
  }
  return null;
}
