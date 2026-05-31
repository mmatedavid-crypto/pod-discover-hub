// daily-brief-extras
// Naponta 1× futtatott AI: "Ezen a napon történt" + napi idézet kiválasztása
// friss S/A epizódokból. Eredmény: public.daily_brief_extras (date PK).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callLovableAI } from "../_shared/lovable-ai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MODEL = "google/gemini-2.5-flash";

function todayHU(): { iso: string; month: number; day: number; pretty: string } {
  const now = new Date();
  // Budapest TZ via Intl
  const parts = new Intl.DateTimeFormat("hu-HU", {
    timeZone: "Europe/Budapest",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value || "0");
  const y = get("year"), m = get("month"), d = get("day");
  const iso = `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  const pretty = new Intl.DateTimeFormat("hu-HU", {
    timeZone: "Europe/Budapest", month: "long", day: "numeric",
  }).format(now);
  return { iso, month: m, day: d, pretty };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supa = createClient(SUPABASE_URL, SERVICE_KEY);
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const t = todayHU();

  // skip if already generated today (unless force)
  if (!force) {
    const { data: existing } = await supa
      .from("daily_brief_extras")
      .select("date, generated_at")
      .eq("date", t.iso)
      .maybeSingle();
    if (existing?.generated_at) {
      return new Response(JSON.stringify({ ok: true, skipped: "already_generated", date: t.iso }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // 1) Fetch ~25 recent HU non-spam episodes with summary for quote selection
  const since = new Date(Date.now() - 72 * 3600_000).toISOString();
  const { data: recentEps } = await supa
    .from("episodes")
    .select("id, slug, title, display_title, ai_summary, summary, podcast_id, podcasts!inner(title, display_title, slug, language, is_hungarian, language_decision, rank_label)")
    .gte("published_at", since)
    .or("is_hungarian.eq.true,language_decision.eq.accept_hungarian", { foreignTable: "podcasts" })
    .not("ai_summary", "is", null)
    .order("published_at", { ascending: false })
    .limit(25);

  const epsForPrompt = (recentEps || []).filter((e: any) => e.podcasts?.language_decision !== "reject_foreign").map((e: any, i: number) => ({
    idx: i,
    id: e.id,
    title: e.display_title || e.title,
    podcast: e.podcasts?.display_title || e.podcasts?.title,
    summary: (e.ai_summary || e.summary || "").slice(0, 600),
  }));

  // 2) AI call — tool calling for structured output
  const sysPrompt = `Magyar nyelvű szerkesztő vagy egy magyar podcast-lap "Mai válogatás" rovatához.
Két dolgot kell előállítanod a mai napra (${t.pretty}):

1) "on_this_day": 3-5 jelentős esemény, amely a mai dátumon (${t.month}. hónap ${t.day}. nap) történt — bármely évben.
   Előnyben részesítsd a magyar vonatkozású eseményeket (történelem, kultúra, sport, tudomány), de világtörténelmi mérföldkövek is mehetnek.
   Minden eseményhez adj egy rövid "search_query" mezőt (2-4 kulcsszó magyarul), amivel kapcsolódó podcast epizódokat lehet keresni.

2) "quote": válassz EGY idézhető, önállóan is értelmes mondatot a megadott friss epizódok ai_summary-jából.
   Olyat, ami megragad, gondolkodtat vagy frappáns. Ne tartalmazzon kontextus nélkül érthetetlen utalást.
   Add meg az "episode_idx" mezőt (a lista indexe) és a "why" mezőt (1 mondat: miért érdekes).

Csak magyarul.`;

  const userPrompt = `Friss epizódok az idézethez:\n${epsForPrompt.map(e =>
    `[${e.idx}] "${e.title}" (${e.podcast})\n${e.summary}`
  ).join("\n\n")}`;

  const tools = [{
    type: "function",
    function: {
      name: "publish_daily_brief",
      description: "Mai napi szerkesztett tartalom",
      parameters: {
        type: "object",
        properties: {
          on_this_day: {
            type: "array",
            items: {
              type: "object",
              properties: {
                year: { type: "integer" },
                title: { type: "string", description: "rövid cím, max 90 karakter" },
                summary: { type: "string", description: "1-2 mondatos magyar leírás" },
                search_query: { type: "string", description: "2-4 magyar kulcsszó podcast kereséshez" },
                hu_related: { type: "boolean" },
              },
              required: ["year", "title", "summary", "search_query"],
            },
          },
          quote: {
            type: "object",
            properties: {
              text: { type: "string", description: "Az idézet szó szerint, magyarul, max 240 karakter" },
              episode_idx: { type: "integer" },
              why: { type: "string" },
            },
            required: ["text", "episode_idx"],
          },
        },
        required: ["on_this_day", "quote"],
      },
    },
  }];

  const aiResp = await callLovableAI({
    model: MODEL,
    messages: [
      { role: "system", content: sysPrompt },
      { role: "user", content: userPrompt },
    ],
    tools,
    tool_choice: { type: "function", function: { name: "publish_daily_brief" } },
    temperature: 0.6,
    max_tokens: 2000,
    job_type: "daily-brief-extras",
    target_type: "date",
    target_id: t.iso,
  });

  if (!aiResp.ok) {
    return new Response(JSON.stringify({ ok: false, error: aiResp.error, status: aiResp.status }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const toolCall = aiResp.data?.choices?.[0]?.message?.tool_calls?.[0];
  let parsed: any = null;
  try { parsed = JSON.parse(toolCall?.function?.arguments || "{}"); } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: "parse_failed", raw: toolCall }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const events: any[] = Array.isArray(parsed?.on_this_day) ? parsed.on_this_day : [];
  const quote = parsed?.quote || null;

  // 3) Resolve episode matches for each event via FTS (HU config)
  for (const ev of events) {
    try {
      const q = String(ev.search_query || ev.title || "").trim();
      if (!q) continue;
      // websearch_to_tsquery would be ideal; use plainto_tsquery via raw query via rpc not available.
      // Use ilike-based fuzzy match on display_title + ai_summary as a simple pass.
      const tokens = q.split(/\s+/).filter(Boolean).slice(0, 4);
      if (tokens.length === 0) continue;
      const orClauses = tokens.map(tk => `display_title.ilike.%${tk}%,ai_summary.ilike.%${tk}%,title.ilike.%${tk}%`).join(",");
      const { data: matches } = await supa
        .from("episodes")
        .select("id, slug, title, display_title, podcasts!inner(slug, title, display_title, language, is_hungarian, language_decision)")
        .or("is_hungarian.eq.true,language_decision.eq.accept_hungarian", { foreignTable: "podcasts" })
        .or(orClauses)
        .order("published_at", { ascending: false })
        .limit(2);
      ev.episodes = (matches || []).filter((m: any) => m.podcasts?.language_decision !== "reject_foreign").map((m: any) => ({
        id: m.id, slug: m.slug,
        title: m.display_title || m.title,
        podcast_slug: m.podcasts?.slug,
        podcast_title: m.podcasts?.display_title || m.podcasts?.title,
      }));
    } catch (_) { ev.episodes = []; }
  }

  // 4) Resolve quote source episode
  let quotePayload: any = null;
  if (quote && typeof quote.episode_idx === "number" && epsForPrompt[quote.episode_idx]) {
    const src = epsForPrompt[quote.episode_idx];
    const { data: srcEp } = await supa
      .from("episodes")
      .select("id, slug, title, display_title, podcasts!inner(slug, title, display_title)")
      .eq("id", src.id)
      .maybeSingle();
    quotePayload = {
      text: quote.text,
      why: quote.why || null,
      episode: srcEp ? {
        id: srcEp.id, slug: srcEp.slug,
        title: (srcEp as any).display_title || srcEp.title,
        podcast_slug: (srcEp as any).podcasts?.slug,
        podcast_title: (srcEp as any).podcasts?.display_title || (srcEp as any).podcasts?.title,
      } : null,
    };
  }

  // 5) Upsert
  const { error: upErr } = await supa
    .from("daily_brief_extras")
    .upsert({
      date: t.iso,
      on_this_day: events,
      quote: quotePayload,
      generated_at: new Date().toISOString(),
    }, { onConflict: "date" });

  if (upErr) {
    return new Response(JSON.stringify({ ok: false, error: upErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({
    ok: true, date: t.iso,
    on_this_day_count: events.length,
    has_quote: !!quotePayload,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
