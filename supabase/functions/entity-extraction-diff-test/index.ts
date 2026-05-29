// One-shot diagnostic: re-extract organizations on N random v3 HU eps using clean_text,
// compare against existing episodes.organizations, return aggregate diff + samples.
// READ-ONLY: does NOT write back to episodes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callGeminiOpenAI, assertModelAllowed } from "../_shared/google-gemini-direct.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const ORG_TYPES = ["company","party","institution","media","ngo","sport_team","sport_league","church","university","research","radio_station","other"] as const;

const ENTITY_TOOL = {
  type: "function",
  function: {
    name: "extract_entities",
    description:
      "Extract structured entities from a podcast episode based ONLY on title + description.\n" +
      "organizations: all named orgs with precise type from enum. Do NOT include podcast names, podcast networks, hosting platforms (Spotify, Apple Podcasts), or sponsors only mentioned in credits.",
    parameters: {
      type: "object",
      properties: {
        organizations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              type: { type: "string", enum: [...ORG_TYPES] as any },
            },
            required: ["name", "type"],
            additionalProperties: false,
          },
        },
      },
      required: ["organizations"],
      additionalProperties: false,
    },
  },
};

const SYSTEM = "You extract named organizations from podcast episode metadata. ONLY include orgs literally present. Classify each with precise `type`. Never include podcast/network/platform names. No invention.";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(200, Number(body.limit) || 100));
    const model = String(body.model || "google/gemini-2.5-flash");
    assertModelAllowed(model);

    // Sample N random v3 HU eps with clean_text done AND existing organizations.
    // Use the RPC-friendly two-step fetch to avoid nested-embed errors.
    const { data: epRows, error } = await admin
      .from("episodes")
      .select("id, title, display_title, organizations, podcast_id, podcasts!inner(title, display_title, hosts, is_hungarian)")
      .eq("podcasts.is_hungarian", true)
      .eq("ai_entities_version", 3)
      .eq("clean_text_status", "done")
      .not("organizations", "is", null)
      .limit(limit * 4);
    if (error) throw new Error(`episodes select: ${error.message}`);
    const candidates = (epRows || []).filter((e: any) => Array.isArray(e.organizations) && e.organizations.length > 0);
    if (candidates.length === 0) return json({ ok: true, processed: 0, note: "no candidates" });

    // Fetch clean_text for those ids
    const ids = candidates.map((e: any) => e.id);
    const { data: cts, error: ctErr } = await admin
      .from("episode_clean_text")
      .select("episode_id, cleaned_text")
      .in("episode_id", ids);
    if (ctErr) throw new Error(`clean_text select: ${ctErr.message}`);
    const ctMap = new Map<string, string>();
    for (const r of (cts || [])) ctMap.set((r as any).episode_id, (r as any).cleaned_text || "");

    const pool = candidates
      .map((e: any) => ({ ...e, cleaned_text: ctMap.get(e.id) || "" }))
      .filter((e: any) => e.cleaned_text.length > 80);
    const sample = pool.slice(0, limit);

    let totalOld = 0, totalNew = 0, totalAdded = 0, totalRemoved = 0, totalKept = 0;
    const removedFreq: Record<string, number> = {};
    const addedFreq: Record<string, number> = {};
    const samples: any[] = [];
    let totalCost = 0;
    let aiFailures = 0;

    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

    let cursor = 0;
    const workers = Array.from({ length: 10 }, async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= sample.length) return;
        const ep = sample[idx];
        const desc = String(ep.cleaned_text || "").replace(/\s+/g, " ").trim().slice(0, 2500);
        const ep = sample[idx];
        const cleaned = ep.episode_clean_text?.[0]?.cleaned_text || "";
        const desc = cleaned.replace(/\s+/g, " ").trim().slice(0, 2500);
        const podName = ep.podcasts?.display_title || ep.podcasts?.title || "";
        const hosts: string[] = Array.isArray(ep.podcasts?.hosts) ? ep.podcasts.hosts : [];
        const hostLine = hosts.length ? `Show hosts (ignore): ${hosts.join(", ")}\n` : "";
        const userPrompt = `${hostLine}Show: ${podName}\nEpisode: ${ep.display_title || ep.title}\nDescription: ${desc}\n\nExtract all named organizations.`;

        const aiRes = await callGeminiOpenAI({
          model,
          messages: [{ role: "system", content: SYSTEM }, { role: "user", content: userPrompt }],
          tools: [ENTITY_TOOL],
          tool_choice: { type: "function", function: { name: "extract_entities" } },
          job_type: "entity_diff_test",
          target_type: "episode",
          target_id: ep.id,
          preferTier1: true,
        });
        if (!aiRes.ok) { aiFailures++; continue; }
        totalCost += aiRes.cost_usd ?? 0;
        const args = aiRes.data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
        const parsed = args ? JSON.parse(args) : null;
        if (!parsed) { aiFailures++; continue; }

        const oldOrgs = (Array.isArray(ep.organizations) ? ep.organizations : []) as any[];
        const newOrgs = (Array.isArray(parsed.organizations) ? parsed.organizations : []) as any[];
        const oldSet = new Set(oldOrgs.map((o: any) => norm(o?.name || "")).filter(Boolean));
        const newSet = new Set(newOrgs.map((o: any) => norm(o?.name || "")).filter(Boolean));

        const removed = [...oldSet].filter((x) => !newSet.has(x));
        const added = [...newSet].filter((x) => !oldSet.has(x));
        const kept = [...oldSet].filter((x) => newSet.has(x));

        totalOld += oldSet.size;
        totalNew += newSet.size;
        totalRemoved += removed.length;
        totalAdded += added.length;
        totalKept += kept.length;

        for (const r of removed) removedFreq[r] = (removedFreq[r] || 0) + 1;
        for (const a of added) addedFreq[a] = (addedFreq[a] || 0) + 1;

        if (samples.length < 15 && (removed.length > 0 || added.length > 0)) {
          samples.push({
            id: ep.id,
            title: ep.display_title || ep.title,
            podcast: podName,
            old: oldOrgs.map((o: any) => `${o.name} [${o.type}]`),
            new: newOrgs.map((o: any) => `${o.name} [${o.type}]`),
            removed,
            added,
          });
        }
      }
    });
    await Promise.all(workers);

    const topRemoved = Object.entries(removedFreq).sort((a, b) => b[1] - a[1]).slice(0, 30);
    const topAdded = Object.entries(addedFreq).sort((a, b) => b[1] - a[1]).slice(0, 30);

    return json({
      ok: true,
      processed: sample.length,
      ai_failures: aiFailures,
      cost_usd: Number(totalCost.toFixed(4)),
      model,
      aggregate: {
        avg_old_per_ep: sample.length ? +(totalOld / sample.length).toFixed(2) : 0,
        avg_new_per_ep: sample.length ? +(totalNew / sample.length).toFixed(2) : 0,
        avg_removed_per_ep: sample.length ? +(totalRemoved / sample.length).toFixed(2) : 0,
        avg_added_per_ep: sample.length ? +(totalAdded / sample.length).toFixed(2) : 0,
        avg_kept_per_ep: sample.length ? +(totalKept / sample.length).toFixed(2) : 0,
        total_old: totalOld,
        total_new: totalNew,
        total_removed: totalRemoved,
        total_added: totalAdded,
        total_kept: totalKept,
        shrink_pct: totalOld ? +((1 - totalNew / totalOld) * 100).toFixed(1) : 0,
      },
      top_removed: topRemoved,
      top_added: topAdded,
      samples,
    });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
