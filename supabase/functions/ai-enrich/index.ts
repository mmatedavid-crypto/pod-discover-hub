// AI summary + entity extraction with daily cap & enable flag from app_settings.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callLovableAI, recordAiCall } from "../_shared/lovable-ai.ts";
import { canonicalizeHungarianPersonName } from "../_shared/hu-person-name.ts";
import { isHungarianish } from "../_shared/hu-language-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_MODEL = "google/gemini-2.5-flash-lite";
const PROMPT_VERSION = "ai-enrich-hu-only-v3";
const HU_ONLY_SYSTEM = "Podiverzum magyar podcast-oldal. Minden publikus összefoglalót kizárólag magyarul írj. Angol summary soha nem kerülhet ki. Ne keverd a nyelveket.";

async function loadControls(supabase: any) {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "ai_controls").maybeSingle();
  const v = data?.value || {};
  return {
    enabled: v.enabled !== false,
    maxPerDay: typeof v.max_per_day === "number" ? v.max_per_day : 100,
    maxPerClick: typeof v.max_per_podcast_per_click === "number" ? v.max_per_podcast_per_click : 15,
    model: typeof v.model === "string" && v.model.trim() ? v.model.trim() : DEFAULT_MODEL,
    minInputChars: typeof v.min_input_chars === "number" ? v.min_input_chars : 80,
  };
}

async function summariesToday(supabase: any) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const { count } = await supabase
    .from("episodes").select("*", { count: "exact", head: true })
    .not("summary", "is", null).gte("updated_at", start.toISOString());
  return count || 0;
}

async function sha256Hex(s: string): Promise<string> {
  const enc = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hasSuccessfulAiRun(supabase: any, jobType: string, targetType: string, targetId: string, sourceHash: string): Promise<boolean> {
  const { data } = await supabase
    .from("ai_call_audit")
    .select("id")
    .eq("job_type", jobType)
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .eq("source_hash", sourceHash)
    .eq("prompt_version", PROMPT_VERSION)
    .eq("status", "ok")
    .limit(1)
    .maybeSingle();
  return !!data?.id;
}

function isAcceptedHungarianPodcast(p: any): boolean {
  return p?.is_hungarian === true || String(p?.language_decision || "") === "accept_hungarian" || String(p?.language || "").toLowerCase().startsWith("hu");
}

async function recordDuplicateSkip(jobType: string, targetType: string, targetId: string, sourceHash: string, model: string) {
  await recordAiCall({
    job_type: jobType,
    model_used: model,
    status: "skipped",
    estimated_cost_usd: 0,
    prompt_version: PROMPT_VERSION,
    source_hash: sourceHash,
    target_type: targetType,
    target_id: targetId,
    key_source: "none",
    meta: { skipped_reason: "unchanged_ai_input", guard: "source_hash_dedupe" },
  });
}

async function updateRowWithHashFallback(supabase: any, table: "episodes" | "podcasts", id: string, update: Record<string, unknown>) {
  const { error } = await supabase.from(table).update(update).eq("id", id);
  if (!error) return;

  const message = String(error.message || "");
  if (!message.includes("ai_enrich_input_hash") && !message.includes("ai_enrich_prompt_version")) {
    throw error;
  }

  const fallback = { ...update };
  delete fallback.ai_enrich_input_hash;
  delete fallback.ai_enrich_prompt_version;
  const retry = await supabase.from(table).update(fallback).eq("id", id);
  if (retry.error) throw retry.error;
}

async function loadEpisodeCleanText(supabase: any, episodeId: string): Promise<{ text: string; method: string } | null> {
  const { data } = await supabase
    .from("episode_clean_text")
    .select("cleaned_text,cleaner_method")
    .eq("episode_id", episodeId)
    .like("cleaner_method", "deterministic_v4%")
    .maybeSingle();
  const text = String(data?.cleaned_text || "").trim();
  if (!text) return null;
  return { text, method: String(data?.cleaner_method || "") };
}

function dirtySignals(text: string): string[] {
  const signals: string[] = [];
  if (/https?:\/\/|www\./i.test(text)) signals.push("url");
  if (/@[A-Za-z0-9_.-]+/.test(text)) signals.push("social_handle");
  if (/\b(instagram|facebook|youtube|tiktok|spotify|patreon|discord|kövess|iratkozz|feliratkoz)\b/i.test(text)) {
    signals.push("platform_or_cta");
  }
  if (/\b(undefined|null|\[object Object\])\b/i.test(text)) signals.push("placeholder");
  return signals;
}

function isUsableCleanText(raw: string, clean: string | null): boolean {
  if (!clean) return false;
  const rawLen = raw.trim().length;
  const cleanLen = clean.trim().length;
  if (cleanLen < 40) return false;
  if (rawLen >= 500 && cleanLen < 80) return false;
  if (rawLen >= 500 && cleanLen < rawLen * 0.12) return false;
  if (dirtySignals(clean).length > 0 && dirtySignals(raw).length > 0 && cleanLen > rawLen * 0.9) return false;
  return true;
}

function chooseEpisodeSource(rawDescription: string, cleanText: { text: string; method: string } | null): { text: string; label: string } | null {
  const raw = String(rawDescription || "").trim();
  if (isUsableCleanText(raw, cleanText?.text || null)) {
    return { text: cleanText!.text.trim(), label: `${cleanText!.method || "deterministic_v4"} clean text` };
  }
  return null;
}

function cleanPersonArray(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const canonical = canonicalizeHungarianPersonName(String(value || "")).name;
    if (!canonical) continue;
    const key = canonical.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(canonical);
  }
  return out.slice(0, 12);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { type, id } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const ctrl = await loadControls(supabase);
    if (!ctrl.enabled) throw new Error("AI enrichment is disabled in admin settings");
    const used = await summariesToday(supabase);
    if (used >= ctrl.maxPerDay) {
      throw new Error(`Daily AI cap reached (${used}/${ctrl.maxPerDay}). Adjust in admin settings.`);
    }

    if (type === "podcast") {
      const { data: p } = await supabase.from("podcasts").select("*").eq("id", id).single();
      if (!p) throw new Error("podcast not found");
      if (!isAcceptedHungarianPodcast(p)) {
        return new Response(JSON.stringify({ ok: true, skipped: true, reason: "not_hungarian_podcast" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const inputText = `${p.title || ""}\n${p.description || ""}`;
      const sourceHash = await sha256Hex(inputText.trim());
      if (p.ai_enrich_input_hash === sourceHash && p.summary) {
        await recordDuplicateSkip("ai_enrich_podcast_summary", "podcast", id, sourceHash, ctrl.model);
        return new Response(JSON.stringify({ ok: true, skipped: true, reason: "unchanged_ai_input" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (await hasSuccessfulAiRun(supabase, "ai_enrich_podcast_summary", "podcast", id, sourceHash)) {
        await recordDuplicateSkip("ai_enrich_podcast_summary", "podcast", id, sourceHash, ctrl.model);
        return new Response(JSON.stringify({ ok: true, skipped: true, reason: "unchanged_ai_input" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const ai = await callLovableAI({
        model: ctrl.model,
        job_type: "ai_enrich_podcast_summary",
        target_type: "podcast",
        target_id: id,
        prompt_version: PROMPT_VERSION,
        source_hash: sourceHash,
        input_text: inputText,
        min_input_chars: ctrl.minInputChars,
        messages: [
        { role: "system", content: `${HU_ONLY_SYSTEM} Írj tömör, 2 mondatos podcast-összefoglalót magyarul, max. 280 karakterben. Nincs marketing bullshit.` },
        { role: "user", content: `Podcast: ${p.title}\n\nLeírás: ${p.description || "(nincs)"}\n\nÍrj világos, semleges magyar összefoglalót.` },
        ],
      });
      if (!ai.ok) {
        return new Response(JSON.stringify({ ok: true, skipped: true, reason: ai.error || "ai_skipped" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const summary = ai.data?.choices?.[0]?.message?.content?.trim() || "";
      if (!summary) return new Response(JSON.stringify({ ok: true, skipped: true, reason: "empty_summary" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (!isHungarianish(summary)) {
        return new Response(JSON.stringify({ ok: true, skipped: true, reason: "hu_language_guard_failed" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      await updateRowWithHashFallback(supabase, "podcasts", id, {
        summary,
        ai_enriched_at: new Date().toISOString(),
        ai_enrich_input_hash: sourceHash,
        ai_enrich_prompt_version: PROMPT_VERSION,
      });
      return new Response(JSON.stringify({ ok: true, summary }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (type === "episode") {
      const { data: ep } = await supabase.from("episodes").select("*, podcasts(title,language,is_hungarian,language_decision)").eq("id", id).single();
      if (!ep) throw new Error("episode not found");
      if (!isAcceptedHungarianPodcast((ep as any).podcasts)) {
        return new Response(JSON.stringify({ ok: true, skipped: true, reason: "not_hungarian_podcast" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const cleanText = await loadEpisodeCleanText(supabase, id);
      const source = chooseEpisodeSource(String(ep.description || ""), cleanText);
      if (!source) {
        return new Response(JSON.stringify({
          ok: true,
          skipped: true,
          reason: "waiting_for_deterministic_v4_clean_text",
          guard: "clean_text_first_ai_enrich",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const sourceText = source.text;
      const sourceLabel = source.label;
      const tools = [{
        type: "function",
        function: {
          name: "enrich_episode",
          description: "Summarize episode and extract entities.",
          parameters: {
            type: "object",
            properties: {
              summary: { type: "string", description: "2 mondatos, semleges magyar összefoglaló, max. 280 karakter." },
              topics: { type: "array", items: { type: "string" } },
              people: { type: "array", items: { type: "string" } },
              companies: { type: "array", items: { type: "string" } },
              tickers: { type: "array", items: { type: "string" } },
              ingredients: { type: "array", items: { type: "string" } },
            },
            required: ["summary", "topics", "people", "companies", "tickers", "ingredients"],
            additionalProperties: false,
          },
        },
      }];
      const inputText = `${ep.title || ""}\n${sourceText}`;
      const sourceHash = await sha256Hex(inputText.trim());
      if (ep.ai_enrich_input_hash === sourceHash && ep.summary && Number(ep.ai_entities_version || 0) >= 4) {
        await recordDuplicateSkip("ai_enrich_episode", "episode", id, sourceHash, ctrl.model);
        return new Response(JSON.stringify({ ok: true, skipped: true, reason: "unchanged_ai_input" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (await hasSuccessfulAiRun(supabase, "ai_enrich_episode", "episode", id, sourceHash)) {
        await recordDuplicateSkip("ai_enrich_episode", "episode", id, sourceHash, ctrl.model);
        return new Response(JSON.stringify({ ok: true, skipped: true, reason: "unchanged_ai_input" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const ai = await callLovableAI({
        model: ctrl.model,
        job_type: "ai_enrich_episode",
        target_type: "episode",
        target_id: id,
        prompt_version: PROMPT_VERSION,
        source_hash: sourceHash,
        input_text: inputText,
        min_input_chars: ctrl.minInputChars,
        messages: [
          { role: "system", content: `${HU_ONLY_SYSTEM} Elemezd a podcast epizód metaadatait és nyerj ki strukturált entitásokat. A summary mező kötelezően magyar. Az entitásnevek maradjanak eredeti kanonikus formában. Magyar személyneveknél vedd le a ragokat: "Vigh Vandával" -> "Vigh Vanda", "Schmied Andival" -> "Schmied Andi", "Nagy Péterrel" -> "Nagy Péter".` },
          { role: "user", content: `Podcast: ${(ep as any).podcasts?.title}\nEpizód: ${ep.title}\n\n${sourceLabel}: ${sourceText || "(nincs)"}` },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "enrich_episode" } },
      });
      if (!ai.ok) {
        return new Response(JSON.stringify({ ok: true, skipped: true, reason: ai.error || "ai_skipped" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const args = ai.data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
      const parsed = args ? JSON.parse(args) : {};
      if (!isHungarianish(String(parsed.summary || ""))) {
        return new Response(JSON.stringify({ ok: true, skipped: true, reason: "hu_language_guard_failed" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      await updateRowWithHashFallback(supabase, "episodes", id, {
        summary: parsed.summary || null,
        topics: parsed.topics || [],
        people: cleanPersonArray(parsed.people),
        companies: parsed.companies || [],
        tickers: parsed.tickers || [],
        ingredients: parsed.ingredients || [],
        ai_entities_version: 4,
        ai_enriched_at: new Date().toISOString(),
        ai_summary_source: sourceLabel,
        ai_enrich_input_hash: sourceHash,
        ai_enrich_prompt_version: PROMPT_VERSION,
      });
      // Stamp last AI run
      await supabase.from("app_settings").upsert({
        key: "ai_last_run", value: { at: new Date().toISOString() }, updated_at: new Date().toISOString(),
      });
      return new Response(JSON.stringify({ ok: true, ...parsed }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    throw new Error("type must be 'podcast' or 'episode'");
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
