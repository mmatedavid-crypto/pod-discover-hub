// Maps frequent free-text episode topic labels (episodes.topics[]) onto canonical
// topic hubs by seeding public.topic_aliases.
//
// Why: the prerender engine only turns an episode topic into an internal <a> link
// when it resolves to an indexable topic hub. Most free-text labels ("buddhizmus",
// "megvilágosodás") never matched a canonical slug, so long-tail episode pages had
// no bot-visible links into the hubs. Aliases fix that at the root.
//
// Body: { batch?: number, min_count?: number, dry_run?: boolean, model?: string }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { callLovableAI } from "../_shared/lovable-ai.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const DEFAULT_MODEL = "google/gemini-2.5-flash-lite";
const TIME_BUDGET_MS = 55_000;
const CHUNK = 40;

const MAP_TOOL = {
  type: "function",
  function: {
    name: "map_topic_labels",
    description:
      "Map each free-text Hungarian podcast topic label to at most one canonical topic slug from the provided list, or null when no canonical hub genuinely covers the label.",
    parameters: {
      type: "object",
      properties: {
        mappings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              topic_slug: { type: ["string", "null"] },
              confidence: { type: "number", minimum: 0, maximum: 1 },
            },
            required: ["label", "topic_slug", "confidence"],
            additionalProperties: false,
          },
        },
      },
      required: ["mappings"],
      additionalProperties: false,
    },
  },
};

const SYSTEM = `Magyar podcast-taxonómia asszisztens vagy. Szabad szöveges téma-címkéket rendelsz hozzá kanonikus téma-hubokhoz.

SZABÁLYOK:
- Csak a megadott slug-listából választhatsz, vagy null-t adsz.
- Akkor rendelj slugot, ha a címke a hub témájának valódi része vagy szinonimája (pl. "megvilágosodás" -> buddhizmus-zen, "horoszkóp" -> asztrologia).
- Túl általános ("beszélgetés", "hírek", "élet"), személynév, műsornév, márkanév, országnév vagy egyszeri esemény esetén: null.
- Ha bizonytalan vagy, adj null-t. Jobb kihagyni, mint rosszul linkelni.
- confidence: 0.9+ csak biztos szinonimára; 0.7-0.89 erős tematikus egyezés; ez alatt inkább null.`;

function normalizeAlias(v: string) {
  return v.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const started = Date.now();
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const batch = Math.min(Math.max(Number(body.batch) || 200, 1), 600);
    const minCount = Math.max(Number(body.min_count) || 15, 2);
    const dryRun = body.dry_run === true;
    const model = String(body.model || DEFAULT_MODEL);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const guard = await checkBackgroundJobsAllowed(supabase, "topic-alias-mapper");
    if (guard.blocked) return json({ ok: false, skipped: "blocked", reason: guard.reason }, 200);

    const [{ data: topics, error: topicErr }, { data: labels, error: labelErr }] = await Promise.all([
      supabase
        .from("topics")
        .select("id, slug, name, short_name, description")
        .eq("is_public", true)
        .eq("is_indexable", true),
      supabase.rpc("top_unmapped_episode_topics", { p_min_count: minCount, p_limit: batch }),
    ]);
    if (topicErr) throw new Error(`topics: ${topicErr.message}`);
    if (labelErr) throw new Error(`labels: ${labelErr.message}`);

    const topicList = (topics || []) as Array<Record<string, string>>;
    const idBySlug = new Map(topicList.map((t) => [t.slug, t.id]));
    const candidates = ((labels || []) as Array<{ name: string; mentions: number }>).filter((r) => r?.name);
    if (!candidates.length) return json({ ok: true, candidates: 0, inserted: 0, note: "nothing_unmapped" });

    const catalog = topicList
      .map((t) => `${t.slug} — ${t.name}${t.short_name && t.short_name !== t.name ? ` (${t.short_name})` : ""}`)
      .sort()
      .join("\n");

    let inserted = 0;
    let skipped = 0;
    let processed = 0;
    const samples: Array<{ label: string; topic_slug: string; confidence: number }> = [];

    for (let i = 0; i < candidates.length; i += CHUNK) {
      if (Date.now() - started > TIME_BUDGET_MS) break;
      const chunk = candidates.slice(i, i + CHUNK);
      const ai = await callLovableAI({
        model,
        job_type: "topic_alias_mapper",
        target_type: "topic_alias",
        prompt_version: "topic-alias-mapper-v1",
        input_text: chunk.map((c) => c.name).join("\n"),
        min_input_chars: 3,
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `KANONIKUS TÉMÁK:\n${catalog}\n\nCÍMKÉK (soronként egy):\n${chunk
              .map((c) => `${c.name} [${c.mentions} epizód]`)
              .join("\n")}`,
          },
        ],
        tools: [MAP_TOOL],
        tool_choice: { type: "function", function: { name: "map_topic_labels" } },
      });
      if (ai.status === 429) break;
      if (ai.status === 402) break;
      if (!ai.ok) {
        console.error("ai_error", ai.status, ai.error);
        break;
      }
      processed += chunk.length;

      const raw = ai.data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
      let mappings: Array<{ label: string; topic_slug: string | null; confidence: number }> = [];
      try {
        mappings = JSON.parse(raw || "{}").mappings || [];
      } catch (_e) {
        continue;
      }

      const rows: Array<Record<string, unknown>> = [];
      const byNorm = new Map(chunk.map((c) => [normalizeAlias(c.name), c.name]));
      for (const m of mappings) {
        const slug = m?.topic_slug ? String(m.topic_slug).trim() : "";
        const conf = Number(m?.confidence) || 0;
        const norm = normalizeAlias(String(m?.label || ""));
        const original = byNorm.get(norm);
        if (!original || !slug || !idBySlug.has(slug) || conf < 0.7) {
          skipped++;
          continue;
        }
        rows.push({
          topic_id: idBySlug.get(slug),
          alias: original,
          normalized_alias: norm,
          weight: conf >= 0.9 ? 2 : 1,
        });
        if (samples.length < 25) samples.push({ label: original, topic_slug: slug, confidence: conf });
      }

      if (rows.length && !dryRun) {
        const { error: insErr } = await supabase.from("topic_aliases").upsert(rows, {
          onConflict: "normalized_alias",
          ignoreDuplicates: true,
        });
        if (insErr) console.error("insert_error", insErr.message);
        else inserted += rows.length;
      } else if (rows.length) {
        inserted += rows.length;
      }
    }

    return json({
      ok: true,
      dry_run: dryRun,
      candidates: candidates.length,
      processed,
      inserted,
      skipped,
      samples,
      elapsed_ms: Date.now() - started,
    });
  } catch (e) {
    console.error("topic-alias-mapper error", e);
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
