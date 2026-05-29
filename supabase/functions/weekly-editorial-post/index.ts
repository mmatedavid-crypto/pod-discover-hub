// Weekly Editorial Post generator — HVG "Fülszöveg"-style curator's note.
// Picks 4-5 of the strongest Hungarian episodes from the last 7 days,
// asks a capped non-Pro model to write a magazine-style intro + per-episode mini-blocks
// with one strong quote each, and saves it as a draft in `editorial_posts`.
//
// POST body:
//   { dry_run?: boolean, force?: boolean, trigger?: string,
//     days?: number, limit?: number, post_id?: string (regenerate),
//     item_index?: number (regenerate single item) }
//
// Always returns the editorial JSON for admin review.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SITE_URL = "https://podiverzum.hu";
const LOVABLE_AI = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function tierWeight(label: string | null | undefined): number {
  switch (label) { case "S": return 100; case "A": return 70; case "B": return 35; default: return 5; }
}

function freshnessBoost(publishedAt: string | null | undefined): number {
  if (!publishedAt) return 0;
  const ageH = (Date.now() - new Date(publishedAt).getTime()) / 3_600_000;
  if (ageH < 48) return 40;
  if (ageH < 96) return 25;
  if (ageH < 24 * 7) return 10;
  return 0;
}

// Heuristic "claim density" score — counts numbers, named entities, questions, strong verbs.
function claimDensity(text: string): number {
  if (!text) return 0;
  let s = 0;
  // numbers / percentages
  s += Math.min(15, (text.match(/\d+([.,]\d+)?%?/g) || []).length * 3);
  // proper-noun-ish tokens (capitalized mid-sentence)
  s += Math.min(10, (text.match(/(?<=[.!?]\s|^)[A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű]+/g) || []).length);
  // questions
  s += Math.min(12, (text.match(/\?/g) || []).length * 4);
  // controversy / strong claim markers (HU)
  const markers = /(\bvitatja|\bállítja|\bmiért|\bhogyan|\bvajon|\bszerintem|\bnem igaz|\btévedés|\bvád|\bbotrány|\bválság|\brekord|\bváltozt|\bfordulat|\bvégre|\bmilliárd|\bmillió)/gi;
  s += Math.min(20, (text.match(markers) || []).length * 4);
  return s;
}

function entityBonus(ep: any): number {
  let s = 0;
  s += Math.min(15, ((ep.people || []).length) * 3);
  s += Math.min(10, ((ep.parties || []).length) * 4);
  s += Math.min(8, ((ep.companies || []).length) * 2);
  return s;
}

type Cand = {
  id: string;
  title: string;
  display_title: string | null;
  slug: string;
  published_at: string;
  ai_summary: string | null;
  description: string | null;
  summary: string | null;
  people: string[];
  parties: string[];
  companies: string[];
  topics: string[];
  podcast: { id: string; title: string; display_title: string | null; slug: string; rank_label: string | null; podiverzum_rank: number | null };
  _score: number;
};

async function pickEpisodes(admin: any, days: number, limit: number): Promise<Cand[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await admin
    .from("episodes")
    .select(`
      id, title, display_title, slug, published_at, ai_summary, description, summary,
      people, parties, companies, topics,
      podcasts!inner(id, title, display_title, slug, language, rank_label, podiverzum_rank)
    `)
    .gte("published_at", since)
    .in("podcasts.rank_label", ["S", "A"])
    .ilike("podcasts.language", "hu%")
    .not("ai_summary", "is", null)
    .order("published_at", { ascending: false })
    .limit(300);

  if (error) throw new Error(`episode query: ${error.message}`);

  const scored: Cand[] = (data || []).map((e: any) => {
    const text = `${e.ai_summary || ""} ${e.summary || ""} ${e.description || ""}`.slice(0, 4000);
    const score =
      tierWeight(e.podcasts?.rank_label) +
      freshnessBoost(e.published_at) +
      claimDensity(text) +
      entityBonus(e) +
      Math.min(10, Number(e.podcasts?.podiverzum_rank ?? 0));
    return { ...e, podcast: e.podcasts, _score: score };
  });

  scored.sort((a, b) => b._score - a._score);

  // Diversity: max 1 episode per podcast
  const seenPodcasts = new Set<string>();
  const picked: Cand[] = [];
  for (const c of scored) {
    if (seenPodcasts.has(c.podcast.id)) continue;
    seenPodcasts.add(c.podcast.id);
    picked.push(c);
    if (picked.length >= limit) break;
  }
  return picked;
}

function episodeUrl(ep: Cand): string {
  return `${SITE_URL}/podcast/${ep.podcast.slug}/epizod/${ep.slug}`;
}

function buildPrompt(eps: Cand[], weekLabel: string): { system: string; user: string } {
  const system = `Magyar szerkesztő vagy a Podiverzum.hu-nál. HVG-stílusú "Fülszöveg" heti podcastajánlót írsz Instagram/Facebook posztra.

Hangnem: szerkesztői, kicsit ironikus, intelligens, sosem szenzációhajhász. Konkrét állítások, nevek, számok. NINCS "ne hagyd ki!", "must-listen", "izgalmas beszélgetés" típusú közhely.

Felépítés:
1) intro — 2-3 mondat, megfogja az olvasót, ha van közös szál a heti epizódokban azt emeli ki, különben a hét hangulatát.
2) items[] — minden epizódra:
   - title: pontosan az adott epizód neve (NE módosítsd)
   - teaser: 2-3 mondat, MIRŐL szól és MIÉRT érdekes — konkrét állítás vagy kérdés a tartalomból. Sose írd hogy "interjú" vagy "beszélgetés" üres frázisként.
   - quote: 1 erős mondat IDÉZŐJEL nélkül, max 140 karakter. Lehet a vendég állítása parafrazálva, vagy egy provokatív összegzés a tartalomból. Soha ne idézz konkrétan ha nem biztos a forrás.

Magyarul írj. Ne használj emoji-kat a teaser-ben (intro-ban 1 oké). Ne hashtagelj.`;

  const epsBlock = eps.map((e, i) => {
    const podcast = e.podcast.display_title || e.podcast.title;
    const title = e.display_title || e.title;
    const summary = (e.ai_summary || e.summary || e.description || "").slice(0, 1200);
    const people = (e.people || []).slice(0, 5).join(", ");
    return `[${i + 1}] PODCAST: ${podcast}\nEPIZÓD: ${title}\nSZEREPLŐK: ${people || "—"}\nÖSSZEFOGLALÓ: ${summary}`;
  }).join("\n\n");

  const user = `Hét: ${weekLabel}\n\nEpizódok (sorrendben):\n\n${epsBlock}\n\nGenerálj editorial-t a megadott JSON sémába. Az items sorrendje legyen ugyanaz.`;

  return { system, user };
}

async function callAI(system: string, user: string, itemCount: number): Promise<{ intro: string; items: { title: string; teaser: string; quote: string }[] }> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY missing");

  const body = {
    model: MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    tools: [{
      type: "function",
      function: {
        name: "emit_editorial",
        description: "Emit weekly editorial copy",
        parameters: {
          type: "object",
          properties: {
            intro: { type: "string", description: "2-3 sentence Hungarian intro" },
            items: {
              type: "array",
              minItems: itemCount,
              maxItems: itemCount,
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  teaser: { type: "string" },
                  quote: { type: "string", maxLength: 160 },
                },
                required: ["title", "teaser", "quote"],
                additionalProperties: false,
              },
            },
          },
          required: ["intro", "items"],
          additionalProperties: false,
        },
      },
    }],
    tool_choice: { type: "function", function: { name: "emit_editorial" } },
  };

  const res = await fetch(LOVABLE_AI, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (res.status === 429) throw new Error("rate_limited");
  if (res.status === 402) throw new Error("payment_required");
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`AI error ${res.status}: ${t.slice(0, 300)}`);
  }

  const data = await res.json();
  const call = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!call?.function?.arguments) throw new Error("no tool call in AI response");
  return JSON.parse(call.function.arguments);
}

function weekRange(): { start: Date; end: Date; label: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 86_400_000);
  const fmt = (d: Date) => `${d.getUTCMonth() + 1}.${d.getUTCDate()}`;
  const months = ["jan", "feb", "márc", "ápr", "máj", "jún", "júl", "aug", "szept", "okt", "nov", "dec"];
  const label = `${months[start.getUTCMonth()]}. ${start.getUTCDate()}. – ${end.getUTCDate()}.`;
  return { start, end, label };
}

function buildCaptions(intro: string, items: { title: string; podcast_name: string; url: string; quote: string }[]): { ig: string; fb: string } {
  const fbLines = [
    `📰 A hét a Podiverzumon`,
    "",
    intro,
    "",
    ...items.map((it) => `▸ ${it.title} — ${it.podcast_name}\n  ${it.quote}\n  ${it.url}`),
    "",
    `Több: ${SITE_URL}`,
  ];
  const igLines = [
    `📰 A hét a Podiverzumon`,
    "",
    intro,
    "",
    ...items.map((it) => `▸ ${it.title} — ${it.podcast_name}`),
    "",
    `Linkek a bio-ban → ${SITE_URL}`,
    "",
    "#podcast #magyarpodcast #podiverzum",
  ];
  return { ig: igLines.join("\n"), fb: fbLines.join("\n") };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method === "GET") return json({ ok: true, function: "weekly-editorial-post" });

  // background-jobs kill switch
  try {
    const { checkBackgroundJobsAllowed } = await import("../_shared/incident-guard.ts");
    await checkBackgroundJobsAllowed();
  } catch (e: any) {
    if (String(e?.message || "").includes("disabled")) {
      return json({ ok: false, error: "background_jobs disabled" }, 503);
    }
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }

  const dryRun = body?.dry_run === true;
  const days = Math.max(1, Math.min(30, Number(body?.days ?? 7)));
  const limit = Math.max(3, Math.min(7, Number(body?.limit ?? 5)));

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const picked = await pickEpisodes(admin, days, limit);
    if (picked.length < 3) {
      return json({ ok: false, error: `not enough strong episodes (got ${picked.length})` }, 200);
    }

    const { start, end, label } = weekRange();
    const { system, user } = buildPrompt(picked, label);
    const ai = await callAI(system, user, picked.length);

    const items = picked.map((ep, i) => {
      const aiItem = ai.items[i] || { title: ep.display_title || ep.title, teaser: "", quote: "" };
      return {
        episode_id: ep.id,
        title: ep.display_title || ep.title,
        podcast_name: ep.podcast.display_title || ep.podcast.title,
        podcast_slug: ep.podcast.slug,
        episode_slug: ep.slug,
        url: episodeUrl(ep),
        teaser: aiItem.teaser,
        quote: aiItem.quote,
        cover_card_url: null as string | null,
        score: ep._score,
      };
    });

    const captions = buildCaptions(ai.intro, items);
    const title = `A hét a Podiverzumon — ${label}`;

    const payload = {
      week_start: start.toISOString().slice(0, 10),
      week_end: end.toISOString().slice(0, 10),
      status: "draft",
      title,
      intro: ai.intro,
      items,
      ig_caption: captions.ig,
      fb_caption: captions.fb,
      ai_model: MODEL,
      generation_meta: { picked: picked.length, days, scores: picked.map((p) => p._score) },
      trigger: body?.trigger || (dryRun ? "manual_preview" : "cron"),
    };

    if (dryRun && !body?.persist) {
      return json({ ok: true, dry_run: true, ...payload });
    }

    const { data: saved, error: insErr } = await admin
      .from("editorial_posts")
      .insert(payload)
      .select()
      .single();
    if (insErr) throw new Error(`save draft: ${insErr.message}`);

    return json({ ok: true, post_id: saved.id, ...payload });
  } catch (e: any) {
    console.error("weekly-editorial-post error:", e?.message);
    return json({ ok: false, error: e?.message || "unknown" }, 500);
  }
});
