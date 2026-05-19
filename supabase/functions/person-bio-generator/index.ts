// Hungarian AI bio + overview generator for People
// Uses Lovable AI Gateway (google/gemini-2.5-flash). Strict no-hallucination prompts.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { chatTokenCostUsd } from "../_shared/ai-pricing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const MODEL = "google/gemini-2.5-flash";

async function callAI(system: string, user: string): Promise<{ text: string; cost: number; ok: boolean; error?: string }> {
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${LOVABLE_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.3,
    }),
  });
  if (!r.ok) {
    return { text: "", cost: 0, ok: false, error: `ai_${r.status}` };
  }
  const j = await r.json();
  const text = j?.choices?.[0]?.message?.content || "";
  const inTok = j?.usage?.prompt_tokens || 0;
  const outTok = j?.usage?.completion_tokens || 0;
  const cost = chatTokenCostUsd(MODEL, Number(inTok || 0), Number(outTok || 0));
  return { text: text.trim(), cost, ok: true };
}

function safeFallbackBio(name: string): string {
  return `${name} magyar podcast epizódokban előforduló személy. Az alábbi epizódokban kapcsolódó beszélgetések, interjúk vagy említések találhatók.`;
}

function pickOverviewStyleLine(host: number, guest: number, subject: number, mentioned: number): string {
  if (host > 0 && host >= guest && host >= subject) return "host";
  if (guest > 0 && guest >= subject) return "guest";
  if (subject > 0 && subject >= mentioned) return "subject";
  return "mentioned";
}

async function processPerson(admin: any, personId: string, opts: { force?: boolean }): Promise<any> {
  const { data: p } = await admin.from("people").select("*").eq("id", personId).maybeSingle();
  if (!p) return { id: personId, skipped: "not_found" };
  // Activation/review gate
  if (!p.is_public || p.activation_status === "inactive") return { id: personId, skipped: "inactive" };
  if (["hide","reject","merge"].includes(p.ai_recommended_action || "")) return { id: personId, skipped: "ai_blocked" };
  if (["needs_human_review","duplicate_candidate"].includes(p.ai_review_status || "")) return { id: personId, skipped: "review_pending" };

  if (!opts.force && p.ai_bio_status === "completed" && p.ai_bio && p.overview_text) {
    return { id: personId, skipped: "already_done" };
  }

  const { data: aliases } = await admin.from("person_aliases").select("alias").eq("person_id", personId).limit(15);
  const { data: ppm } = await admin
    .from("person_podcast_map")
    .select("role, episode_count, podcasts!inner(id, title, is_hungarian, language_decision)")
    .eq("person_id", personId)
    .eq("podcasts.is_hungarian", true)
    .eq("podcasts.language_decision", "accept_hungarian")
    .limit(15);
  const { data: mentions } = await admin
    .from("person_episode_mentions")
    .select("mention_type, episodes!inner(id, title, ai_summary, summary, podcasts!inner(is_hungarian, language_decision))")
    .eq("person_id", personId)
    .eq("episodes.podcasts.is_hungarian", true)
    .eq("episodes.podcasts.language_decision", "accept_hungarian")
    .limit(50);

  const epList = (mentions || []).map((m: any) => ({
    id: m.episodes?.id,
    title: m.episodes?.title,
    summary: (m.episodes?.ai_summary || m.episodes?.summary || "").slice(0, 400),
    mention_type: m.mention_type,
  })).filter((e: any) => e.id);

  const tally = { host: 0, guest: 0, subject: 0, mentioned: 0 } as any;
  epList.forEach((e: any) => { tally[e.mention_type] = (tally[e.mention_type] || 0) + 1; });
  const styleHint = pickOverviewStyleLine(tally.host, tally.guest, tally.subject, tally.mentioned);
  const isHost = (ppm || []).some((r: any) => r.role === "host");

  const jobInsert = await admin.from("person_enrichment_jobs").insert({
    person_id: personId, job_type: "ai_bio_overview", status: "running", started_at: new Date().toISOString(),
    input_snapshot: { ep_count: epList.length, tally, has_wiki: !!p.wikipedia_extract, wiki_status: p.wikipedia_match_status },
  }).select("id").maybeSingle();
  const jobId = (jobInsert.data as any)?.id;

  try {
    const useWiki = p.wikipedia_match_status === "verified" && p.wikipedia_match_confidence >= 0.75 && (p.wikipedia_extract || p.wikipedia_description);
    const wikiBlob = useWiki
      ? `Wikipedia leírás: ${p.wikipedia_description || ""}\nWikipedia kivonat: ${(p.wikipedia_extract || "").slice(0, 800)}`
      : "Nincs ellenőrzött Wikipedia-forrás.";

    const bioSys = `Magyar nyelvű, neutrális, tényszerű életrajzot írsz egy podcast-katalógushoz.
SZABÁLYOK:
- KIZÁRÓLAG magyarul.
- 2-4 rövid mondat. Tömör.
- Csak akkor írj életrajzi tényt, ha Wikipedia/Wikidata forrásból igazolt.
- Ha nincs ellenőrzött forrás, használd ezt a biztonságos sablont SZÓ SZERINT: "${safeFallbackBio(p.name)}"
- SOHA ne találj ki tényeket. Ne találgass nemzetiséget, foglalkozást, születési évet.
- Ne nevezd a személyt "műsorvezetőnek", csak ha a podcast adatok kifejezetten host szerepet jeleznek.
- Ne mondj olyat, hogy "vendégként szerepel" hacsak az nem egyértelmű.
- Ne használj reklámszerű, hype kifejezéseket.
- Csak a bio szövegét add vissza, semmi mást.`;

    const bioUser = `Személy neve: ${p.name}
Alias-ok: ${(aliases || []).map((a: any) => a.alias).join(", ") || "—"}
Wikipedia státusz: ${p.wikipedia_match_status} (konfidencia: ${p.wikipedia_match_confidence})
${wikiBlob}

Podiverzum kontextus:
- Magyar podcastokban szerepel/említik: ${(ppm || []).length} műsor
- Host szerep ezekben: ${isHost ? "igen" : "nem"}
- Indexelt epizódok száma: ${epList.length}
- Megjelenések típusa: host=${tally.host}, guest=${tally.guest}, subject=${tally.subject}, mentioned=${tally.mentioned}

Írd meg a bio-t a fenti szabályok szerint.`;

    const overviewSys = `Magyar nyelvű, neutrális összefoglalót írsz arról, MIT tárgyalnak a podcast epizódok ${p.name} kapcsán.
SZABÁLYOK:
- KIZÁRÓLAG magyarul.
- 2-4 mondat.
- Csak az alább megadott epizód-címek és -leírások alapján.
- SOHA ne állítsd, hogy a személy személyesen szerepel, hacsak a megjelenés-típus host vagy guest.
- Style hint: "${styleHint}".
  - host: kezdd valami olyannal, hogy "Műsorvezetőként ezekben a beszélgetésekben…"
  - guest: "Azokban az epizódokban, amelyekben vendégként szerepel…"
  - subject: "A róla szóló epizódok…"
  - mentioned: "A róla szóló vagy őt említő epizódok…"
- Ne találgass. Ne ismételd a bio-t.
- Csak az összefoglaló szövegét add vissza.`;

    const epBlob = epList.slice(0, 25).map((e: any, i: number) => `${i + 1}. [${e.mention_type}] ${e.title}\n   ${e.summary}`).join("\n");
    const overviewUser = `Személy: ${p.name}\nEpizódok (összesen ${epList.length}, ${tally.host} host, ${tally.guest} guest, ${tally.subject} subject, ${tally.mentioned} mentioned):\n${epBlob || "—"}`;

    let bio = "";
    let bioCost = 0;
    let overview = "";
    let overviewCost = 0;
    let bioStatus = "completed";

    if (epList.length === 0 && !useWiki) {
      bio = safeFallbackBio(p.name);
      overview = `A ${p.name} kapcsán jelenleg nincs elegendő indexelt magyar podcast epizód.`;
      bioStatus = "needs_review";
    } else {
      const [b, o] = await Promise.all([
        callAI(bioSys, bioUser),
        callAI(overviewSys, overviewUser),
      ]);
      if (b.ok) { bio = b.text; bioCost = b.cost; } else { bio = safeFallbackBio(p.name); bioStatus = "needs_review"; }
      if (o.ok) { overview = o.text; overviewCost = o.cost; } else { overview = ""; }
      if (!useWiki) bioStatus = bio === safeFallbackBio(p.name) ? "needs_review" : (epList.length < 3 ? "needs_review" : "completed");
    }

    const sources = {
      wikipedia: useWiki ? { qid: p.wikidata_id, title: p.wikipedia_title, confidence: p.wikipedia_match_confidence } : null,
      episode_ids: epList.map((e: any) => e.id),
      podcast_ids: (ppm || []).map((r: any) => r.podcasts?.id).filter(Boolean),
      confidence: useWiki ? 0.9 : (epList.length >= 5 ? 0.6 : 0.4),
      mention_tally: tally,
    };

    const totalCost = bioCost + overviewCost;
    const update = {
      ai_bio: bio,
      short_bio: bio,
      ai_bio_status: bioStatus,
      ai_bio_generated_at: new Date().toISOString(),
      ai_bio_model: MODEL,
      ai_bio_sources: sources,
      ai_bio_confidence: sources.confidence,
      overview_text: overview || null,
      overview_generated_at: overview ? new Date().toISOString() : null,
      overview_sources: sources,
    };
    await admin.from("people").update(update).eq("id", personId);

    // Spend tracking
    try {
      const today = new Date().toISOString().slice(0, 10);
      const { data: spend } = await admin.from("ai_spend_daily").select("*").eq("day", today).maybeSingle();
      const byKind = (spend?.by_kind as any) || {};
      byKind.person_bio = (Number(byKind.person_bio || 0) + totalCost);
      await admin.from("ai_spend_daily").upsert({
        day: today,
        spend_usd: Number(spend?.spend_usd || 0) + totalCost,
        calls: Number(spend?.calls || 0) + 2,
        by_kind: byKind,
        updated_at: new Date().toISOString(),
      });
    } catch { /* ignore */ }

    if (jobId) await admin.from("person_enrichment_jobs").update({
      status: bioStatus === "needs_review" ? "needs_review" : "completed",
      finished_at: new Date().toISOString(),
      output_snapshot: { bio_len: bio.length, overview_len: overview.length, cost_usd: totalCost, sources },
    }).eq("id", jobId);

    return { id: personId, status: bioStatus, cost_usd: totalCost };
  } catch (e: any) {
    if (jobId) await admin.from("person_enrichment_jobs").update({
      status: "failed", error_message: String(e?.message || e), finished_at: new Date().toISOString(),
    }).eq("id", jobId);
    return { id: personId, error: String(e?.message || e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const body = await req.json().catch(() => ({}));
  const limit = Math.min(Number(body.limit || 30), 300);
  const force = !!body.force;
  const personIds: string[] = Array.isArray(body.person_ids) ? body.person_ids : [];

  // Daily budget cap
  const budget = Number(body.daily_budget_usd || 3);
  const today = new Date().toISOString().slice(0, 10);
  const { data: spend } = await admin.from("ai_spend_daily").select("by_kind").eq("day", today).maybeSingle();
  const spentToday = Number(((spend?.by_kind as any) || {}).person_bio || 0);
  if (spentToday >= budget && !body.ignore_budget) {
    return new Response(JSON.stringify({ paused: "budget_reached", spent_today: spentToday, budget }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let ids: string[] = personIds;
  if (ids.length === 0) {
    // Eligibility: is_public + (is_indexable OR episode_count>=3 OR (podcast_count>=1 AND host) OR strong_mention_count>=2)
    const { data } = await admin
      .from("people")
      .select("id, episode_count, podcast_count, strong_mention_count, latest_episode_at, is_indexable, ai_bio_status, activation_status, ai_recommended_action, ai_review_status")
      .eq("is_public", true)
      .in("activation_status", ["indexable","manual_approved"])
      .or("is_indexable.eq.true,episode_count.gte.3,strong_mention_count.gte.2")
      .order("episode_count", { ascending: false })
      .order("strong_mention_count", { ascending: false })
      .order("podcast_count", { ascending: false })
      .order("latest_episode_at", { ascending: false, nullsFirst: false })
      .limit(limit * 3);
    const filtered = (data || []).filter((r: any) =>
      (force || r.ai_bio_status !== "completed") &&
      !["hide","reject","merge"].includes(r.ai_recommended_action || "") &&
      !["needs_human_review","duplicate_candidate"].includes(r.ai_review_status || "")
    ).slice(0, limit);
    ids = filtered.map((r: any) => r.id);
  }

  const results: any[] = [];
  for (const id of ids) {
    const r = await processPerson(admin, id, { force });
    results.push(r);
    await new Promise(res => setTimeout(res, 100));
  }

  return new Response(JSON.stringify({ processed: results.length, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
