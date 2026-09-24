// deno-lint-ignore-file no-explicit-any
// GPT-6 Astra quality audit for public people + organizations.
// Fully automatic: confident verdicts are applied, uncertain ones are only
// recorded (astra_verdict) — nothing is sent to a human review queue.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { recordAiCall } from "../_shared/lovable-ai.ts";
import { checkBudget } from "../_shared/google-gemini-direct.ts";

declare const Deno: any;
const MODEL = "openai/gpt-6-astra";
const JOB = "entity_astra_audit";
const PROMPT_VERSION = "entity-astra-audit-v2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const KEY = Deno.env.get("LOVABLE_API_KEY") || "";

type Kind = "person" | "organization";
type Entity = { id: string; kind: Kind; name: string; bio: string; wiki: string; episodes: string[]; protected: boolean };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "verdict", "confidence", "corrected_name", "reason"],
        properties: {
          id: { type: "string" },
          verdict: { type: "string", enum: ["ok", "not_real_entity", "wrong_type", "bad_bio", "wrong_name"] },
          confidence: { type: "number" },
          corrected_name: { type: ["string", "null"] },
          reason: { type: "string" },
        },
      },
    },
  },
};

const SYSTEM = `Egy magyar podcast-katalógus személy- és szervezetoldalait ellenőrzöd.
Minden tételre adj egy ítéletet:
- ok: valódi, konkrét személy/szervezet, a név és a leírás rendben van.
- not_real_entity: nem konkrét entitás, hanem fogalom, téma, szerepnév vagy köznév (pl. "Szakértő", "emberi értelem", "Mesterséges Intelligencia", "oktatás").
- wrong_type: valódi entitás, de rossz típus (személy szervezetként vagy fordítva).
- bad_bio: valódi entitás, de a leírás téves, más személyről szól, vagy nem igazolható állítást tartalmaz az epizódok alapján.
- wrong_name: valódi entitás, de a név elírt/ragozott/csonka; add meg a helyes nevet a corrected_name mezőben.
FONTOS: a tudásod lehet elavult. Friss eseményt (választás, tisztségváltás, 2025–2026-os hír) SOHA ne tekints hibának csak azért, mert nem ismered. bad_bio csak akkor, ha a leírás egyértelműen más személyről/szervezetről szól, vagy ellentmond az epizódcímeknek.
A confidence 0 és 1 közötti szám. Csak akkor adj 0.85 fölötti értéket, ha biztos vagy. Ha kétséges, legyen "ok" alacsonyabb bizonyossággal.
A reason legyen egy rövid magyar mondat. Minden bemeneti id-re pontosan egy tétel.`;

async function loadBatch(kind: Kind, limit: number, offset: number): Promise<Entity[]> {
  const table = kind === "person" ? "people" : "organizations";
  const extra = kind === "person" ? ",manual_approved,manually_seeded,editorial_priority" : ",manually_seeded,editorial_priority";
  const { data, error } = await sb.from(table)
    .select(`id,name,ai_bio,wikipedia_description${extra}`)
    .eq("is_public", true).is("astra_reviewed_at", null)
    .order("is_indexable", { ascending: false }).order("episode_count", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  const out: Entity[] = [];
  for (const r of data || []) {
    let eps: string[] = [];
    if (kind === "person") {
      const { data: m } = await sb.from("person_episode_mentions").select("episodes(title,podcasts(title))")
        .eq("person_id", r.id).not("relevance_status", "in", "(rejected,duplicate,invalid)").limit(5);
      eps = (m || []).map((x: any) => `${x.episodes?.podcasts?.title || ""}: ${x.episodes?.title || ""}`);
    } else {
      const { data: m } = await sb.from("episode_organization_map").select("episodes(title,podcasts(title))")
        .eq("organization_id", r.id).limit(5);
      eps = (m || []).map((x: any) => `${x.episodes?.podcasts?.title || ""}: ${x.episodes?.title || ""}`);
    }
    out.push({
      id: r.id, kind, name: r.name,
      bio: String(r.ai_bio || "").slice(0, 500), wiki: String(r.wikipedia_description || "").slice(0, 200),
      episodes: eps, protected: !!(r.manual_approved || r.manually_seeded || r.editorial_priority),
    });
  }
  return out;
}

async function callAstra(batch: Entity[]) {
  const input = batch.map((e) => ({ id: e.id, tipus: e.kind === "person" ? "személy" : "szervezet", nev: e.name, leiras: e.bio, wikipedia: e.wiki, epizodok: e.episodes }));
  const t0 = Date.now();
  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": KEY, "X-Lovable-AIG-SDK": "fetch" },
    body: JSON.stringify({
      model: MODEL, stream: true, store: false,
      reasoning: { effort: "low" },
      instructions: SYSTEM,
      input: JSON.stringify(input),
      text: { format: { type: "json_schema", name: "audit", strict: true, schema: SCHEMA } },
    }),
  });
  if (!res.ok || !res.body) {
    const txt = await res.text();
    await recordAiCall({ job_type: JOB, model_used: MODEL, status: "error", error_message: `${res.status} ${txt.slice(0, 300)}`, prompt_version: PROMPT_VERSION, latency_ms: Date.now() - t0 }).catch(() => {});
    throw Object.assign(new Error(`gateway ${res.status}: ${txt.slice(0, 200)}`), { status: res.status });
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", text = "", usage: any = null;
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
        if (ev.type === "response.completed") usage = ev.response?.usage;
      } catch { /* partial */ }
    }
  }
  const inTok = Number(usage?.input_tokens || 0), outTok = Number(usage?.output_tokens || 0);
  await recordAiCall({
    job_type: JOB, model_used: MODEL, input_tokens: inTok, output_tokens: outTok,
    estimated_cost_usd: (inTok * 10 + outTok * 50) / 1_000_000,
    prompt_version: PROMPT_VERSION, latency_ms: Date.now() - t0, meta: { batch: batch.length },
  });
  return (JSON.parse(text || "{}").items || []) as any[];
}

async function apply(e: Entity, v: any, minConf: number) {
  const table = e.kind === "person" ? "people" : "organizations";
  const conf = Number(v?.confidence || 0);
  const verdict = v?.verdict || "missing";
  const upd: Record<string, unknown> = {
    astra_reviewed_at: new Date().toISOString(),
    astra_verdict: { verdict, confidence: conf, reason: v?.reason || null, corrected_name: v?.corrected_name || null, applied: false, model: MODEL, v: PROMPT_VERSION },
  };
  let applied = false;
  if (v && conf >= minConf && verdict !== "ok") {
    if ((verdict === "not_real_entity" || verdict === "wrong_type") && !e.protected) {
      Object.assign(upd, { is_public: false, is_indexable: false, ai_recommended_action: "hide" },
        e.kind === "person" ? { is_browsable_in_people_hub: false } : { is_browsable_in_hub: false });
      if (e.kind === "organization") await sb.from("episode_organization_map").delete().eq("organization_id", e.id);
      applied = true;
    } else if (verdict === "bad_bio") {
      Object.assign(upd, { ai_bio: null, ai_bio_status: e.kind === "person" ? null : "pending" });
      applied = true;
    } else if (verdict === "wrong_name" && v.corrected_name && conf >= 0.92 && !e.protected) {
      upd.name = String(v.corrected_name).trim().slice(0, 200);
      applied = true;
    }
  }
  (upd.astra_verdict as any).applied = applied;
  const { error } = await sb.from(table).update(upd).eq("id", e.id);
  if (error) { console.error("update failed", e.id, error.message); return { verdict: "update_error", applied: false }; }
  return { verdict, applied };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const body = await req.json().catch(() => ({}));
  const { data: ctl } = await sb.from("app_settings").select("value").eq("key", "entity_astra_audit_controls").maybeSingle();
  const c = ctl?.value || {};
  if (c.enabled === false) return Response.json({ skipped: "disabled" }, { headers: cors });
  const budget = await checkBudget(JOB);
  if (!budget.allowed) return Response.json({ skipped: budget.reason }, { headers: cors });

  const size = Number(body.batch_size || c.batch_size || 12);
  const par = Number(body.parallel_calls || c.parallel_calls || 4);
  const minConf = Number(c.min_confidence || 0.85);

  // Split parallel slots between people and orgs; each slot takes a disjoint page.
  const jobs: Promise<Entity[]>[] = [];
  for (let i = 0; i < par; i++) {
    const kind: Kind = i % 2 === 0 ? "person" : "organization";
    jobs.push(loadBatch(kind, size, Math.floor(i / 2) * size));
  }
  const batches = (await Promise.all(jobs)).filter((b) => b.length);
  const stats: Record<string, number> = {};
  let errors = 0;
  await Promise.all(batches.map(async (batch) => {
    try {
      const items = await callAstra(batch);
      const byId = new Map(items.map((x) => [x.id, x]));
      for (const e of batch) {
        const r = await apply(e, byId.get(e.id), minConf);
        const k = `${e.kind}:${r.verdict}${r.applied ? ":applied" : ""}`;
        stats[k] = (stats[k] || 0) + 1;
      }
    } catch (err: any) {
      errors++;
      console.error("batch failed", err?.message);
      if (err?.status === 402 || err?.status === 403) {
        await sb.from("app_settings").update({ value: { ...c, enabled: false, paused_reason: `gateway_${err.status}` } }).eq("key", "entity_astra_audit_controls");
      }
    }
  }));
  return Response.json({ reviewed: Object.values(stats).reduce((a, b) => a + b, 0), errors, stats }, { headers: cors });
});
