// AI-trim eval: runs each gold sample through Lovable AI (Gemini 2.5 Flash) and
// compares F1 / dirty / overcut vs gold AND vs deterministic v3 cleaner.
import fs from "node:fs";

Object.defineProperty(globalThis, "Deno", {
  value: { env: { get: () => "" } },
  configurable: true,
});

const { heuristicClean, assessCleanTextQuality } = await import("../supabase/functions/_shared/episode-text-cleaner.ts");

const csvPath = process.argv[2];
const outPath = process.argv[3] || "/mnt/documents/clean_text_ai_eval.json";
if (!csvPath) {
  console.error("Usage: node scripts/evaluate-clean-text-ai.mjs path/to/gold.csv [out.json]");
  process.exit(1);
}

const API_KEY = process.env.LOVABLE_API_KEY;
if (!API_KEY) { console.error("LOVABLE_API_KEY missing"); process.exit(1); }
const MODEL = process.env.AI_MODEL || "google/gemini-2.5-flash";
const CONCURRENCY = Number(process.env.AI_CONC || 4);

function parseCsv(input) {
  const rows = []; let row = []; let cell = ""; let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i], next = input[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function normalize(t) {
  return String(t || "").toLowerCase().normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}
const tokens = (t) => normalize(t).split(" ").filter((x) => x.length >= 2);
function tokenF1(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.length && !B.length) return 1;
  if (!A.length || !B.length) return 0;
  const c = new Map();
  for (const t of A) c.set(t, (c.get(t) || 0) + 1);
  let o = 0;
  for (const t of B) { const n = c.get(t) || 0; if (n > 0) { o++; c.set(t, n - 1); } }
  const p = o / A.length, r = o / B.length;
  return p + r === 0 ? 0 : (2 * p * r) / (p + r);
}
const avg = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const pct = (v) => Number((v * 100).toFixed(2));

const SYSTEM = `Magyar podcast-epizód leírások tisztítója vagy. A bemeneten az RSS-leírás nyers (gyakran HTML-mentes) szövege. Feladatod: ÚGY add vissza, hogy maradjon meg minden, ami az epizód TARTALMÁRÓL szól (témák, vendégek, kérdések, kontextus), és csak a SZEMÉT kerüljön ki.

KIVENNI:
- Műsorvezetők/csatorna általános bemutatkozás-blokkjai, "iratkozz fel / kövess minket / támogass" CTA-k
- Hashtag-falak, social handle-listák (@…) önállóan
- URL-ek, e-mail címek (csak ha a környező mondat NEM a tartalomról szól)
- Hirdetés / szponzor-blokkok ("Az epizód támogatója…", "Ez az adás a … jóvoltából"), kuponkódok
- YouTube-fejezet-időbélyegek (00:01:23 — fejezetcím listák)
- Záró "köszönjük a hallgatást" frázisok

BENNHAGYNI:
- Téma- és vendég-leírás, riport, kérdések
- Idézetek, kontextus, statisztikák
- Vendég NEVÉT és funkcióját akkor is, ha bemutatkozó mondatban szerepel
- Hivatkozott szervezetek, helyszínek, művek

SZIGORÚ:
- NE foglald össze, NE írd át. Csak emeld ki ami marad.
- NE adj hozzá saját bevezetést, magyarázatot, fejléceket.
- Ha az egész leírás csak CTA/szponzor/szemét, üres stringet adj vissza.
- Csak a tisztított szöveget add vissza, semmi mást.`;

async function aiClean(raw) {
  const body = {
    model: MODEL,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: raw.slice(0, 12000) },
    ],
    temperature: 0,
  };
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`AI ${res.status} ${await res.text().catch(()=>"")}`);
  const data = await res.json();
  return (data.choices?.[0]?.message?.content || "").trim();
}

const raw = fs.readFileSync(csvPath, "utf8").replace(/^\uFEFF/, "");
const parsed = parseCsv(raw);
const header = parsed.shift().map((h) => h.trim());
const rows = parsed
  .filter((c) => c.some((v) => String(v || "").trim()))
  .map((c) => Object.fromEntries(header.map((n, i) => [n, c[i] || ""])));
const usable = rows.filter((r) => r.raw_text.trim() && r.gold_cleaned_text.trim());
console.error(`[ai-eval] usable=${usable.length} model=${MODEL} conc=${CONCURRENCY}`);

const results = [];
let idx = 0;
async function worker() {
  while (true) {
    const i = idx++;
    if (i >= usable.length) return;
    const row = usable[i];
    try {
      const t0 = Date.now();
      const aiText = await aiClean(row.raw_text);
      const detText = heuristicClean(row.raw_text).text;
      const gold = row.gold_cleaned_text;
      const aiQ = assessCleanTextQuality(row.raw_text, aiText);
      const detQ = assessCleanTextQuality(row.raw_text, detText);
      const aiF1 = tokenF1(aiText, gold);
      const detF1 = tokenF1(detText, gold);
      const curF1 = tokenF1(row.current_cleaned_text, gold);
      results.push({
        episode_id: row.episode_id, bucket: row.sample_bucket || row.bucket,
        podcast_title: row.podcast_title, episode_title: row.episode_title,
        ai_f1: +aiF1.toFixed(4), det_f1: +detF1.toFixed(4), cur_f1: +curF1.toFixed(4),
        ai_dirty: aiQ.dirty_signals, ai_overcut: aiQ.overcut_risk,
        det_dirty: detQ.dirty_signals, det_overcut: detQ.overcut_risk,
        ai_len: aiText.length, det_len: detText.length, gold_len: gold.length, raw_len: row.raw_text.length,
        ai_preview: aiText.slice(0, 400), gold_preview: gold.slice(0, 400),
        det_preview: detText.slice(0, 400),
        ms: Date.now() - t0,
      });
      console.error(`[${i + 1}/${usable.length}] ${row.sample_bucket || row.bucket} ai_F1=${aiF1.toFixed(2)} det_F1=${detF1.toFixed(2)} ai_len=${aiText.length}`);
    } catch (e) {
      console.error(`[${i + 1}] ERROR ${e.message}`);
      results.push({ episode_id: row.episode_id, bucket: row.sample_bucket || row.bucket, error: e.message });
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const ok = results.filter((r) => !r.error);
const byBucket = new Map();
for (const r of ok) {
  const b = r.bucket || "unknown";
  const s = byBucket.get(b) || { rows: 0, ai_f1: [], det_f1: [], cur_f1: [], ai_dirty: 0, ai_overcut: 0, det_dirty: 0, det_overcut: 0 };
  s.rows++;
  s.ai_f1.push(r.ai_f1); s.det_f1.push(r.det_f1); s.cur_f1.push(r.cur_f1);
  if (r.ai_dirty?.length) s.ai_dirty++;
  if (r.ai_overcut) s.ai_overcut++;
  if (r.det_dirty?.length) s.det_dirty++;
  if (r.det_overcut) s.det_overcut++;
  byBucket.set(b, s);
}

const summary = {
  model: MODEL, rows: usable.length, ok: ok.length, errors: results.length - ok.length,
  overall: {
    ai_avg_f1: +avg(ok.map(r=>r.ai_f1)).toFixed(4),
    det_avg_f1: +avg(ok.map(r=>r.det_f1)).toFixed(4),
    cur_avg_f1: +avg(ok.map(r=>r.cur_f1)).toFixed(4),
    ai_dirty_pct: pct(ok.filter(r=>r.ai_dirty?.length).length / Math.max(ok.length,1)),
    ai_overcut_pct: pct(ok.filter(r=>r.ai_overcut).length / Math.max(ok.length,1)),
    det_dirty_pct: pct(ok.filter(r=>r.det_dirty?.length).length / Math.max(ok.length,1)),
    det_overcut_pct: pct(ok.filter(r=>r.det_overcut).length / Math.max(ok.length,1)),
    ai_better_rows: ok.filter(r=>r.ai_f1 > r.det_f1 + 0.05).length,
    det_better_rows: ok.filter(r=>r.det_f1 > r.ai_f1 + 0.05).length,
  },
  buckets: Object.fromEntries(Array.from(byBucket.entries()).map(([b, s]) => [b, {
    rows: s.rows,
    ai_f1: +avg(s.ai_f1).toFixed(4),
    det_f1: +avg(s.det_f1).toFixed(4),
    cur_f1: +avg(s.cur_f1).toFixed(4),
    ai_dirty_pct: pct(s.ai_dirty / s.rows),
    ai_overcut_pct: pct(s.ai_overcut / s.rows),
    det_dirty_pct: pct(s.det_dirty / s.rows),
    det_overcut_pct: pct(s.det_overcut / s.rows),
  }])),
  rows: results,
};

fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
console.error(`Wrote ${outPath}`);
console.log(JSON.stringify({
  model: summary.model, ok: summary.ok, errors: summary.errors,
  overall: summary.overall, buckets: summary.buckets,
}, null, 2));
