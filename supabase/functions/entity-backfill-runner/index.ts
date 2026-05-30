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
      "Do NOT include podcast names, podcast networks, hosting platforms (Spotify, Apple Podcasts), or sponsors only mentioned in credits.",
    parameters: {
      type: "object",
      properties: {
        people: { type: "array", items: { type: "string" }, description: "Up to 6 speakers (guests/interviewees). NOT hosts. Original-language full names." },
        mentioned: { type: "array", items: { type: "string" }, description: "Up to 6 people talked about but absent. Politicians default here." },
        person_mentions: {
          type: "array",
          description: "Evidence-backed people. Prefer this over legacy people/mentioned arrays.",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Original-language full person name, literally present in the input." },
              role: { type: "string", enum: ["speaker", "subject", "mentioned"], description: "speaker only when metadata says the person appears/speaks." },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              evidence: { type: "string", description: "Short exact phrase from title/description containing or directly supporting the name." },
            },
            required: ["name", "role", "confidence", "evidence"],
            additionalProperties: false,
          },
        },
        organizations: {
          type: "array",
          description: "Up to 10 typed organizations.",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Canonical original-language name (e.g. 'Tisza Párt', 'Ferencváros', 'OTP Bank')." },
              type: { type: "string", enum: [...ORG_TYPES] as any, description: "Precise type from enum." },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              evidence: { type: "string", description: "Short exact phrase from title/description containing or directly supporting the organization." },
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

const SYSTEM = "You extract structured entities from podcast episode metadata. You ONLY include entities literally present in the input. Every person/organization should have an evidence phrase from the input. Distinguish speakers from people merely discussed. Classify every organization with a precise `type`. Never include show hosts. Never include podcast/network/platform names, social platforms, podcast apps, footer links or sponsors only mentioned in credits. If unsure, return empty arrays. No invention.";


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

const PLATFORM_OR_FOOTER_ORGS = new Set([
  "apple", "apple podcast", "apple podcasts", "spotify", "youtube", "google podcasts",
  "facebook", "instagram", "tiktok", "twitter", "x", "linkedin", "patreon", "paypal",
  "gmail", "mailchimp", "rss", "podbean", "anchor", "substack",
]);

const SHORT_ORG_ALLOWLIST = new Set([
  "dk", "lmp", "mnb", "nav", "mta", "bme", "elte", "ceu", "eu", "nato", "ensz",
  "who", "nasa", "fifa", "mlsz", "otp", "mol", "mav", "máv", "rtl", "atv", "hvg",
]);

function normalizeForMatch(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesLiteral(haystack: string, needle: string): boolean {
  const h = ` ${normalizeForMatch(haystack)} `;
  const n = normalizeForMatch(needle);
  return !!n && h.includes(` ${n} `);
}

function evidenceSnippet(text: string, name: string, provided?: string): string | null {
  const cleanProvided = String(provided || "").replace(/\s+/g, " ").trim().slice(0, 260);
  if (cleanProvided && (includesLiteral(cleanProvided, name) || includesLiteral(text, cleanProvided))) {
    return cleanProvided;
  }
  const normText = normalizeForMatch(text);
  const normName = normalizeForMatch(name);
  const idx = normText.indexOf(normName);
  if (idx < 0) return null;
  const raw = text.replace(/\s+/g, " ").trim();
  const approx = Math.max(0, Math.min(raw.length - 1, idx));
  return raw.slice(Math.max(0, approx - 90), Math.min(raw.length, approx + name.length + 140)).trim();
}

function isLikelyFullName(name: string): boolean {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return false;
  if (parts.some((p) => p.length < 2)) return false;
  if (parts.some((p) => /^[a-záéíóöőúüű]+$/.test(p))) return false;
  return true;
}

function isFooterContext(evidence: string): boolean {
  return /\b(kövess|follow|iratkozz|subscribe|hallgass|listen|megtalálsz|link|facebook|instagram|spotify|apple podcasts?|youtube|tiktok)\b/i.test(evidence);
}

function shouldKeepOrganization(name: string, type: string, evidence: string | null, text: string): boolean {
  const norm = normalizeForMatch(name);
  if (!norm || !evidence) return false;
  if (!includesLiteral(text, name)) return false;
  if (PLATFORM_OR_FOOTER_ORGS.has(norm) && isFooterContext(evidence)) return false;
  const compact = norm.replace(/\s+/g, "");
  if (compact.length <= 2 && !SHORT_ORG_ALLOWLIST.has(compact)) return false;
  if (compact.length <= 3 && type === "other" && !SHORT_ORG_ALLOWLIST.has(compact)) return false;
  return true;
}

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
        const cleanedText = ep.cleaned_text || null;
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
          // Mark as v5 so we don't keep retrying garbage descriptions.
          await admin.from("episodes").update({
            ai_entities_version: 5,
            entity_extraction_evidence: {
              version: 5,
              skipped: true,
              skip_reason: skipReason,
              source: "entity_backfill",
              extracted_at: new Date().toISOString(),
            },
          }).eq("id", ep.id);
          succeeded++;
          return;
        }

        const hostLine = podHosts.length
          ? `Show hosts (DO NOT include any of these names in 'people' or 'mentioned'): ${podHosts.join(", ")}\n`
          : "";
        const userPrompt = `${hostLine}Show: ${podName}\nEpisode: ${ep.display_title || ep.title}\nDescription: ${desc || "(none)"}\n\nExtract only evidence-backed entities. people/person_mentions speaker = speakers only; mentioned = talked-about but absent. organizations = named orgs with precise type and evidence. Ignore footer/social/listen links.`;
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

        const sourceText = `${ep.display_title || ep.title || ""}\n${desc}`;
        const hostNorms = new Set(podHosts.map(normalizeForMatch));
        const personEvidence: { name: string; role: string; confidence: number; evidence: string; source: string }[] = [];
        const rawPersonMentions = Array.isArray(parsed.person_mentions) ? parsed.person_mentions : [];
        if (rawPersonMentions.length) {
          for (const item of rawPersonMentions) {
            const name = String(item?.name || "").replace(/\s+/g, " ").trim().slice(0, 100);
            if (!name || !isLikelyFullName(name)) continue;
            if (hostNorms.has(normalizeForMatch(name))) continue;
            if (!includesLiteral(sourceText, name)) continue;
            const evidence = evidenceSnippet(sourceText, name, item?.evidence);
            if (!evidence) continue;
            const role = ["speaker", "subject", "mentioned"].includes(String(item?.role)) ? String(item.role) : "mentioned";
            personEvidence.push({
              name,
              role,
              confidence: Math.max(0, Math.min(1, Number(item?.confidence || (role === "speaker" ? 0.82 : 0.7)))),
              evidence,
              source: "entity_backfill_v5",
            });
          }
        } else {
          for (const name of filterHosts(cleanArr(parsed.people), podHosts)) {
            if (!isLikelyFullName(name) || !includesLiteral(sourceText, name)) continue;
            const evidence = evidenceSnippet(sourceText, name);
            if (evidence) personEvidence.push({ name, role: "speaker", confidence: 0.8, evidence, source: "entity_backfill_v4_fallback" });
          }
          for (const name of filterHosts(cleanArr(parsed.mentioned), podHosts)) {
            if (!isLikelyFullName(name) || !includesLiteral(sourceText, name)) continue;
            const evidence = evidenceSnippet(sourceText, name);
            if (evidence) personEvidence.push({ name, role: "mentioned", confidence: 0.68, evidence, source: "entity_backfill_v4_fallback" });
          }
        }

        const seenPerson = new Set<string>();
        const dedupedPeopleEvidence = personEvidence.filter((p) => {
          const key = `${normalizeForMatch(p.name)}:${p.role}`;
          if (seenPerson.has(key)) return false;
          seenPerson.add(key);
          return true;
        }).slice(0, 12);

        const people = dedupedPeopleEvidence.filter((p) => p.role === "speaker").map((p) => p.name).slice(0, 6);
        const mentioned = dedupedPeopleEvidence.filter((p) => p.role !== "speaker").map((p) => p.name).slice(0, 6);

        // Typed organizations (new in v3). Normalize + dedupe by lowercase name.
        const rawOrgs = Array.isArray(parsed.organizations) ? parsed.organizations : [];
        const seenOrg = new Set<string>();
        const organizations: { name: string; type: string; confidence: number; evidence: string; source: string }[] = [];
        for (const o of rawOrgs) {
          const name = String(o?.name || "").replace(/\s+/g, " ").trim().slice(0, 120);
          if (!name) continue;
          const k = name.toLowerCase();
          if (seenOrg.has(k)) continue;
          const type = ORG_TYPES.includes(o?.type) ? o.type : "other";
          const evidence = evidenceSnippet(sourceText, name, o?.evidence);
          if (!shouldKeepOrganization(name, type, evidence, sourceText)) continue;
          seenOrg.add(k);
          organizations.push({
            name,
            type,
            confidence: Math.max(0, Math.min(1, Number(o?.confidence || 0.72))),
            evidence: evidence!,
            source: "entity_backfill_v5",
          });
          if (organizations.length >= 10) break;
        }
        // Backwards-compat: keep legacy flat `companies` array populated from org names.
        const companies = organizations.map((o) => o.name).slice(0, 6);

        const tickers = cleanArr(parsed.tickers).map((t) => t.replace(/[^a-zA-Z0-9.]+/g, "").toUpperCase()).filter(Boolean);
        const topics = cleanArr(parsed.topics).map((t) => t.toLowerCase());

        await admin.from("episodes").update({
          people, mentioned, companies, organizations, tickers, topics,
          entity_extraction_evidence: {
            version: 5,
            source: "entity_backfill",
            model,
            extracted_at: new Date().toISOString(),
            person_mentions: dedupedPeopleEvidence,
            organizations,
            rejected_policy: "literal_name_and_evidence_required",
          },
          ai_entities_version: 5,
        }).eq("id", ep.id);

        // Drop stale episode_organization_map rows for this episode — the
        // organizations-backfill-runner will rebuild them from the fresh
        // `organizations` jsonb on its next pass. This guarantees orgs that
        // disappeared after clean_text re-extraction stop being attributed.
        await admin.from("episode_organization_map").delete().eq("episode_id", ep.id);

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
        .select("id, title, display_title, description, ai_summary, podcast_id, clean_text_status, podcasts!inner(title, display_title, language, hosts)")
        .not("ai_summary", "is", null)
        .lt("ai_entities_version", 5)
        .eq("clean_text_status", "done")
        .eq("podcasts.is_hungarian", true)
        .limit(batch);
      if (error) throw error;
      const list = (rows || []) as any[];
      if (!list.length) break;

      const ids = list.map((r) => r.id).filter(Boolean);
      const { data: cleanRows } = await admin
        .from("episode_clean_text")
        .select("episode_id, cleaned_text")
        .in("episode_id", ids);
      const cleanByEpisode = new Map<string, string>(
        (cleanRows || []).map((r: any) => [String(r.episode_id), String(r.cleaned_text || "")]),
      );
      for (const ep of list) {
        ep.cleaned_text = cleanByEpisode.get(String(ep.id)) || "";
      }

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
