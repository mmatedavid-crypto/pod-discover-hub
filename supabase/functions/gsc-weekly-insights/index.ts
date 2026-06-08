// Weekly Google Search Console insights runner.
// - Pulls last 7 days (vs previous 7 days) from GSC via Lovable connector gateway.
// - Computes totals, deltas, top queries/pages, rising/falling movers, striking-distance opportunities.
// - Calls Lovable AI Gateway for Hungarian summary + concrete optimization actions.
// - Stores one row per ISO week in `gsc_weekly_insights` + per-day rows in `gsc_query_daily`.
//
// Schedule: weekly Monday 06:10 UTC via pg_cron.
// Manual:   POST { dry_run?: bool, weeks_back?: number }

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

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfWeekUTC(base: Date, weeksBack = 0): Date {
  // ISO week starts Monday. Build "last completed week" ending yesterday.
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() - weeksBack * 7);
  return d;
}

async function gscQuery(body: unknown): Promise<{ rows: Row[] }> {
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
  return { rows: (j.rows || []) as Row[] };
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
    const weeksBack = Number(body.weeks_back ?? 1);
    const dryRun = body.dry_run === true;

    // GSC data has ~3-day lag. End the current window 3 days before today.
    const today = new Date();
    const endRef = new Date(today);
    endRef.setUTCDate(endRef.getUTCDate() - 3);

    const curEnd = isoDate(endRef);
    const curStartD = new Date(endRef); curStartD.setUTCDate(curStartD.getUTCDate() - 6);
    const curStart = isoDate(curStartD);
    const prevEndD = new Date(curStartD); prevEndD.setUTCDate(prevEndD.getUTCDate() - 1);
    const prevEnd = isoDate(prevEndD);
    const prevStartD = new Date(prevEndD); prevStartD.setUTCDate(prevStartD.getUTCDate() - 6);
    const prevStart = isoDate(prevStartD);

    // 1. Per-day rows (query + page) for trend storage.
    const dailyResp = await gscQuery({
      startDate: curStart,
      endDate: curEnd,
      dimensions: ["date", "query", "page"],
      rowLimit: 5000,
    });

    // 2. Current week aggregates.
    const [curQ, curP, prevQ, prevP] = await Promise.all([
      gscQuery({ startDate: curStart, endDate: curEnd, dimensions: ["query"], rowLimit: 1000 }),
      gscQuery({ startDate: curStart, endDate: curEnd, dimensions: ["page"], rowLimit: 500 }),
      gscQuery({ startDate: prevStart, endDate: prevEnd, dimensions: ["query"], rowLimit: 1000 }),
      gscQuery({ startDate: prevStart, endDate: prevEnd, dimensions: ["page"], rowLimit: 500 }),
    ]);

    const curTotals = totals(curQ.rows);
    const prevTotals = totals(prevQ.rows);
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
      raw_meta: { weeks_back: weeksBack, queries_rows: curQ.rows.length, pages_rows: curP.rows.length, daily_rows: dailyResp.rows.length },
    };

    if (dryRun) {
      return json({ ok: true, dry_run: true, row: insightRow });
    }

    const { error: upErr } = await admin
      .from("gsc_weekly_insights")
      .upsert(insightRow, { onConflict: "site_url,week_start" });
    if (upErr) throw new Error(`insert_failed: ${upErr.message}`);

    // Bulk upsert daily rows in chunks of 500.
    const dailyRecords = dailyResp.rows.map((r) => ({
      site_url: SITE_URL,
      date: r.keys[0],
      query: r.keys[1] || "",
      page: r.keys[2] || "",
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
    }));
    let dailyInserted = 0;
    for (let i = 0; i < dailyRecords.length; i += 500) {
      const chunk = dailyRecords.slice(i, i + 500);
      const { error } = await admin
        .from("gsc_query_daily")
        .upsert(chunk, { onConflict: "site_url,date,query,page" });
      if (!error) dailyInserted += chunk.length;
    }

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
      daily_rows: dailyInserted,
      email: emailStatus,
    });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message) }, 500);
  }
});
