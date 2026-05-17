// Generates AI bios + featured episodes for star persons in HU podcasts.
// Aggregates `episodes.people` across HU shows; if a person appears in >= min_episodes,
// upserts an `entity_profiles` row with `kind='person'`, `display_name`, `slug`, `bio`,
// `episode_ids`, `featured_episode_ids`. Respects daily budget via app_settings.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const PRICE_IN_PER_1K = 0.000075;
const PRICE_OUT_PER_1K = 0.0003;

const BIO_TOOL = {
  type: "function",
  function: {
    name: "person_bio",
    description: "Write a neutral, factual Hungarian-language bio for a person based ONLY on the episode titles + summaries provided.",
    parameters: {
      type: "object",
      properties: {
        display_name: { type: "string", description: "The canonical full name (proper capitalization, original-language form)." },
        bio: { type: "string", description: "80-160 word neutral bio in Hungarian. Who is this person? What field? What topics do they typically discuss in podcasts? Use ONLY information that can be inferred from the supplied episode titles/summaries. If unknown, keep it short and factual. No marketing fluff. No invented credentials." },
        topic_summary: { type: "string", description: "One short sentence (<=120 chars) summarising what topics they tend to be associated with across the provided episodes." },
      },
      required: ["display_name", "bio", "topic_summary"],
      additionalProperties: false,
    },
  },
};

const SYSTEM = "You write neutral, factual Hungarian-language person bios for a podcast directory. You ONLY use the supplied episode metadata. You never invent credentials, biographical facts, dates, or affiliations. If the input is sparse, keep the bio short and conservative.";

function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function callAI(model: string, messages: any[]) {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, tools: [BIO_TOOL], tool_choice: { type: "function", function: { name: "person_bio" } } }),
  });
  if (res.status === 429) throw new Error("rate_limited");
  if (res.status === 402) throw new Error("budget_exhausted_provider");
  if (!res.ok) throw new Error(`ai_${res.status}`);
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();
  const TIME_BUDGET_MS = 110_000;
  const TAIL_RESERVE_MS = 5_000;

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const guard = await checkBackgroundJobsAllowed(admin, "entity-profile-runner");
    if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });

    const { data: ctrlRow } = await admin.from("app_settings").select("value").eq("key", "entity_profile_controls").maybeSingle();
    const ctrl = (ctrlRow?.value || {}) as any;
    if (ctrl.enabled === false) return json({ ok: true, paused: true });
    const dailyBudget = Number(ctrl.daily_budget_usd ?? 3);
    const model = String(ctrl.model || "google/gemini-3.1-flash-lite-preview");
    const minEpisodes = Math.max(2, Number(ctrl.min_episodes ?? 8));
    const maxPerRun = Math.max(1, Math.min(50, Number(ctrl.max_per_run ?? 15)));
    const refreshDays = Math.max(1, Number(ctrl.refresh_days ?? 30));

    // Today's spend
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const dayKey = today.toISOString().slice(0, 10);
    const { data: spendRow } = await admin.from("ai_spend_daily").select("*").eq("day", dayKey).maybeSingle();
    const byKind = (spendRow?.by_kind || {}) as any;
    let mySpend = Number(byKind.entity_profile || 0);
    let totalSpend = Number(spendRow?.spend_usd || 0);
    let calls = Number(spendRow?.calls || 0);
    if (mySpend >= dailyBudget) return json({ ok: true, budget_reached: true, spend: mySpend });

    // Aggregate person counts from HU episodes (last 2 years) via SQL.
    const counts = new Map<string, { display: string; episode_ids: string[]; podcasts: Set<string>; latestPublishedAt: number }>();
    let from = 0;
    const PAGE = 1000;
    const twoYearsAgo = new Date(Date.now() - 730 * 86400_000).toISOString();
    while (true) {
      if (Date.now() - startedAt > 30_000) break; // cap aggregation to 30s
      const { data: page, error } = await admin
        .from("episodes")
        .select("id, people, podcast_id, published_at, podcasts!inner(language)")
        .not("people", "is", null)
        .gte("published_at", twoYearsAgo)
        .eq("podcasts.is_hungarian", true)
        .order("published_at", { ascending: false, nullsFirst: false })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      const rows = (page || []) as any[];
      if (!rows.length) break;
      for (const ep of rows) {
        const arr: string[] = Array.isArray(ep.people) ? ep.people : [];
        if (!arr.length) continue;
        const t = ep.published_at ? new Date(ep.published_at).getTime() : 0;
        for (const raw of arr) {
          const v = String(raw || "").trim();
          if (!v || v.length < 3) continue;
          const slug = slugify(v);
          if (!slug) continue;
          const cur = counts.get(slug);
          if (cur) {
            if (!cur.episode_ids.includes(ep.id)) cur.episode_ids.push(ep.id);
            cur.podcasts.add(ep.podcast_id);
            if (t > cur.latestPublishedAt) cur.latestPublishedAt = t;
            // Prefer the longest seen variant as display
            if (v.length > cur.display.length) cur.display = v;
          } else {
            counts.set(slug, { display: v, episode_ids: [ep.id], podcasts: new Set([ep.podcast_id]), latestPublishedAt: t });
          }
        }
      }
      if (rows.length < PAGE) break;
      from += PAGE;
      if (from > 50000) break; // hard cap
    }

    // Candidates: appears in >= minEpisodes episodes AND across at least 1 distinct podcast.
    const allCandidates = Array.from(counts.entries())
      .filter(([_, v]) => v.episode_ids.length >= minEpisodes)
      .map(([slug, v]) => ({
        slug,
        display_name: v.display,
        episode_ids: v.episode_ids,
        podcast_count: v.podcasts.size,
        latest: v.latestPublishedAt,
      }))
      .sort((a, b) => b.episode_ids.length - a.episode_ids.length);

    // Filter out ones we've recently generated.
    const slugs = allCandidates.map((c) => c.slug);
    let recent = new Set<string>();
    if (slugs.length) {
      const cutoff = new Date(Date.now() - refreshDays * 86400_000).toISOString();
      const { data: existing } = await admin
        .from("entity_profiles")
        .select("slug, updated_at")
        .eq("kind", "person")
        .in("slug", slugs);
      for (const r of (existing || []) as any[]) {
        if (r.updated_at && r.updated_at > cutoff) recent.add(r.slug);
      }
    }
    const candidates = allCandidates.filter((c) => !recent.has(c.slug)).slice(0, maxPerRun);

    let processed = 0, succeeded = 0, failed = 0, rate_limited = 0;
    let stop = false;

    for (const cand of candidates) {
      if (stop) break;
      if (Date.now() - startedAt > TIME_BUDGET_MS - TAIL_RESERVE_MS) break;
      if (mySpend >= dailyBudget) { stop = true; break; }
      processed++;
      try {
        // Pull top 12 most recent episodes for this person to feed the AI.
        const epIds = cand.episode_ids.slice(0, 60); // we'll re-select with metadata
        const { data: eps } = await admin
          .from("episodes")
          .select("id, display_title, title, ai_summary, summary, published_at, podcast_id, podcasts!inner(display_title, title)")
          .in("id", epIds)
          .order("published_at", { ascending: false, nullsFirst: false })
          .limit(12);
        const epList = (eps || []) as any[];
        if (!epList.length) { failed++; continue; }

        const sample = epList.slice(0, 8).map((e, i) => {
          const podName = e.podcasts?.display_title || e.podcasts?.title || "?";
          const t = e.display_title || e.title || "";
          const sum = (e.ai_summary || e.summary || "").replace(/\s+/g, " ").trim().slice(0, 220);
          return `${i + 1}. [${podName}] ${t}${sum ? ` — ${sum}` : ""}`;
        }).join("\n");

        const userPrompt =
          `Person name: ${cand.display_name}\n` +
          `Appears in ${cand.episode_ids.length} HU podcast episode(s) across ${cand.podcast_count} show(s) in the last 2 years.\n\n` +
          `Recent episodes:\n${sample}\n\n` +
          `Write a Hungarian person profile. Use ONLY what these titles/summaries reveal.`;

        const ai = await callAI(model, [
          { role: "system", content: SYSTEM },
          { role: "user", content: userPrompt },
        ]);
        const usage = ai.usage || {};
        const inTok = Number(usage.prompt_tokens || 0);
        const outTok = Number(usage.completion_tokens || 0);
        const cost = (inTok / 1000) * PRICE_IN_PER_1K + (outTok / 1000) * PRICE_OUT_PER_1K;
        const args = ai.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
        const parsed = args ? JSON.parse(args) : null;
        if (!parsed) throw new Error("no_tool_call");

        const display_name = String(parsed.display_name || cand.display_name).trim().slice(0, 120);
        const bio = String(parsed.bio || "").replace(/\s+/g, " ").trim().slice(0, 1400);
        const topic_summary = String(parsed.topic_summary || "").replace(/\s+/g, " ").trim().slice(0, 200);

        const featured_episode_ids = epList.slice(0, 5).map((e) => e.id);

        await admin.from("entity_profiles").upsert({
          kind: "person",
          slug: cand.slug,
          display_name,
          bio,
          episodes_summary: topic_summary,
          episode_ids: cand.episode_ids,
          featured_episode_ids,
          appearance_stats: { episodes: cand.episode_ids.length, podcasts: cand.podcast_count },
          model,
          cost_usd: cost,
          generated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "slug" });

        succeeded++;
        mySpend += cost; totalSpend += cost; calls++;
      } catch (err: any) {
        failed++;
        const msg = err?.message || "error";
        if (msg === "rate_limited" || msg === "budget_exhausted_provider") { rate_limited++; stop = true; }
      }
    }

    await admin.from("ai_spend_daily").upsert({
      day: dayKey,
      spend_usd: totalSpend,
      calls,
      by_kind: { ...byKind, entity_profile: mySpend },
      updated_at: new Date().toISOString(),
    });

    if (mySpend >= dailyBudget) {
      const newCtrl = { ...ctrl, enabled: false, auto_paused_reason: "daily_budget_reached", auto_paused_at: new Date().toISOString() };
      await admin.from("app_settings").upsert({ key: "entity_profile_controls", value: newCtrl, updated_at: new Date().toISOString() });
    }

    return json({
      ok: true,
      total_candidates: allCandidates.length,
      eligible_after_recent_filter: candidates.length,
      processed, succeeded, failed, rate_limited,
      spend_usd: mySpend,
      elapsed_ms: Date.now() - startedAt,
    });
  } catch (e: any) {
    return json({ error: e?.message || "error" }, 500);
  }
});
