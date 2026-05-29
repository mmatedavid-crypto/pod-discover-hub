// Backfills entities (people/companies/tickers/topics) on episodes that already
// have ai_summary but ai_entities_version = 0. Cheap, focused, separate from SEO.
//
// Drain-loop pattern: claim a batch directly from `episodes`, process with
// concurrency, repeat until time/budget runs out or no rows remain.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { filterHosts } from "../_shared/seo-prompt.ts";
import {
  callGeminiOpenAI,
  assertModelAllowed,
  validateAiInput,
  auditSkip,
  checkBudget,
} from "../_shared/google-gemini-direct.ts";

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
      "Extract structured entities from a podcast episode based ONLY on title + description. Do NOT invent entities.\n\n" +
      "PEOPLE vs MENTIONED: people who SPEAK (`people`: guests, interviewees) vs people TALKED ABOUT but absent (`mentioned`). Politicians like Orbán Viktor or Magyar Péter default to `mentioned` UNLESS metadata clearly marks them as guest/speaker. NEVER include show hosts.\n\n" +
      "ORGANIZATIONS: extract ALL named organizations and classify each with a precise `type`:\n" +
      "- company: for-profit business (MOL, OTP, Apple, OpenAI, Tesla)\n" +
      "- party: political party (Fidesz, Tisza Párt, DK, Momentum)\n" +
      "- institution: government body, ministry, agency, court (MNB, NAV, Kúria, Magyar Honvédség, NASA)\n" +
      "- media: newspaper, TV channel, news site (HVG, Telex, ATV, Partizán, CNN)\n" +
      "- ngo: non-profit, foundation (Greenpeace, Amnesty)\n" +
      "- sport_team: club or national team (Ferencváros, Lakers, Real Madrid)\n" +
      "- sport_league: league, federation, competition (NBA, Premier League, MLSZ, FIFA)\n" +
      "- church: religious organization (Magyarországi Református Egyház, Vatikán)\n" +
      "- university: higher-ed institution (ELTE, BME, Harvard, CEU)\n" +
      "- research: research institute, think tank (MTA, RAND)\n" +
      "- radio_station: radio broadcaster (Klubrádió, Spirit FM, Tilos Rádió)\n" +
      "- other: only if none fits\n" +
      "Do NOT include podcast names, podcast networks, hosting/distribution platforms or social networks mentioned only as 'follow us / subscribe' footers — Spotify, Apple Podcasts, Apple Music, YouTube, YouTube Music, Facebook, Instagram, TikTok, X, Twitter, Threads, LinkedIn, Telegram, Discord, WhatsApp, Patreon, SoundCloud, Anchor, Buzzsprout — unless they are a substantive topic of discussion in the episode. Also exclude sponsors only mentioned in credits.",
    parameters: {
      type: "object",
      properties: {
        people: { type: "array", items: { type: "string" }, description: "Up to 6 speakers (guests/interviewees). NOT hosts. Original-language full names." },
        mentioned: { type: "array", items: { type: "string" }, description: "Up to 6 people talked about but absent. Politicians default here." },
        organizations: {
          type: "array",
          description: "Up to 10 typed organizations.",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Canonical original-language name (e.g. 'Tisza Párt', 'Ferencváros', 'OTP Bank')." },
              type: { type: "string", enum: [...ORG_TYPES] as any, description: "Precise type from enum." },
            },
            required: ["name", "type"],
            additionalProperties: false,
          },
        },
        tickers: { type: "array", items: { type: "string" }, description: "Up to 6 stock tickers (uppercase like AAPL, OTP)." },
        topics: { type: "array", items: { type: "string" }, description: "Up to 6 short topic tags (1-3 words, lowercase, source language)." },
      },
      required: ["people", "mentioned", "organizations", "tickers", "topics"],
      additionalProperties: false,
    },
  },
};

const SYSTEM = "You extract structured entities from podcast episode metadata. You ONLY include entities literally present in the input. Distinguish `people` (speakers) from `mentioned` (absent). Classify every organization with a precise `type`. Never include show hosts. Never include podcast/network/platform names. If unsure, return empty arrays. No invention.";


const cleanArr = (a: any, max = 6): string[] => {
  if (!Array.isArray(a)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of a) {
    const s = String(v || "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); out.push(s);
    if (out.length >= max) break;
  }
  return out;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();
  const TIME_BUDGET_MS = 110_000;
  const TAIL_RESERVE_MS = 5_000;

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const guard = await checkBackgroundJobsAllowed(admin, "entity-backfill-runner");
    if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });

    const body = await req.json().catch(() => ({}));
    const batch = Math.max(1, Math.min(600, Number(body.batch) || 400));
    const concurrency = Math.max(1, Math.min(48, Number(body.concurrency) || 40));

    // Controls (separate budget from main SEO runner)
    const { data: ctrlRow } = await admin.from("app_settings").select("value").eq("key", "entity_backfill_controls").maybeSingle();
    const ctrl = (ctrlRow?.value || {}) as any;
    if (ctrl.enabled === false) return json({ ok: true, paused: true });
    const dailyBudget = Number(ctrl.daily_budget_usd ?? 5);
    const model = String(ctrl.model || "google/gemini-2.5-flash-lite");
    assertModelAllowed(model);

    // Global budget guard (reads app_settings.ai_budget + ai_spend_daily)
    const budgetCheck = await checkBudget("entity_backfill");
    if (!budgetCheck.allowed) {
      return json({ ok: true, budget_blocked: true, reason: budgetCheck.reason, spend_today_usd: budgetCheck.spend_today_usd });
    }

    // Today's spend (shared ai_spend_daily; per-key merged atomically via merge_ai_spend RPC)
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const dayKey = today.toISOString().slice(0, 10);
    const { data: spendRow } = await admin.from("ai_spend_daily").select("by_kind").eq("day", dayKey).maybeSingle();
    const byKind = (spendRow?.by_kind || {}) as any;
    let mySpend = Number(byKind.entity_backfill || 0);
    let runIncrement = 0;
    let runCalls = 0;
    if (mySpend >= dailyBudget) return json({ ok: true, budget_reached: true, spend: mySpend });


    let processed = 0, succeeded = 0, failed = 0, rate_limited = 0;
    let stop = false;
    let total_seen = 0;
    let drain_loops = 0;

    const runOne = async (ep: any) => {
      if (stop) return;
      if (Date.now() - startedAt > TIME_BUDGET_MS - TAIL_RESERVE_MS) { stop = true; return; }
      if (mySpend >= dailyBudget) { stop = true; return; }
      processed++;
      try {
        // Prefer cleaned text (footer/social/platform chrome stripped) over raw description.
        // Avoids garbage entities like "Facebook"/"Instagram"/"Spotify" from "Kövess minket..." footers.
        const cleanedText = ep.episode_clean_text?.[0]?.cleaned_text || null;
        const desc = String(cleanedText || ep.ai_summary || ep.description || "").replace(/\s+/g, " ").trim().slice(0, 2500);
        const podName = ep.podcasts?.display_title || ep.podcasts?.title || "";
        const podHosts: string[] = Array.isArray(ep.podcasts?.hosts) ? ep.podcasts.hosts : [];

        // Input validation gate — skip + audit instead of calling Gemini.
        const skipReason = validateAiInput(desc, { minChars: 60 });
        if (skipReason) {
          await auditSkip({
            job_type: "entity_backfill", reason: skipReason, model,
            target_type: "episode", target_id: ep.id,
          });
          // Mark as v4 so we don't keep retrying garbage descriptions.
          await admin.from("episodes").update({ ai_entities_version: 4 }).eq("id", ep.id);
          succeeded++;
          return;
        }

        const hostLine = podHosts.length
          ? `Show hosts (DO NOT include any of these names in 'people' or 'mentioned'): ${podHosts.join(", ")}\n`
          : "";
        const userPrompt = `${hostLine}Show: ${podName}\nEpisode: ${ep.display_title || ep.title}\nDescription: ${desc || "(none)"}\n\nExtract entities. people = speakers only; mentioned = talked-about but absent. organizations = ALL named orgs with precise type.`;
        const aiRes = await callGeminiOpenAI({
          model,
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: userPrompt },
          ],
          tools: [ENTITY_TOOL],
          tool_choice: { type: "function", function: { name: "extract_entities" } },
          job_type: "entity_backfill",
          target_type: "episode",
          target_id: ep.id,
          preferTier1: true,
        });
        if (!aiRes.ok) {
          if (aiRes.status === 429) { rate_limited++; await new Promise(r => setTimeout(r, 1500 + Math.random()*1500)); }
          throw new Error(aiRes.error || `ai_${aiRes.status}`);
        }
        const cost = aiRes.cost_usd ?? 0;
        const args = aiRes.data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
        const parsed = args ? JSON.parse(args) : null;
        if (!parsed) throw new Error("no_tool_call");

        const people = filterHosts(cleanArr(parsed.people), podHosts);
        const mentioned = filterHosts(cleanArr(parsed.mentioned), podHosts);

        // Typed organizations (new in v3). Normalize + dedupe by lowercase name.
        const rawOrgs = Array.isArray(parsed.organizations) ? parsed.organizations : [];
        const seenOrg = new Set<string>();
        const organizations: { name: string; type: string }[] = [];
        for (const o of rawOrgs) {
          const name = String(o?.name || "").replace(/\s+/g, " ").trim().slice(0, 120);
          if (!name) continue;
          const k = name.toLowerCase();
          if (seenOrg.has(k)) continue;
          const type = ORG_TYPES.includes(o?.type) ? o.type : "other";
          seenOrg.add(k);
          organizations.push({ name, type });
          if (organizations.length >= 10) break;
        }
        // Backwards-compat: keep legacy flat `companies` array populated from org names.
        const companies = organizations.map((o) => o.name).slice(0, 6);

        const tickers = cleanArr(parsed.tickers).map((t) => t.replace(/[^a-zA-Z0-9.]+/g, "").toUpperCase()).filter(Boolean);
        const topics = cleanArr(parsed.topics).map((t) => t.toLowerCase());

        await admin.from("episodes").update({
          people, mentioned, companies, organizations, tickers, topics,
          ai_entities_version: 3,
        }).eq("id", ep.id);

        succeeded++;
        mySpend += cost; runIncrement += cost; runCalls++;
      } catch (err: any) {
        failed++;
        const msg = err?.message || "error";
        if (msg === "budget_exhausted_provider") { stop = true; }
        // rate_limited handled with backoff above; just retry-on-next-run.
        // Mark unchanged so it gets retried on next run.
      }
    };


    while (!stop) {
      if (Date.now() - startedAt > TIME_BUDGET_MS - TAIL_RESERVE_MS) break;
      if (mySpend >= dailyBudget) break;

      const { data: rows, error } = await admin
        .from("episodes")
        .select("id, title, display_title, description, ai_summary, podcast_id, podcasts!inner(title, display_title, language, hosts), episode_clean_text(cleaned_text)")
        .not("ai_summary", "is", null)
        .lt("ai_entities_version", 3)
        .eq("podcasts.is_hungarian", true)
        .limit(batch);
      if (error) throw error;
      const list = (rows || []) as any[];
      if (!list.length) break;
      total_seen += list.length;
      drain_loops++;

      let i = 0;
      const workers = Array.from({ length: concurrency }, async () => {
        while (true) {
          const idx = i++;
          if (idx >= list.length || stop) return;
          if (Date.now() - startedAt > TIME_BUDGET_MS - TAIL_RESERVE_MS) { stop = true; return; }
          await runOne(list[idx]);
        }
      });
      await Promise.all(workers);
    }

    // Atomic per-key merge — does NOT clobber other runners' by_kind entries.
    if (runIncrement > 0) {
      await admin.rpc("merge_ai_spend", {
        p_day: dayKey,
        p_delta: { entity_backfill: runIncrement } as any,
        p_total_amount: runIncrement,
        p_calls: runCalls,
      } as any);
    }

    if (mySpend >= dailyBudget) {
      const newCtrl = { ...ctrl, enabled: false, auto_paused_reason: "daily_budget_reached", auto_paused_at: new Date().toISOString() };
      await admin.from("app_settings").upsert({ key: "entity_backfill_controls", value: newCtrl, updated_at: new Date().toISOString() });
    }

    return json({ ok: true, drain_loops, total_seen, processed, succeeded, failed, rate_limited, spend_usd: mySpend, run_increment_usd: runIncrement, elapsed_ms: Date.now() - startedAt });
  } catch (e: any) {
    return json({ error: e?.message || "error" }, 500);
  }
});
