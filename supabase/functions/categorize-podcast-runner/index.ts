// AI categorizer for podcasts. Picks uncategorized EN podcasts (S>A>B>C),
// asks Gemini to assign one of 21 canonical category slugs (with confidence
// + alternate). Drains in a loop within one invocation, respects daily $ budget,
// auto-tunes its own cron via set_categorize_runner_schedule.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { chatTokenCostUsd } from "../_shared/ai-pricing.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// Canonical categories — slug, name, one-liner browse intent
const CATEGORIES: { slug: string; name: string; hint: string }[] = [
  { slug: "news",                     name: "News & Politics",            hint: "Daily news, politics, current affairs, geopolitics, journalism" },
  { slug: "business",                 name: "Business & Finance",         hint: "Business strategy, entrepreneurship, management, careers, sales, marketing, B2B, founder stories. NOT primarily investing/markets — that goes to 'finance'." },
  { slug: "finance",                  name: "Finance",                    hint: "Investing, stock market, crypto, macroeconomics, personal finance, real estate investing, portfolio building, ETFs. HU: tőzsde, befektetés, kripto, infláció, pénzügyi tanácsadás." },
  { slug: "technology",               name: "Technology",                 hint: "Software, AI, startups, hardware, cybersecurity, dev culture" },
  { slug: "science",                  name: "Science & Ideas",            hint: "Hard science, physics, biology, neuroscience, big-idea intellectual deep dives" },
  { slug: "health",                   name: "Health, Fitness & Longevity",hint: "Medicine, nutrition, fitness, longevity, biohacking, mental health (clinical)" },
  { slug: "psychology-relationships", name: "Psychology & Relationships", hint: "Therapy talk, mental health, attachment styles, narcissism, family dynamics, somatic — PSYCHOLOGY focus. If the show is primarily about romantic relationships/dating/marriage/sex, use 'relationships' instead." },
  { slug: "relationships",            name: "Relationships",              hint: "Dating, marriage, sex, couples therapy, divorce, romantic relationships. HU: párkapcsolat, randizás, házasság, szex, válás." },
  { slug: "self-improvement",         name: "Self-Improvement",           hint: "Productivity, motivation, mindset, habits, life coaching, success — NOT therapy/relationships." },
  { slug: "society-culture",          name: "Society & Culture",          hint: "Society, culture, lifestyle, travel, philosophy of everyday life, interviews" },
  { slug: "religion-spirituality",    name: "Religion & Spirituality",    hint: "Christianity, theology, Bible, Islam, Judaism, Buddhism, prayer, spirituality" },
  { slug: "education",                name: "Education & Explainer",      hint: "Learning, language, explainers, lectures, how-things-work, academic" },
  { slug: "history",                  name: "History",                    hint: "Historical narratives, biographies, ancient/modern history, war history" },
  { slug: "books-literature",         name: "Books & Literature",         hint: "Book reviews, author interviews, reading, literary criticism, poetry" },
  { slug: "culture",                  name: "Film, TV & Pop Culture",     hint: "Movies, TV recaps, celebrities, pop-culture commentary" },
  { slug: "arts",                     name: "Arts",                       hint: "Visual arts, design, architecture, theater, creativity, art history" },
  { slug: "music",                    name: "Music",                      hint: "Music interviews, music history, artist deep dives, music criticism" },
  { slug: "comedy",                   name: "Comedy",                     hint: "Comedy talk, stand-up, improv, comedians chatting, humor-first shows. HU: kereskedelmi rádiós reggeli show-k (Balázsék, Bochkor, Class FM Morning Show), könnyed hangvételű rádiós beszélgetések — ezek IDE tartoznak, NEM a Society & Culture vagy Film/TV alá." },
  { slug: "fiction-audio-drama",      name: "Fiction & Audio Drama",      hint: "Scripted fiction, audio drama, narrative storytelling, podcast novels. HU: rádiószínház, hangjáték, hangoskönyv-szerű narratív fikció." },
  { slug: "true-crime",               name: "True Crime & Paranormal",    hint: "True crime, mysteries, paranormal, ghost stories, conspiracy" },
  { slug: "sports",                   name: "Sports",                     hint: "Sports talk, leagues, athletes, fantasy, betting, sports business" },
  { slug: "food",                     name: "Food",                       hint: "Cooking, recipes, restaurants, food culture, drinks, coffee, wine. HU: gasztronómia, főzés, éttermek, kávé, bor." },
  { slug: "kids-family",              name: "Kids & Family",              hint: "Kids storytelling, family-friendly, parenting" },
];
const ENUM_SLUGS = CATEGORIES.map(c => c.slug);
const SLUG_TO_NAME = Object.fromEntries(CATEGORIES.map(c => [c.slug, c.name]));

const SYSTEM = `You categorize podcasts into ONE of a fixed taxonomy. You MUST pick from the provided slugs. Be decisive: if the show is even loosely a fit, classify it. Use low confidence only when the description is empty or genuinely cross-genre with no dominant lane.

HUNGARIAN CONTEXT (most podcasts are HU):
- "Reggeli show" / kereskedelmi rádiós reggeli műsor (Balázsék, Bochkor, Class FM, Music FM, Retro Rádió Reggeli) → comedy. They are entertainment/humor-first, NOT society-culture or film-tv, even when celebrities are guests.
- "Rádiószínház", "hangjáték", "hangoskönyv" narratív fikcióval → fiction-audio-drama.
- Egyházi prédikáció, igehirdetés, bibliatanulmány → religion-spirituality (még ha "Balázs Podcast"-nak hívják is).
- Munkajogi / jogi szakmai podcast → business (jog mint szakma) — kivéve ha tisztán oktató jellegű, akkor education.
- Magyar gazdasági/közéleti reggeli show (Millásreggeli, Péntek Reggel) → news (közélet a fő tartalom, nem entertainment).
- Tőzsde, befektetés, kripto, makrogazdaság, személyes pénzügyek → finance, NEM business. A "business" csak akkor, ha a fókusz a vállalkozásépítés/menedzsment/karrier (pl. founder interjúk, B2B).
- Randizás, házasság, szex, párkapcsolati tanácsok → relationships, NEM psychology-relationships. A "psychology-relationships" akkor, ha a fókusz a mentális egészség / terápia / önismeret általában (pl. nárcizmus, kötődéselméletek, családdinamika), NEM kifejezetten romantikus.
- Pszichológia, terápia → psychology-relationships, NEM self-improvement, hacsak nem produktivitás/szokások a fókusz.
- Főzés, receptek, éttermek, gasztronómia, kávé, bor → food.`;

function buildPrompt(p: any): string {
  const cats = CATEGORIES.map(c => `- ${c.slug} — ${c.name}: ${c.hint}`).join("\n");
  const desc = (p.description || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 1200);
  return `TAXONOMY:
${cats}

PODCAST:
Title: ${p.display_title || p.title}
Description: ${desc || "(none)"}

Pick the single best slug. Provide an alternate slug (second-best) and confidence 0..1.`;
}

const TOOL = {
  type: "function",
  function: {
    name: "categorize_podcast",
    description: "Assign one canonical category slug to a podcast.",
    parameters: {
      type: "object",
      properties: {
        slug: { type: "string", enum: ENUM_SLUGS, description: "Best-fit category slug." },
        alt_slug: { type: "string", enum: ENUM_SLUGS, description: "Second-best slug (different from slug)." },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        reason: { type: "string", description: "One short sentence explaining the choice." },
      },
      required: ["slug", "alt_slug", "confidence", "reason"],
      additionalProperties: false,
    },
  },
};

async function callAI(model: string, prompt: string) {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }],
      tools: [TOOL],
      tool_choice: { type: "function", function: { name: "categorize_podcast" } },
    }),
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
    const guard = await checkBackgroundJobsAllowed(admin, "categorize-podcast-runner");
    if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });

    const body = await req.json().catch(() => ({}));
    const { data: ctrlRow } = await admin.from("app_settings").select("value").eq("key", "ai_categorize_controls").maybeSingle();
    const ctrl = (ctrlRow?.value || {}) as any;
    if (ctrl.enabled === false) return json({ ok: true, paused: true });
    const dailyBudget = Number(ctrl.daily_budget_usd ?? 5);
    const batch = Math.max(1, Math.min(100, Number(body.batch ?? ctrl.batch ?? 30)));
    const concurrency = Math.max(1, Math.min(12, Number(body.concurrency ?? ctrl.concurrency ?? 6)));
    const model = String(ctrl.model || "google/gemini-2.5-flash");
    const lowConf = Number(ctrl.low_confidence_threshold ?? 0.75);
    // Recategorize mode: re-run on already-categorized podcasts (HU re-review pass).
    // recategorize=true → pick all S/A/B/C, ordered by rank, ignoring `category IS NULL`.
    // recategorizeMaxConfidence (default 1.0) → only re-run rows whose existing confidence is BELOW this.
    // recategorizeTiers (default ["S","A"]) → which tiers to re-process.
    const recategorize: boolean = body.recategorize === true;
    const reMaxConf: number = Number(body.recategorizeMaxConfidence ?? 1.0);
    const reTiers: string[] = Array.isArray(body.recategorizeTiers) && body.recategorizeTiers.length
      ? body.recategorizeTiers
      : ["S", "A"];

    // Today's spend (reuse ai_spend_daily, separate by_kind bucket)
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const dayKey = today.toISOString().slice(0, 10);
    const { data: spendRow } = await admin.from("ai_spend_daily").select("*").eq("day", dayKey).maybeSingle();
    let spend = Number(spendRow?.spend_usd || 0);
    let calls = Number(spendRow?.calls || 0);
    if (spend >= dailyBudget) return json({ ok: true, budget_reached: true, spend });

    let processed = 0, succeeded = 0, failed = 0, rate_limited = 0, low_conf_count = 0;
    let stop = false;
    let total_claimed = 0, drain_loops = 0;

    const tierOrder = ["S", "A", "B", "C"];

    const runOne = async (p: any) => {
      if (stop) return;
      if (Date.now() - startedAt > TIME_BUDGET_MS - TAIL_RESERVE_MS) { stop = true; return; }
      if (spend >= dailyBudget) { stop = true; return; }
      processed++;
      try {
        const ai = await callAI(model, buildPrompt(p));
        const usage = ai.usage || {};
        const inTok = Number(usage.prompt_tokens || 0);
        const outTok = Number(usage.completion_tokens || 0);
        const cost = chatTokenCostUsd(model, inTok, outTok);
        const args = ai.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
        if (!args) throw new Error("no_tool_call");
        const parsed = JSON.parse(args);
        const slug = String(parsed.slug || "");
        const altSlug = String(parsed.alt_slug || "");
        const confidence = Math.max(0, Math.min(1, Number(parsed.confidence || 0)));
        const name = SLUG_TO_NAME[slug];
        if (!name) throw new Error(`unknown_slug:${slug}`);
        const needsReview = confidence < lowConf;
        if (needsReview) low_conf_count++;
        await admin.from("podcasts").update({
          category: name,
          ai_category_confidence: confidence,
          ai_category_alt: SLUG_TO_NAME[altSlug] || null,
          ai_category_at: new Date().toISOString(),
          ai_category_model: model,
          ai_category_needs_review: needsReview,
        }).eq("id", p.id);
        succeeded++;
        spend += cost; calls++;
      } catch (err: any) {
        failed++;
        const msg = err?.message || "error";
        if (msg === "rate_limited" || msg === "budget_exhausted_provider") { rate_limited++; stop = true; }
        // Mark as needs_review with error so it doesn't get re-picked indefinitely on permanent failures
        // (simple guard: write a 0-confidence stub only on hard schema failures, not transient ones)
        if (msg.startsWith("unknown_slug") || msg === "no_tool_call") {
          await admin.from("podcasts").update({
            ai_category_at: new Date().toISOString(),
            ai_category_model: model,
            ai_category_needs_review: true,
            ai_category_confidence: 0,
          }).eq("id", p.id);
        }
      }
    };

    // Drain loop: claim S then A then B then C in priority order until time/budget runs out
    let totalRemaining = 0;
    while (!stop) {
      if (Date.now() - startedAt > TIME_BUDGET_MS - TAIL_RESERVE_MS) break;
      if (spend >= dailyBudget) break;

      // pick next batch: order by tier priority, then podiverzum_rank desc
      let candidates: any[] = [];
      const seenIds = new Set<string>();
      const tiersToUse = recategorize ? reTiers : tierOrder;
      for (const tier of tiersToUse) {
        const need = batch - candidates.length;
        if (need <= 0) break;
        let q = admin
          .from("podcasts")
          .select("id, title, display_title, description, shadow_rank_tier, ai_category_confidence")
          .eq("shadow_rank_tier", tier)
          .eq("is_hungarian", true)
          .order("podiverzum_rank", { ascending: false, nullsFirst: false })
          .limit(need * 3); // overfetch — we filter+dedupe below
        if (recategorize) {
          // Pull rows whose existing confidence is < reMaxConf (or never categorized)
          q = q.or(`ai_category_confidence.is.null,ai_category_confidence.lt.${reMaxConf}`);
        } else {
          q = q.is("category", null);
        }
        const { data } = await q;
        if (data && data.length) {
          for (const row of data) {
            if (candidates.length >= batch) break;
            if (seenIds.has(row.id)) continue;
            seenIds.add(row.id);
            candidates.push(row);
          }
        }
      }
      if (!candidates.length) break;
      total_claimed += candidates.length;
      drain_loops++;

      let i = 0;
      const workers = Array.from({ length: concurrency }, async () => {
        while (true) {
          const idx = i++;
          if (idx >= candidates.length || stop) return;
          await runOne(candidates[idx]);
        }
      });
      await Promise.all(workers);
    }

    // Persist daily spend
    await admin.from("ai_spend_daily").upsert({
      day: dayKey, spend_usd: spend, calls,
      by_kind: { ...(spendRow?.by_kind || {}), categorize: ((spendRow?.by_kind as any)?.categorize || 0) + (succeeded) },
      updated_at: new Date().toISOString(),
    });

    // Auto-pause on budget reached
    if (spend >= dailyBudget) {
      await admin.from("app_settings").upsert({
        key: "ai_categorize_controls",
        value: { ...ctrl, enabled: false, auto_paused_reason: "daily_budget_reached", auto_paused_at: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      });
    }

    // Adaptive cron tuning — only when running the normal "fill-in NULL" pass.
    // Recategorize runs are one-off admin triggers; they should not retune the schedule.
    let next_schedule: string | null = null;
    if (!recategorize) try {
      const { count: remaining } = await admin
        .from("podcasts")
        .select("id", { count: "exact", head: true })
        .is("category", null)
        .in("shadow_rank_tier", ["S","A","B","C"])
        .or("is_hungarian.eq.true");
      totalRemaining = Number(remaining || 0);
      // Stepped backoff (2026-05-12): rate_limit no longer crashes cadence to */30 —
      // we slow down ONE notch instead, so a transient 429 doesn't kill throughput
      // when there are still thousands waiting.
      if (rate_limited > 0) {
        if (totalRemaining > 1000)      next_schedule = "*/2 * * * *";
        else if (totalRemaining > 200)  next_schedule = "*/5 * * * *";
        else if (totalRemaining > 20)   next_schedule = "*/10 * * * *";
        else if (totalRemaining > 0)    next_schedule = "*/30 * * * *";
        else                            next_schedule = "0 * * * *";
      } else if (totalRemaining > 1000) next_schedule = "* * * * *";
      else if (totalRemaining > 200)  next_schedule = "*/2 * * * *";
      else if (totalRemaining > 20)   next_schedule = "*/10 * * * *";
      else if (totalRemaining > 0)    next_schedule = "*/30 * * * *";
      else                            next_schedule = "0 * * * *";
      try { await admin.rpc("set_categorize_runner_schedule" as any, { _schedule: next_schedule }); } catch { /* ignore */ }
    } catch { /* ignore */ }

    return json({
      ok: true, claimed: total_claimed, drain_loops, processed, succeeded, failed,
      rate_limited, low_conf_count, concurrency, batch, spend_usd: spend,
      remaining: totalRemaining, next_schedule, elapsed_ms: Date.now() - startedAt,
    });
  } catch (e: any) {
    return json({ error: e?.message || "error" }, 500);
  }
});
