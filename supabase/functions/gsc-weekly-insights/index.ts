import { denyUntrustedCaller } from "../_shared/internal-auth.ts";
// Google Search Console importer + weekly insights.
// - action "sync" (daily cron, no AI, no email): whole-site totals per GSC day (dimension "date",
//   dataState "all", Google's own site total incl. anonymised queries) into `gsc_site_daily`
//   (final vs partial from metadata.firstIncompleteDate), then idempotent per-day query+page
//   detail backfill into `gsc_query_daily` with startRow paging, newest missing day first.
// - action "weekly" (Monday cron): sync, then the weekly insight row for the latest 7 FINAL days;
//   totals/deltas come from `gsc_site_daily`, never from a sum of top-N query rows.
// GSC days are Google's calendar days (Pacific time); the admin labels them so.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callLovableAI } from "../_shared/lovable-ai.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SITE_URL = "sc-domain:podiverzum.hu";
const GATEWAY = "https://connector-gateway.lovable.dev/google_search_console";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";
const GSC_KEY = Deno.env.get("GOOGLE_SEARCH_CONSOLE_API_KEY") || "";

type Row = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };
const PAGE_SIZE = 25000;
const MAX_PAGES_PER_DAY = 4;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function gscQuery(body: unknown): Promise<{ rows: Row[]; firstIncompleteDate?: string }> {
  const r = await fetch(
    `${GATEWAY}/webmasters/v3/sites/${encodeURIComponent(SITE_URL)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": GSC_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!r.ok) throw new Error(`GSC ${r.status}: ${await r.text().catch(() => "")}`);
  const j = await r.json();
  return { rows: (j.rows || []) as Row[], firstIncompleteDate: j?.metadata?.firstIncompleteDate };
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

// deno-lint-ignore no-explicit-any
type Admin = any;

/** Whole-site totals per day. Google keeps 16 months; we read the last 480 days in one call. */
export async function syncSiteTotals(admin: Admin) {
  const end = isoDate(new Date());
  const start = addDays(end, -480);
  const resp = await gscQuery({ startDate: start, endDate: end, dimensions: ["date"], dataState: "all", rowLimit: 1000 });
  const firstIncomplete = resp.firstIncompleteDate || null;
  const now = new Date().toISOString();
  const rows = resp.rows.map((r) => ({
    site_url: SITE_URL,
    date: r.keys[0],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    position: r.position,
    data_state: firstIncomplete && r.keys[0] >= firstIncomplete ? "partial" : "final",
    totals_fetched_at: now,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("gsc_site_daily").upsert(rows.slice(i, i + 500), { onConflict: "site_url,date" });
    if (error) throw new Error(`site_totals_upsert_failed: ${error.message}`);
  }
  const finals = rows.filter((r) => r.data_state === "final").map((r) => r.date).sort();
  return { days: rows.length, first_incomplete_date: firstIncomplete, latest_final: finals[finals.length - 1] || null };
}

/** Query+page detail for one GSC day, every page of results, idempotent upsert. */
async function syncDayDetail(admin: Admin, day: string) {
  let startRow = 0, pages = 0, total = 0, clicks = 0, impressions = 0, complete = false;
  while (pages < MAX_PAGES_PER_DAY) {
    const resp = await gscQuery({ startDate: day, endDate: day, dimensions: ["query", "page"], rowLimit: PAGE_SIZE, startRow });
    pages++;
    const recs = resp.rows.map((r) => ({
      site_url: SITE_URL, date: day, query: r.keys[0] || "", page: r.keys[1] || "",
      clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position, fetched_at: new Date().toISOString(),
    }));
    for (let i = 0; i < recs.length; i += 1000) {
      const { error } = await admin.from("gsc_query_daily").upsert(recs.slice(i, i + 1000), { onConflict: "site_url,date,query,page" });
      if (error) throw new Error(`detail_upsert_failed ${day}: ${error.message}`);
    }
    total += recs.length;
    for (const r of recs) { clicks += r.clicks; impressions += r.impressions; }
    if (resp.rows.length < PAGE_SIZE) { complete = true; break; }
    startRow += PAGE_SIZE;
  }
  const { error } = await admin.from("gsc_site_daily").update({
    detail_rows: total, detail_clicks: clicks, detail_impressions: impressions,
    detail_complete: complete, detail_fetched_at: new Date().toISOString(),
  }).eq("site_url", SITE_URL).eq("date", day);
  if (error) throw new Error(`detail_mark_failed ${day}: ${error.message}`);
  return { day, rows: total, pages, complete };
}

/** Final days whose detail is missing, newest first (bounded per call). */
export async function backfillDetail(admin: Admin, maxDays: number, sinceDay: string, untilDay = "9999-12-31") {
  const { data, error } = await admin.from("gsc_site_daily")
    .select("date").eq("site_url", SITE_URL).eq("data_state", "final")
    .eq("detail_complete", false).gte("date", sinceDay).lte("date", untilDay)
    .order("date", { ascending: false }).limit(maxDays);
  if (error) throw new Error(`detail_pick_failed: ${error.message}`);
  const done = [];
  for (const r of data || []) done.push(await syncDayDetail(admin, r.date));
  return done;
}

async function siteTotalsFor(admin: Admin, start: string, end: string) {
  const { data, error } = await admin.from("gsc_site_daily")
    .select("date,clicks,impressions,position,data_state")
    .eq("site_url", SITE_URL).gte("date", start).lte("date", end);
  if (error) throw new Error(`site_totals_read_failed: ${error.message}`);
  const rows = (data || []) as Array<{ date: string; clicks: number; impressions: number; position: number; data_state: string }>;
  let clicks = 0, impressions = 0, posSum = 0;
  for (const r of rows) { clicks += r.clicks; impressions += r.impressions; posSum += r.position * r.impressions; }
  return {
    clicks, impressions,
    ctr: impressions ? clicks / impressions : 0,
    position: impressions ? posSum / impressions : 0,
    days_present: rows.length,
    days_final: rows.filter((r) => r.data_state === "final").length,
    source: "gsc_site_daily",
  };
}

/** Re-state stored weekly totals from Google's site totals (old top-1000-query sums kept in raw_meta). */
async function restateWeeklyTotals(admin: Admin) {
  const { data } = await admin.from("gsc_weekly_insights").select("id,week_start,week_end,totals,deltas,raw_meta").eq("site_url", SITE_URL);
  let restated = 0;
  for (const w of data || []) {
    if (w.raw_meta?.totals_source === "gsc_site_daily") continue;
    const cur = await siteTotalsFor(admin, w.week_start, w.week_end);
    if (cur.days_final < 7) continue;
    const prevEnd = addDays(w.week_start, -1), prevStart = addDays(w.week_start, -7);
    const prev = await siteTotalsFor(admin, prevStart, prevEnd);
    const deltas = {
      ...(w.deltas || {}),
      clicks_pct: pct(cur.clicks, prev.clicks),
      impressions_pct: pct(cur.impressions, prev.impressions),
      ctr_delta: cur.ctr - prev.ctr,
      position_delta: cur.position - prev.position,
      prev_totals: prev,
      prev_window: { start: prevStart, end: prevEnd },
    };
    const { error } = await admin.from("gsc_weekly_insights").update({
      totals: cur, deltas,
      raw_meta: { ...(w.raw_meta || {}), totals_source: "gsc_site_daily", legacy_totals_top_queries_sum: w.totals, totals_restated_at: new Date().toISOString() },
    }).eq("id", w.id);
    if (!error) restated++;
  }
  return restated;
}

function totals(rows: Row[]) {
  let clicks = 0, impressions = 0, posSum = 0, posWeight = 0;
  for (const r of rows) {
    clicks += r.clicks;
    impressions += r.impressions;
    posSum += r.position * r.impressions;
    posWeight += r.impressions;
  }
  return {
    clicks,
    impressions,
    ctr: impressions ? clicks / impressions : 0,
    position: posWeight ? posSum / posWeight : 0,
  };
}

function pct(a: number, b: number): number {
  if (!b) return a ? 1 : 0;
  return (a - b) / b;
}

Deno.serve(async (req) => {
  { const denied = await denyUntrustedCaller(req, "gsc-weekly-insights"); if (denied) return denied; }
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    if (!LOVABLE_API_KEY || !GSC_KEY) {
      return json({ ok: false, error: "missing_credentials" }, 500);
    }
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = String(body.action || "weekly");
    const dryRun = body.dry_run === true;

    // 1. Whole-site daily totals (always; cheap: one request).
    const site = await syncSiteTotals(admin);
    const restated = await restateWeeklyTotals(admin);

    // 2. Query+page detail, newest missing final day first, bounded per call.
    const maxDays = Math.min(Math.max(Number(body.max_detail_days ?? (action === "sync" ? 8 : 3)), 0), 20);
    const detailSince = String(body.detail_since || "2026-05-30");
    const detailUntil = String(body.detail_until || "9999-12-31");
    const detail = await backfillDetail(admin, maxDays, detailSince, detailUntil);

    if (action === "sync") {
      return json({ ok: true, action, site, weekly_restated: restated, detail });
    }
    if (!site.latest_final) return json({ ok: false, error: "no_final_gsc_days" }, 500);

    // 3. Weekly window = latest 7 FINAL GSC days; previous = the 7 before.
    const curEnd = site.latest_final;
    const curStart = addDays(curEnd, -6);
    const prevEnd = addDays(curStart, -1);
    const prevStart = addDays(prevEnd, -6);

    // Top-N lists only (rankings); totals come from the site totals table.
    const [curQ, curP, prevQ] = await Promise.all([
      gscQuery({ startDate: curStart, endDate: curEnd, dimensions: ["query"], rowLimit: 1000 }),
      gscQuery({ startDate: curStart, endDate: curEnd, dimensions: ["page"], rowLimit: 500 }),
      gscQuery({ startDate: prevStart, endDate: prevEnd, dimensions: ["query"], rowLimit: 1000 }),
    ]);

    const curTotals = await siteTotalsFor(admin, curStart, curEnd);
    const prevTotals = await siteTotalsFor(admin, prevStart, prevEnd);
    const deltas = {
      clicks_pct: pct(curTotals.clicks, prevTotals.clicks),
      impressions_pct: pct(curTotals.impressions, prevTotals.impressions),
      ctr_delta: curTotals.ctr - prevTotals.ctr,
      position_delta: curTotals.position - prevTotals.position, // negative = improved
    };

    // Movers
    const prevByQ = new Map(prevQ.rows.map((r) => [r.keys[0], r]));
    const movers = curQ.rows
      .filter((r) => r.impressions >= 10)
      .map((r) => {
        const p = prevByQ.get(r.keys[0]);
        return {
          query: r.keys[0],
          clicks: r.clicks,
          impressions: r.impressions,
          ctr: r.ctr,
          position: r.position,
          prev_position: p?.position ?? null,
          prev_clicks: p?.clicks ?? 0,
          delta_clicks: r.clicks - (p?.clicks ?? 0),
          delta_position: p ? r.position - p.position : null,
        };
      });

    const rising = [...movers].sort((a, b) => b.delta_clicks - a.delta_clicks).slice(0, 15);
    const falling = [...movers]
      .filter((m) => m.prev_clicks > 0)
      .sort((a, b) => a.delta_clicks - b.delta_clicks)
      .slice(0, 15);

    // Striking distance: position 5-20, decent impressions, low CTR — easiest title/meta wins.
    const striking = curQ.rows
      .filter((r) => r.position >= 4.5 && r.position <= 20 && r.impressions >= 25)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 25)
      .map((r) => ({
        query: r.keys[0],
        impressions: r.impressions,
        clicks: r.clicks,
        ctr: r.ctr,
        position: r.position,
      }));

    // Zero-click but high impressions: title/snippet not compelling.
    const zeroClick = curQ.rows
      .filter((r) => r.clicks === 0 && r.impressions >= 30)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 20)
      .map((r) => ({ query: r.keys[0], impressions: r.impressions, position: r.position }));

    const topQueries = [...curQ.rows]
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 25)
      .map((r) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }));

    const topPages = [...curP.rows]
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 25)
      .map((r) => ({ page: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }));

    // 3. AI summary + concrete actions in Hungarian.
    const aiInput = JSON.stringify({
      week: { start: curStart, end: curEnd },
      totals: curTotals,
      prev_totals: prevTotals,
      deltas,
      top_queries: topQueries.slice(0, 15),
      top_pages: topPages.slice(0, 15),
      rising: rising.slice(0, 10),
      falling: falling.slice(0, 10),
      striking_distance: striking.slice(0, 15),
      zero_click_high_impr: zeroClick.slice(0, 10),
    });

    const sys = [
      "Te a Podiverzum (magyar podcast felfedező, podiverzum.hu) SEO elemzője vagy.",
      "Heti Google Search Console adatok alapján adsz rövid, konkrét magyar nyelvű következtetést és optimalizációs lépéseket.",
      "Stílus: tényszerű, konkrét. Tilos általánosság. Adj URL-szintű vagy query-szintű javaslatot ahol lehet.",
      "Fókusz: striking-distance kérdések (4.5-20 pozíció, magas impresszió, alacsony CTR) — title/H1/meta finomhangolása.",
      "Zero-click magas impressziójú kérdéseknél: ott a snippet/title kell vonzóbbra. Eső queryknél diagnózis.",
    ].join("\n");

    let aiSummary = "";
    let aiRecs: any[] = [];
    let aiModel = "google/gemini-2.5-flash-lite";
    try {
      const ai = await callLovableAI({
        model: aiModel,
        job_type: "gsc_weekly_insights",
        target_type: "gsc_site",
        target_id: SITE_URL,
        prompt_version: "gsc-v1",
        input_text: aiInput,
        min_input_chars: 50,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: aiInput },
        ],
        tools: [{
          type: "function",
          function: {
            name: "publish_insights",
            description: "Heti SEO összefoglaló és konkrét akciók.",
            parameters: {
              type: "object",
              properties: {
                summary: { type: "string", description: "2-4 mondatos magyar összefoglaló a hétről." },
                actions: {
                  type: "array",
                  minItems: 3,
                  maxItems: 10,
                  items: {
                    type: "object",
                    properties: {
                      priority: { type: "string", enum: ["high", "medium", "low"] },
                      type: {
                        type: "string",
                        enum: ["title_meta", "content", "internal_link", "new_page", "technical", "track"],
                      },
                      target: { type: "string", description: "Query, URL vagy oldal-szegmens amire vonatkozik." },
                      action: { type: "string", description: "Egy mondatos konkrét teendő magyarul." },
                      expected_impact: { type: "string", description: "Pár szavas várt hatás." },
                    },
                    required: ["priority", "type", "target", "action"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["summary", "actions"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "publish_insights" } },
      });
      if (ai.ok) {
        const args = ai.data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
        if (args) {
          const parsed = JSON.parse(args);
          aiSummary = String(parsed.summary || "");
          aiRecs = Array.isArray(parsed.actions) ? parsed.actions : [];
        }
      }
    } catch (e) {
      aiSummary = `AI generation skipped: ${(e as Error).message}`;
    }

    const insightRow = {
      week_start: curStart,
      week_end: curEnd,
      site_url: SITE_URL,
      totals: curTotals,
      deltas: { ...deltas, prev_totals: prevTotals, prev_window: { start: prevStart, end: prevEnd } },
      top_queries: topQueries,
      top_pages: topPages,
      rising_queries: rising,
      falling_queries: falling,
      striking_distance: striking,
      zero_click_high_impr: zeroClick,
      ai_summary: aiSummary,
      ai_recommendations: aiRecs,
      ai_model: aiModel,
      raw_meta: {
        totals_source: "gsc_site_daily",
        top_lists_note: "top_queries/top_pages are top-N rankings (rowLimit 1000/500), not site totals",
        queries_rows: curQ.rows.length, pages_rows: curP.rows.length,
        query_rows_capped: curQ.rows.length >= 1000, page_rows_capped: curP.rows.length >= 500,
        gsc_first_incomplete_date: site.first_incomplete_date,
      },
    };

    if (dryRun) {
      return json({ ok: true, dry_run: true, row: insightRow });
    }

    const { error: upErr } = await admin
      .from("gsc_weekly_insights")
      .upsert(insightRow, { onConflict: "site_url,week_start" });
    if (upErr) throw new Error(`insert_failed: ${upErr.message}`);

    // 4. Send weekly email digest.
    let emailStatus: string = "skipped";
    try {
      const recipient = (body.recipient_email as string | undefined) || "m.mate.david@gmail.com";
      const { error: emailErr } = await admin.functions.invoke("send-transactional-email", {
        body: {
          templateName: "gsc-weekly-insights",
          recipientEmail: recipient,
          idempotencyKey: `gsc-weekly-${curStart}-${recipient}`,
          templateData: {
            weekStart: curStart,
            weekEnd: curEnd,
            totals: curTotals,
            deltas,
            summary: aiSummary,
            actions: aiRecs,
            striking,
            rising,
            falling,
            adminUrl: "https://podiverzum.hu/admin/gsc-insights",
          },
        },
      });
      emailStatus = emailErr ? `error: ${emailErr.message}` : "enqueued";
    } catch (e) {
      emailStatus = `error: ${(e as Error).message}`;
    }

    return json({
      ok: true,
      week: { start: curStart, end: curEnd },
      totals: curTotals,
      deltas,
      ai_actions: aiRecs.length,
      site,
      weekly_restated: restated,
      detail,
      email: emailStatus,
    });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message) }, 500);
  }
});
