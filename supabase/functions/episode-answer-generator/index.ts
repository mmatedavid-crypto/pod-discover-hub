// deno-lint-ignore-file no-explicit-any
// Episode Q&A pilot generator ("Milyen kérdésekre kapsz választ?").
// Only for frozen pilot TREATMENT episodes. Grounded strictly in the episode
// transcript: every answer must cite transcript blocks, pass a lexical
// support check, and only gets a playable timestamp when the transcript
// timeline is verified against the audio file. Versioned (content_version),
// re-runnable (upsert per episode+version+anchor), cost-capped, and fully
// reversible (app_settings.episode_answers_pilot.enabled=false hides it all).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { recordAiCall, creditBreakerOpen, tripCreditBreaker } from "../_shared/lovable-ai.ts";

declare const Deno: any;
const MODEL = "openai/gpt-6-astra";
const JOB = "episode_answer_generator";
const PROMPT_VERSION = "episode-qa-v1";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const KEY = Deno.env.get("LOVABLE_API_KEY") || "";

const MAX_TRANSCRIPT_CHARS = 60_000;
const BLOCK_SECONDS = 45;
const BLOCK_CHARS = 700; // for untimed transcripts
const ALIGN_TOLERANCE_SEC = 5;
const MIN_SUPPORT = 0.5;

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["question", "answer", "block_start", "block_end", "speaker", "domain"],
        properties: {
          question: { type: "string" },
          answer: { type: "string" },
          block_start: { type: "integer" },
          block_end: { type: "integer" },
          speaker: { type: ["string", "null"] },
          domain: { type: "string", enum: ["general", "psychology", "health", "finance"] },
        },
      },
    },
  },
};

const SYSTEM = `Egy magyar podcastepizód leiratából gyűjtöd ki, milyen konkrét hallgatói kérdésekre ad választ az adás.
A leirat számozott blokkokra van bontva: [B12] szöveg.
SZABÁLYOK:
- Legfeljebb 5, legalább 0 tétel. Csak olyan kérdés, amelyre a leirat ténylegesen, érdemben válaszol. Ha nincs ilyen, üres lista.
- A kérdés természetes, első vagy második személyű, ahogy egy hallgató beírná (pl. "Hogyan beszéljek a gyerekemmel a pénzről?"). Ne az epizódról kérdezz ("Miről szól az adás?" TILOS).
- A válasz 1–3 mondat, önmagában érthető, KIZÁRÓLAG a hivatkozott blokkok tartalmából. Ne egészítsd ki általános tudással, ne adj saját tanácsot.
- Pszichológiai, egészségügyi, pénzügyi témánál a választ a megszólaló álláspontjaként fogalmazd ("A beszélgetésben elhangzik, hogy…", "A vendég szerint…"). Ne diagnosztizálj, ne állíts általános szakmai tényt, ne találj ki végzettséget vagy titulust.
- block_start..block_end: a választ alátámasztó összefüggő blokktartomány (legfeljebb 4 blokk).
- speaker: csak akkor név, ha a hivatkozott blokkokban a beszélő neve egyértelműen elhangzik; különben null.
- domain: general | psychology | health | finance.
- A leirat gépi átirat, lehetnek benne hibák: ne idézz szó szerint hibás részt, és ne építs választ bizonytalan, értelmetlen szövegre.
- Reklám, szponzori üzenet, köszönés, műsorajánló nem lehet kérdés alapja.`;

type Block = { idx: number; start: number | null; end: number | null; text: string };

function cleanSeg(s: string) {
  return String(s || "").replace(/\[(zene|Zene|taps|nevetés)[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
}

function buildBlocks(t: any): { blocks: Block[]; timed: boolean } {
  const segs = Array.isArray(t.segments) ? t.segments : [];
  const blocks: Block[] = [];
  let total = 0;
  if (segs.length && typeof segs[0]?.start === "number") {
    let cur: Block | null = null;
    for (const s of segs) {
      const txt = cleanSeg(s.text);
      if (!txt) continue;
      if (!cur || (Number(s.start) - Number(cur.start)) >= BLOCK_SECONDS) {
        if (cur) blocks.push(cur);
        cur = { idx: blocks.length, start: Number(s.start), end: Number(s.end ?? s.start), text: txt };
      } else {
        cur.text += " " + txt;
        cur.end = Number(s.end ?? s.start);
      }
      total += txt.length;
      if (total > MAX_TRANSCRIPT_CHARS) break;
    }
    if (cur) blocks.push(cur);
    return { blocks, timed: true };
  }
  const text = cleanSeg(t.transcript).slice(0, MAX_TRANSCRIPT_CHARS);
  for (let i = 0; i < text.length; i += BLOCK_CHARS) {
    blocks.push({ idx: blocks.length, start: null, end: null, text: text.slice(i, i + BLOCK_CHARS) });
  }
  return { blocks, timed: false };
}

const STOP = new Set(["hogy", "amikor", "mert", "vagy", "illetve", "szerint", "beszélgetésben", "elhangzik", "vendég", "szerinte", "akkor", "lehet", "nagyon", "például", "olyan", "ilyen", "mindig", "csak", "több", "kell", "fontos", "érdemes"]);
function stems(s: string): string[] {
  return (s.toLowerCase().normalize("NFC").match(/[\p{L}]{5,}/gu) || [])
    .filter((w) => !STOP.has(w)).map((w) => w.slice(0, 5));
}
function support(answer: string, excerpt: string): number {
  const a = [...new Set(stems(answer))];
  if (!a.length) return 0;
  const ex = new Set(stems(excerpt));
  return a.filter((w) => ex.has(w)).length / a.length;
}
function slug(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

async function callAstra(input: string) {
  const t0 = Date.now();
  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": KEY, "X-Lovable-AIG-SDK": "fetch" },
    body: JSON.stringify({
      model: MODEL, stream: true, store: false, reasoning: { effort: "low" },
      instructions: SYSTEM, input,
      text: { format: { type: "json_schema", name: "episode_qa", strict: true, schema: SCHEMA } },
    }),
  });
  if (!res.ok || !res.body) {
    const txt = await res.text();
    await recordAiCall({ job_type: JOB, model_used: MODEL, status: "error", error_message: `${res.status} ${txt.slice(0, 300)}`, prompt_version: PROMPT_VERSION, latency_ms: Date.now() - t0 }).catch(() => {});
    throw Object.assign(new Error(`gateway ${res.status}: ${txt.slice(0, 200)}`), { status: res.status });
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", text = "", usage: any = null, refusal = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const p = line.slice(5).trim();
      if (!p || p === "[DONE]") continue;
      try {
        const ev = JSON.parse(p);
        if (ev.type === "response.output_text.delta") text += ev.delta || "";
        if (ev.type === "response.refusal.delta") refusal += ev.delta || "";
        if (ev.type === "response.completed") usage = ev.response?.usage;
      } catch { /* partial */ }
    }
  }
  const inTok = Number(usage?.input_tokens || 0), outTok = Number(usage?.output_tokens || 0);
  const cost = (inTok * 10 + outTok * 50) / 1_000_000;
  await recordAiCall({ job_type: JOB, model_used: MODEL, input_tokens: inTok, output_tokens: outTok, estimated_cost_usd: cost, prompt_version: PROMPT_VERSION, latency_ms: Date.now() - t0 }).catch(() => {});
  if (refusal) throw Object.assign(new Error("refusal"), { status: 200, refusal: true });
  return { items: (JSON.parse(text || "{}").items || []) as any[], cost };
}

async function processEpisode(episodeId: string, version: string) {
  const { data: ep } = await sb.from("episodes").select("id,title,display_title,duration_seconds,youtube_video_id,description").eq("id", episodeId).maybeSingle();
  const { data: tr } = await sb.from("episode_transcripts").select("id,model,transcript,segments,duration_seconds").eq("episode_id", episodeId).eq("status", "ok")
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (!ep || !tr) return { episodeId, status: "no_transcript", cost: 0 };

  const { blocks, timed } = buildBlocks(tr);
  const isRss = String(tr.model || "").startsWith("rss_");
  const aligned = timed && (isRss || (Number(tr.duration_seconds) > 0 && Number(ep.duration_seconds) > 0 &&
    Math.abs(Number(tr.duration_seconds) - Number(ep.duration_seconds)) <= ALIGN_TOLERANCE_SEC));
  const sourceType = isRss ? "rss_transcript" : String(tr.model || "").includes("youtube") ? "youtube_captions" : String(tr.model || "transcript");

  const input = `Epizód címe: ${ep.display_title || ep.title}\n\nLeirat:\n` + blocks.map((b) => `[B${b.idx}] ${b.text}`).join("\n");
  const { items, cost } = await callAstra(input);

  const rows: any[] = [];
  const seen = new Set<string>();
  let pos = 0;
  for (const it of items.slice(0, 5)) {
    const q = String(it.question || "").trim().slice(0, 200);
    const a = String(it.answer || "").trim().slice(0, 700);
    const bs = Number(it.block_start), be = Number(it.block_end);
    const reasons: string[] = [];
    if (!(bs >= 0 && be >= bs && be < blocks.length)) reasons.push("invalid_block_range");
    if (be - bs > 5) reasons.push("block_range_too_wide");
    if (q.length < 12 || a.length < 40) reasons.push("too_short");
    const cited = reasons.includes("invalid_block_range") ? [] : blocks.slice(bs, be + 1);
    const excerpt = cited.map((b) => b.text).join(" ").slice(0, 1500);
    const sup = excerpt ? support(a, excerpt) : 0;
    if (sup < MIN_SUPPORT) reasons.push("weak_lexical_support");
    let anchor = "valasz-" + slug(q);
    if (seen.has(anchor)) reasons.push("duplicate_question");
    seen.add(anchor);
    let speaker = it.speaker ? String(it.speaker).trim() : null;
    if (speaker && !excerpt.toLowerCase().includes(speaker.toLowerCase().split(" ").pop() || "§")) speaker = null;
    const startSec = cited[0]?.start ?? null;
    const endSec = cited[cited.length - 1]?.end ?? null;
    const tsStatus = timed && startSec != null
      ? (aligned ? "audio_verified" : (ep.youtube_video_id && sourceType === "youtube_captions" ? "youtube_only" : "none"))
      : "none";
    const status = reasons.length ? "rejected" : "published";
    if (status === "published") pos++;
    rows.push({
      episode_id: episodeId, anchor, position: status === "published" ? pos : 100 + rows.length,
      question: q || "(üres)", answer: a || "(üres)", speaker, excerpt: excerpt || "(nincs)",
      excerpt_block_start: Number.isFinite(bs) ? bs : -1, excerpt_block_end: Number.isFinite(be) ? be : -1,
      start_sec: tsStatus === "none" ? null : startSec, end_sec: tsStatus === "none" ? null : endSec,
      timestamp_status: tsStatus, youtube_video_id: tsStatus === "youtube_only" ? ep.youtube_video_id : null,
      source_type: sourceType, transcript_id: tr.id,
      sensitive_domain: it.domain && it.domain !== "general" ? it.domain : null,
      content_version: version, model: MODEL, status,
      verification: { lexical_support: Number(sup.toFixed(2)), reasons, aligned, timed, prompt_version: PROMPT_VERSION, block_seconds: BLOCK_SECONDS,
        transcript_duration: tr.duration_seconds, audio_duration: ep.duration_seconds },
    });
  }
  await sb.from("episode_answers").delete().eq("episode_id", episodeId).eq("content_version", version);
  if (rows.length) {
    const { error } = await sb.from("episode_answers").insert(rows);
    if (error) throw new Error(`insert: ${error.message}`);
  }
  const published = rows.filter((r) => r.status === "published").length;
  await sb.from("episode_answer_pilot").update({ generated_at: new Date().toISOString(), generation_status: `ok:${published}/${rows.length}`, generation_cost_usd: cost }).eq("episode_id", episodeId);
  return { episodeId, status: "ok", published, rejected: rows.length - published, aligned, cost };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  const body = await req.json().catch(() => ({}));
  const { data: cfgRow } = await sb.from("app_settings").select("value").eq("key", "episode_answers_pilot").maybeSingle();
  const cfg = (cfgRow?.value || {}) as any;
  const version = String(cfg.content_version || "qa-v1");
  if (await creditBreakerOpen()) return json({ ok: false, paused: "credit_breaker_open" });

  const { data: spentRows } = await sb.from("episode_answer_pilot").select("generation_cost_usd");
  let totalSpent = (spentRows || []).reduce((s: number, r: any) => s + Number(r.generation_cost_usd || 0), 0);
  const maxTotal = Number(cfg.max_total_usd ?? 20), maxRun = Number(cfg.max_usd_per_run ?? 4);
  if (totalSpent >= maxTotal) return json({ ok: false, paused: "pilot_budget_reached", totalSpent });

  const limit = Math.min(Math.max(Number(body.limit ?? 4), 1), 8);
  let q = sb.from("episode_answer_pilot").select("episode_id").eq("pilot_group", "treatment").order("pair_id").limit(limit);
  q = Array.isArray(body.episode_ids) && body.episode_ids.length ? q.in("episode_id", body.episode_ids) : (body.force ? q : q.is("generated_at", null));
  const { data: todo } = await q;
  const results: any[] = [];
  let runSpent = 0;
  // Small fixed concurrency; stops on budget, credits or provider denial.
  const queue = [...(todo || [])];
  let halted: string | null = null;
  async function worker() {
    while (queue.length && !halted) {
      if (runSpent >= maxRun || totalSpent >= maxTotal) { halted = "budget"; break; }
      const { episode_id } = queue.shift()!;
      try {
        const r = await processEpisode(episode_id, version);
        runSpent += r.cost || 0; totalSpent += r.cost || 0;
        results.push(r);
      } catch (e: any) {
        if (e.status === 402) { await tripCreditBreaker(JOB); halted = "credits_402"; }
        else if (e.status === 403) halted = "provider_denied_403";
        else if (e.refusal) await sb.from("episode_answer_pilot").update({ generated_at: new Date().toISOString(), generation_status: "refusal" }).eq("episode_id", episode_id);
        results.push({ episodeId: episode_id, error: String(e.message || e).slice(0, 200) });
      }
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  return json({ ok: true, version, halted, run_spent_usd: Number(runSpent.toFixed(3)), total_spent_usd: Number(totalSpent.toFixed(3)), results });
});
