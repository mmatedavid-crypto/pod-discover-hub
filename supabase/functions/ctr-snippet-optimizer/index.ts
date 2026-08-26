// CTR snippet optimizer.
//
// Finds URLs that already rank well in Google (position <= max_position) but get
// clicked rarely (ctr < max_ctr) with enough impressions, then rewrites their
// seo_title / seo_description with the actual GSC search queries in mind, and
// pings IndexNow so Google re-crawls the new snippet.
//
// POST { dry_run?: boolean, days?: number, limit?: number,
//        max_position?: number, max_ctr?: number, min_impressions?: number }
// GET  ?dry_run=1  (cron uses plain POST)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callLovableAI } from "../_shared/lovable-ai.ts";
import { chatTokenCostUsd } from "../_shared/ai-pricing.ts";
import { assertHungarianPublicFields, isHungarianish } from "../_shared/hu-language-guard.ts";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SITE_URL = "sc-domain:podiverzum.hu";
const GATEWAY = "https://connector-gateway.lovable.dev/google_search_console";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";
const GSC_KEY = Deno.env.get("GOOGLE_SEARCH_CONSOLE_API_KEY") || "";
const MODEL = "google/gemini-2.5-flash";
const CTA_PREFIX = "🎧▶️ Hallgasd ingyen: ";

type Row = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };

type Candidate = {
  url: string;
  path: string;
  kind: "episode" | "podcast";
  target_id: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  queries: { query: string; impressions: number; clicks: number; position: number }[];
};

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

async function gscQuery(body: unknown): Promise<Row[]> {
  const r = await fetch(
    `${GATEWAY}/webmasters/v3/sites/${encodeURIComponent(SITE_URL)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": GSC_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!r.ok) throw new Error(`GSC ${r.status}: ${(await r.text().catch(() => "")).slice(0, 300)}`);
  const j = await r.json();
  return (j.rows || []) as Row[];
}

function trim(s: string, max: number, ellipsis = true): string {
  s = (s || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  const base = (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:\-–—\s]+$/, "");
  // Titles must never end in an ellipsis — Google shows it as a broken headline.
  return ellipsis ? base + "…" : base;
}


function applyCtaPrefix(desc: string): string {
  if (!desc) return desc;
  if (desc.startsWith("🎧") || desc.startsWith("▶️")) return desc;
  const body = desc.replace(/^\s+/, "");
  // Keep the original casing: lowercasing broke proper nouns ("fábry Kornél").
  const lc = body;
  const combined = CTA_PREFIX + lc;
  if (combined.length <= 160) return combined;
  const budget = 160 - CTA_PREFIX.length - 1;
  return CTA_PREFIX + lc.slice(0, budget).replace(/\s+\S*$/, "") + "…";
}

const SNIPPET_TOOL = {
  type: "function",
  function: {
    name: "ctr_snippet",
    description:
      "Rewrite the SEO title and meta description of a Hungarian podcast page so it earns more clicks in Google for the given real search queries. Use ONLY facts from the supplied metadata. No invented guests, numbers, quotes or claims. No clickbait, no ALL CAPS.",
    parameters: {
      type: "object",
      properties: {
        seo_title: {
          type: "string",
          description:
            "Magyar cím, max 60 karakter. A legfontosabb keresési kifejezés (pl. személynév vagy téma) legyen ELÖL. Ne legyen clickbait, ne legyen emoji.",
        },
        seo_description: {
          type: "string",
          description:
            "Magyar meta leírás, max 150 karakter (a hívó tesz elé egy 🎧 CTA prefixet). Konkrét, tényszerű, cselekvésre hívó zárás. Ne ismételd szó szerint a címet.",
        },
      },
      required: ["seo_title", "seo_description"],
      additionalProperties: false,
    },
  },
};

const SYSTEM = [
  "Magyar podcast-kereső (Podiverzum) SEO snippet szakértője vagy.",
  "A feladat: már jól rangsoroló, de kevés kattintást hozó oldalak címének és meta leírásának újraírása.",
  "KIZÁRÓLAG a megadott metaadatokból dolgozz — soha ne találj ki vendéget, számot, idézetet vagy állítást.",
  "MINDIG magyarul írj. Ne használj clickbaitet, csupa nagybetűt, felkiáltójelet vagy emojit.",
  "A valós Google keresési kifejezéseket építsd bele természetesen, a legfontosabbat a cím elejére.",
].join(" ");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    if (!LOVABLE_API_KEY || !GSC_KEY) return json({ ok: false, error: "missing_credentials" }, 500);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const guard = await checkBackgroundJobsAllowed(admin as any, "ctr-snippet-optimizer");
    if (guard.blocked) return json({ ok: false, skipped: "background_jobs_disabled", reason: guard.reason });

    const url = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const dryRun = body.dry_run === true || url.searchParams.get("dry_run") === "1";
    const days = Math.min(90, Math.max(7, Number(body.days ?? 28)));
    const limit = Math.min(80, Math.max(1, Number(body.limit ?? 40)));
    // Wider net: pos <= 15 still earns clicks from a better snippet, and most of our
    // wasted impressions sit on pages with 10-25 impressions.
    const maxPosition = Number(body.max_position ?? 15);
    const maxCtr = Number(body.max_ctr ?? 0.06);
    const minImpressions = Number(body.min_impressions ?? 10);
    const cooldownDays = Number(body.cooldown_days ?? 21);


    // GSC has ~3 day lag.
    const end = new Date();
    end.setUTCDate(end.getUTCDate() - 3);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (days - 1));

    const rows = await gscQuery({
      startDate: isoDate(start),
      endDate: isoDate(end),
      dimensions: ["page", "query"],
      rowLimit: 5000,
    });

    // Aggregate per page.
    type Agg = {
      clicks: number;
      impressions: number;
      posWeighted: number;
      queries: { query: string; impressions: number; clicks: number; position: number }[];
    };
    const byPage = new Map<string, Agg>();
    for (const r of rows) {
      const page = r.keys[0];
      const query = r.keys[1];
      const a = byPage.get(page) || { clicks: 0, impressions: 0, posWeighted: 0, queries: [] };
      a.clicks += r.clicks;
      a.impressions += r.impressions;
      a.posWeighted += r.position * r.impressions;
      a.queries.push({ query, impressions: r.impressions, clicks: r.clicks, position: r.position });
      byPage.set(page, a);
    }

    // Resolve candidates to DB targets.
    const rawCandidates: Omit<Candidate, "target_id">[] = [];
    for (const [page, a] of byPage) {
      const ctr = a.impressions ? a.clicks / a.impressions : 0;
      const position = a.impressions ? a.posWeighted / a.impressions : 99;
      if (a.impressions < minImpressions) continue;
      if (position > maxPosition) continue;
      if (ctr >= maxCtr) continue;
      let path: string;
      try {
        path = new URL(page).pathname.replace(/\/+$/, "");
      } catch {
        continue;
      }
      const parts = path.split("/").filter(Boolean);
      if (parts[0] !== "podcast" || parts.length < 2 || parts.length > 3) continue;
      rawCandidates.push({
        url: page,
        path,
        kind: parts.length === 3 ? "episode" : "podcast",
        clicks: a.clicks,
        impressions: a.impressions,
        ctr,
        position,
        queries: a.queries.sort((x, y) => y.impressions - x.impressions).slice(0, 6),
      });
    }
    rawCandidates.sort((a, b) => b.impressions - a.impressions);

    // Skip URLs optimized recently.
    const cooldownSince = new Date(Date.now() - cooldownDays * 86400_000).toISOString();
    const { data: recent } = await admin
      .from("ctr_snippet_optimizations")
      .select("url")
      .gte("created_at", cooldownSince);
    const recentSet = new Set((recent || []).map((r: any) => r.url));

    const candidates: Candidate[] = [];
    for (const c of rawCandidates) {
      if (candidates.length >= limit) break;
      if (recentSet.has(c.url)) continue;
      const parts = c.path.split("/").filter(Boolean);
      const podcastSlug = parts[1];
      if (c.kind === "podcast") {
        const { data: p } = await admin
          .from("podcasts")
          .select("id,title,display_title,description,seo_title,seo_description,category,language")
          .eq("slug", podcastSlug)
          .maybeSingle();
        if (!p) continue;
        candidates.push({ ...c, target_id: (p as any).id });
        (c as any).meta = p;
      } else {
        const { data: e } = await admin
          .from("episodes")
          .select(
            "id,title,display_title,description,ai_summary,seo_title,seo_description,published_at,podcasts!inner(slug,title,display_title,language)",
          )
          .eq("slug", parts[2])
          .eq("podcasts.slug", podcastSlug)
          .maybeSingle();
        if (!e) continue;
        candidates.push({ ...c, target_id: (e as any).id });
        (c as any).meta = e;
      }
    }

    if (dryRun) {
      const allPages = [...byPage.entries()]
        .map(([page, a]) => ({
          url: page,
          impressions: a.impressions,
          clicks: a.clicks,
          ctr: Number((a.impressions ? a.clicks / a.impressions : 0).toFixed(4)),
          position: Number((a.impressions ? a.posWeighted / a.impressions : 99).toFixed(2)),
        }))
        .sort((x, y) => y.impressions - x.impressions)
        .slice(0, 120);
      return json({
        ok: true,
        dry_run: true,
        window: { start: isoDate(start), end: isoDate(end) },
        scanned_pages: byPage.size,
        all_pages: allPages,
        candidates: candidates.map((c) => ({
          url: c.url,
          kind: c.kind,
          impressions: c.impressions,
          clicks: c.clicks,
          ctr: Number(c.ctr.toFixed(4)),
          position: Number(c.position.toFixed(2)),
          top_queries: c.queries.map((q) => q.query),
        })),
      });
    }


    let updated = 0;
    let failed = 0;
    let costUsd = 0;
    const results: any[] = [];

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const meta: any = (rawCandidates.find((r) => r.url === c.url) as any)?.meta;
      if (!meta) continue;
      try {
        const showName = c.kind === "episode"
          ? meta.podcasts?.display_title || meta.podcasts?.title
          : meta.display_title || meta.title;
        const itemName = c.kind === "episode" ? meta.display_title || meta.title : showName;
        const source = (meta.ai_summary || meta.description || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 1200);
        const queryLines = c.queries
          .map((q) => `- "${q.query}" — ${q.impressions} megjelenés, ${q.clicks} kattintás, átlagos pozíció ${q.position.toFixed(1)}`)
          .join("\n");

        const prompt = [
          `Típus: ${c.kind === "episode" ? "podcast epizód" : "podcast műsor"}`,
          `Műsor: ${showName || "(ismeretlen)"}`,
          c.kind === "episode" ? `Epizód: ${itemName}` : "",
          `Jelenlegi cím: ${meta.seo_title || itemName}`,
          `Jelenlegi leírás: ${meta.seo_description || "(nincs)"}`,
          `Tartalom (kizárólagos tényforrás): ${source || "(nincs)"}`,
          "",
          `Google teljesítmény az elmúlt ${days} napban: ${c.impressions} megjelenés, ${c.clicks} kattintás, CTR ${(c.ctr * 100).toFixed(1)}%, átlagos pozíció ${c.position.toFixed(1)}.`,
          "Valós keresési kifejezések, amelyekre megjelenünk:",
          queryLines,
          "",
          "Írd újra a címet és a meta leírást úgy, hogy erre a keresési szándékra válaszoljon és több kattintást hozzon.",
        ].filter(Boolean).join("\n");

        const ai = await callLovableAI({
          model: MODEL,
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: prompt },
          ],
          tools: [SNIPPET_TOOL],
          tool_choice: { type: "function", function: { name: "ctr_snippet" } },
          job_type: "ctr_snippet_optimizer",
          target_type: c.kind,
          target_id: c.target_id,
          prompt_version: "ctr_v1",
          input_text: prompt,
          min_input_chars: 60,
        });
        if (!ai.ok) throw new Error(ai.error || `ai_status_${ai.status}`);
        costUsd += chatTokenCostUsd(MODEL, Number(ai.input_tokens || 0), Number(ai.output_tokens || 0));

        const args = ai.data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
        const parsed = args ? JSON.parse(args) : null;
        if (!parsed) throw new Error("no_tool_call");

        const newTitle = trim(String(parsed.seo_title || ""), 60, false);
        let newDesc = trim(String(parsed.seo_description || ""), 150);
        if (newTitle.length < 10 || newDesc.length < 40) throw new Error("output_too_short");
        assertHungarianPublicFields({ seo_title: newTitle, seo_description: newDesc });
        if (!isHungarianish(`${newTitle} ${newDesc}`)) throw new Error("hu_language_guard_failed");
        // Audio CTA signals "listenable content" in the SERP for shows too, not just episodes.
        newDesc = applyCtaPrefix(newDesc);


        const table = c.kind === "episode" ? "episodes" : "podcasts";
        const { error: upErr } = await admin
          .from(table)
          .update({ seo_title: newTitle, seo_description: newDesc })
          .eq("id", c.target_id);
        if (upErr) throw new Error(upErr.message);

        await admin.from("ctr_snippet_optimizations").insert({
          url: c.url,
          target_type: c.kind,
          target_id: c.target_id,
          window_days: days,
          impressions: c.impressions,
          clicks: c.clicks,
          ctr: c.ctr,
          position: c.position,
          top_queries: c.queries,
          old_seo_title: meta.seo_title,
          old_seo_description: meta.seo_description,
          new_seo_title: newTitle,
          new_seo_description: newDesc,
          model_used: MODEL,
          status: "applied",
        });
        updated++;
        results.push({ url: c.url, new_seo_title: newTitle, new_seo_description: newDesc });
      } catch (e) {
        failed++;
        const msg = String((e as Error)?.message || e).slice(0, 400);
        console.warn("ctr-snippet-optimizer failed", c.url, msg);
        await admin.from("ctr_snippet_optimizations").insert({
          url: c.url,
          target_type: c.kind,
          target_id: c.target_id,
          window_days: days,
          impressions: c.impressions,
          clicks: c.clicks,
          ctr: c.ctr,
          position: c.position,
          top_queries: c.queries,
          model_used: MODEL,
          status: "error",
          error_message: msg,
        });
      }
    }

    // Ask Bing/IndexNow to re-crawl the rewritten pages so the new snippet lands fast.
    let indexnow: any = null;
    if (results.length) {
      try {
        const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/indexnow-submit`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ urls: results.map((r) => r.url) }),
        });
        indexnow = { status: r.status };
      } catch (e) {
        indexnow = { error: String((e as Error)?.message || e) };
      }
    }

    return json({
      ok: true,
      window: { start: isoDate(start), end: isoDate(end) },
      scanned_pages: byPage.size,
      candidates: candidates.length,
      updated,
      failed,
      estimated_cost_usd: Number(costUsd.toFixed(4)),
      indexnow,
      results,
    });
  } catch (e) {
    console.error("ctr-snippet-optimizer error", e);
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
