// Bible-prefetch: create tomorrow's "N. nap" placeholder episode a few hours before
// the RSS drops at 01:00 CEST. The placeholder is NOT empty — it contains the day's
// scripture references, the Great Adventure Timeline period, and a ~400-word AI reflection
// in Hungarian so Google has substantive content to index for the ~7 hours before audio arrives.
//
// When fetch-rss later runs, it merges the real audio into this same row (see
// supabase/functions/_shared/fetch-one.ts) so the URL stays stable.
//
// Modes:
//   POST {}                → run once for the next day
//   POST { dry_run: true } → detect + preview generated body, no insert
//   POST { day: 197 }      → force a specific day number

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SITE = "https://podiverzum.hu";
const PODCAST_ID = "b9b62713-d314-4da2-a69a-0b0dd2749df3";
const PODCAST_SLUG = "biblia-egy-ev-alatt-podcast-fabry-kornel-puspok-atyaval";
const HOST_NAME = "Fábry Kornél";
const SERIES = "Biblia egy év alatt";

// Great Adventure Timeline korszakok — rövid, semleges bevezető mondat mindegyikhez.
const PERIOD_INTRO: Record<string, string> = {
  "Ősidők": "A teremtéstől az özönvízig — a világ kezdete és az emberiség első története.",
  "Pátriárkák": "Ábrahám, Izsák, Jákob és József kora — Isten szövetsége egy néppel.",
  "Egyiptom és Kivonulás": "Izrael egyiptomi rabsága és a Sínai-hegyi szövetség.",
  "Sivatagi vándorlás": "A negyven év pusztai vándorlás a Törvénnyel és a Sátorral.",
  "Honfoglalás és Bírák": "Józsue vezetése alatt Kánaán elfoglalása, majd a bírák kora.",
  "Egyesült királyság": "Saul, Dávid és Salamon uralkodása egyetlen királyságban.",
  "Megosztott királyság": "A királyság kettészakadása Izraelre és Júdára; a próféták kora.",
  "Fogság": "Izrael és Júda pusztulása, a babiloni fogság és a nagy próféták szava.",
  "Hazatérés": "A perzsa engedéllyel újjáépülő Jeruzsálem és a Templom.",
  "Makkabeus felkelés": "A görög uralom elleni harc és a Templom megújítása.",
  "Messiási közjáték": "Az evangéliumi olvasmányok, amelyek Krisztusra mutatnak.",
  "Messiási beteljesedés": "Jézus Krisztus élete, halála és feltámadása Lukács szerint.",
  "Az Egyház": "Az apostolok tanúságtétele, az első keresztény közösségek és a levelek.",
};

interface PlanRow {
  day: number;
  readings: string[];
  readings_display: string;
  period_hu: string;
  period_en: string;
}

async function generateReflection(plan: PlanRow, apiKey: string): Promise<string> {
  const prompt = `Írj egy 350–450 szavas magyar nyelvű lelki elmélkedést a katolikus "Biblia egy év alatt" podcast ${plan.day}. napjához.

A mai szentírási olvasmányok: ${plan.readings_display}
Az üdvösségtörténet korszaka: ${plan.period_hu}

Elvárások:
- Semleges, szerkesztőségi hangvétel (NEM Fábry Kornél nevében írsz).
- Ne kezdd megszólítással ("Kedves testvéreim", "Kedves hallgató" stb.).
- Első bekezdés: mit tartalmaznak a mai olvasmányok — röviden, saját szavakkal, forrás megnevezése nélküli tényleíráshoz közel.
- Második bekezdés: hogyan illeszkedik ez a "${plan.period_hu}" korszakba és az üdvösségtörténet nagy ívébe.
- Harmadik bekezdés: egy-két kortárs (2026-os magyar valóságra utaló, de politikamentes) alkalmazás — pl. bizalom, kitartás, megbocsátás, közösség.
- NE idézd szó szerint a Bibliát (jogi okból). Csak utalj rá.
- NE használj bullet pointokat vagy címeket. Folyó szöveg, 3 bekezdésben.
- Ne ígérj hangfájlt, ne említsd hogy "ma este 01:00-kor" — azt máshol írjuk.`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
    },
    body: JSON.stringify({
      model: "google/gemini-3.5-flash",
      messages: [
        { role: "system", content: "Katolikus lelki írások szerkesztője vagy. Magyarul, tisztán, mértékkel írsz. Egyetemi hittanári stílus, prédikációmentes." },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`AI gateway ${res.status}: ${t.slice(0, 300)}`);
  }
  const j = await res.json();
  return String(j?.choices?.[0]?.message?.content || "").trim();
}

function buildBody(plan: PlanRow, reflection: string): { html: string; plain: string; seo: string } {
  const intro = PERIOD_INTRO[plan.period_hu] || "";
  const html =
    `<p><strong>${plan.day}. nap – Fábry Kornél napi biblia elmélkedése.</strong> ` +
    `Olvasd el most az elmélkedést és a mai szentírási szakaszokat — a hangfelvétel néhány óra múlva itt hallgatható lesz.</p>` +
    `<p><strong>Korszak:</strong> ${plan.period_hu} — ${intro}</p>` +
    `<p><strong>Napi olvasmány:</strong> ${plan.readings_display} (Szent István Társulat fordítása szerint).</p>` +
    reflection.split(/\n{2,}/).map((p) => `<p>${p.trim()}</p>`).join("") +
    `<p><em>A hangfelvétel automatikusan megjelenik ezen az oldalon, amint elérhetővé válik — érdemes visszatérni, vagy feliratkozni az értesítésre.</em></p>`;

  const plain =
    `${plan.day}. nap – Fábry Kornél napi biblia elmélkedése. Olvasd el most; a hangfelvétel hamarosan itt hallgatható lesz.\n\n` +
    `Korszak: ${plan.period_hu} — ${intro}\n\n` +
    `Napi olvasmány: ${plan.readings_display} (Szent István Társulat fordítása).\n\n` +
    reflection +
    `\n\nA hangfelvétel automatikusan megjelenik ezen az oldalon, amint elérhetővé válik.`;

  const seo =
    `${plan.day}. nap: ${plan.readings_display}. ${plan.period_hu} korszak. Olvasd el a napi elmélkedést — a hangfelvétel hamarosan itt hallgatható.`
      .slice(0, 160);

  return { html, plain, seo };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const dryRun = body?.dry_run === true;
  const forcedDay = Number.isFinite(body?.day) ? Math.floor(body.day) : null;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // 1) Find highest existing day number for this podcast.
    const { data: recent } = await admin
      .from("episodes")
      .select("title, slug, guid, is_prefetch_placeholder")
      .eq("podcast_id", PODCAST_ID)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(30);

    const dayRe = /^\s*(\d{1,3})\.\s*nap\b/i;
    const highestDay = (recent || []).reduce((max, r: any) => {
      const m = String(r.title || "").match(dayRe);
      return m ? Math.max(max, parseInt(m[1], 10)) : max;
    }, 0);
    const nextDay = forcedDay ?? highestDay + 1;
    if (!nextDay || nextDay < 1 || nextDay > 365) {
      return json({ ok: false, error: "invalid_next_day", highestDay, nextDay }, 400);
    }

    // 2) Skip if already exists (real or placeholder).
    const dayPrefix = `${nextDay}-nap`;
    const { data: existing } = await admin
      .from("episodes")
      .select("id, slug, is_prefetch_placeholder, audio_url")
      .eq("podcast_id", PODCAST_ID)
      .ilike("slug", `${dayPrefix}%`)
      .limit(5);
    if ((existing || []).length > 0) {
      return json({
        ok: true, skipped: true, reason: "already_exists", nextDay,
        existing: (existing || []).map((r: any) => ({ slug: r.slug, is_placeholder: r.is_prefetch_placeholder, has_audio: !!r.audio_url })),
      });
    }

    // 3) Fetch reading plan row.
    const { data: planRow, error: planErr } = await admin
      .from("bible_reading_plan")
      .select("day, readings, readings_display, period_hu, period_en")
      .eq("day", nextDay)
      .maybeSingle();
    if (planErr) throw planErr;
    if (!planRow) return json({ ok: false, error: "no_plan_row", nextDay }, 500);
    const plan = planRow as PlanRow;

    // 4) AI reflection.
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return json({ ok: false, error: "missing_LOVABLE_API_KEY" }, 500);
    const reflection = await generateReflection(plan, apiKey);

    // 5) Compose body.
    const { html, plain, seo } = buildBody(plan, reflection);
    const title = `${nextDay}. nap: Fábry Kornél napi biblia elmélkedése — ${plan.readings_display}`;
    const displayTitle = `${nextDay}. nap – ma este 01:00-kor érkezik`;

    const now = new Date().toISOString();
    const row = {
      podcast_id: PODCAST_ID,
      title,
      display_title: displayTitle,
      slug: dayPrefix,
      description: html,
      summary: plain,
      ai_summary: plain,
      ai_summary_source: "prefetch_bible_plan_v1",
      seo_description: seo,
      published_at: now,
      audio_url: null,
      guid: `prefetch-bible-${nextDay}`,
      is_prefetch_placeholder: true,
      detected_language: "hu",
      clean_text_status: "skipped",
      topic_extraction_status: "skipped",
    };

    if (dryRun) return json({ ok: true, dry_run: true, nextDay, plan, row });

    const { data: inserted, error: insErr } = await admin
      .from("episodes")
      .insert(row)
      .select("id, slug")
      .single();
    if (insErr) throw insErr;

    // 6) Fire instant-index pings.
    const episodeUrl = `${SITE}/podcast/${PODCAST_SLUG}/${inserted.slug}`;
    const pings = await Promise.allSettled([
      admin.functions.invoke("google-indexing-submit", { body: { urls: [episodeUrl] } }),
      admin.functions.invoke("indexnow-submit", { body: { urls: [episodeUrl] } }),
      admin.functions.invoke("refresh-sitemap", { body: { type: "episodes" } }),
    ]);
    const pingErrors = pings
      .map((r, i) => r.status === "rejected" ? { i, err: String((r as PromiseRejectedResult).reason).slice(0, 200) } : null)
      .filter(Boolean);

    return json({
      ok: true, nextDay, episode_id: inserted.id, episode_url: episodeUrl,
      readings: plan.readings_display, period: plan.period_hu,
      reflection_chars: reflection.length,
      pinged: true, ping_errors: pingErrors,
    });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
