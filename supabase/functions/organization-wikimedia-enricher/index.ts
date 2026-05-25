// Wikimedia/Wikidata matcher + logo cache for Organizations
// Mirrors person-wikimedia-enricher but tuned for org_type expectations.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const REUSABLE_LICENSES = [
  "cc0", "publicdomain", "public domain", "pd-", "pd ", "pdm", "no known copyright",
  "cc-by", "cc by", "cc-by-sa", "cc by-sa", "cc-by 4", "cc-by-2", "cc-by-3", "attribution",
  "trademark", "logo", // logos are typically fair-use-with-attribution
];
const BLOCKED_LICENSES = ["non-free", "nonfree", "all rights reserved", "fair use", "fairuse"];

function isReusableLicense(licenseShort: string | null, licenseUrl: string | null): boolean {
  const blob = ((licenseShort || "") + " " + (licenseUrl || "")).toLowerCase();
  if (BLOCKED_LICENSES.some(h => blob.includes(h))) return false;
  return REUSABLE_LICENSES.some(t => blob.includes(t));
}

// Expected Wikidata instance-of (P31) tokens per org_type. Any match → +signal.
// Lists are short and intentionally permissive; mismatch is a soft negative.
const EXPECTED_P31: Record<string, string[]> = {
  party: ["Q7278", "Q24649", "Q1062376"], // political party, political organization, faction
  company: ["Q4830453", "Q783794", "Q43229", "Q891723"], // business, company, organization, public company
  media: ["Q1110794", "Q11032", "Q15265344", "Q3950"], // news agency, newspaper, broadcaster, publisher
  radio_station: ["Q14350", "Q1474493"], // radio station, broadcaster
  institution: ["Q327333", "Q294163", "Q178706"], // government agency, public institution, institution
  ngo: ["Q163740", "Q79913", "Q4438121"], // NGO, charity, sports organization
  sport_team: ["Q12973014", "Q847017"], // sports team, sports club
  sport_league: ["Q623109", "Q15991303"], // sports league, league
  church: ["Q1530022", "Q1135595", "Q9174"], // religious organization, religious denomination, religion
  university: ["Q3918", "Q38723", "Q875538"], // university, higher education institution
  research: ["Q31855", "Q1664720", "Q484652"], // research institute, institute, international organization
  other: [],
};
// Disqualifiers
const HUMAN = "Q5";

async function searchWikidata(name: string, lang = "hu"): Promise<any[]> {
  const u = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=${lang}&uselang=${lang}&type=item&limit=5&format=json&origin=*`;
  try {
    const r = await fetch(u, { headers: { "User-Agent": "PodiverzumBot/1.0 (podiverzum.hu)" } });
    const j = await r.json();
    return j.search || [];
  } catch { return []; }
}

async function searchWikidataMulti(name: string): Promise<any[]> {
  const hu = await searchWikidata(name, "hu");
  const en = await searchWikidata(name, "en");
  const seen = new Set<string>();
  const out: any[] = [];
  for (const c of [...hu, ...en]) {
    if (!c?.id || seen.has(c.id)) continue;
    seen.add(c.id); out.push(c);
  }
  return out;
}

async function getWikidataEntity(qid: string): Promise<any | null> {
  try {
    const r = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`, { headers: { "User-Agent": "PodiverzumBot/1.0" } });
    const j = await r.json();
    return j.entities?.[qid] || null;
  } catch { return null; }
}

async function getCommonsImageInfo(filename: string): Promise<any | null> {
  const f = `File:${filename.replace(/^File:/, "")}`;
  const u = `https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=url|extmetadata|size&titles=${encodeURIComponent(f)}&format=json&origin=*&iiurlwidth=512`;
  try {
    const r = await fetch(u, { headers: { "User-Agent": "PodiverzumBot/1.0" } });
    const j = await r.json();
    const pages = j.query?.pages || {};
    const page: any = Object.values(pages)[0];
    return page?.imageinfo?.[0] || null;
  } catch { return null; }
}

async function getWikipediaSummary(title: string, lang = "hu"): Promise<any | null> {
  try {
    const r = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, { headers: { "User-Agent": "PodiverzumBot/1.0" } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function tokenize(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter(t => t.length > 2),
  );
}

function scoreCandidate(org: any, entity: any, summary: any): { score: number; evidence: any } {
  const evidence: any = { signals: [] };
  let score = 0;
  const ctxTokens = tokenize([
    org.name,
    ...(org.aliases || []),
    ...(org.podcast_titles || []),
    ...(org.episode_titles || []).slice(0, 10),
  ].join(" "));
  const desc = (entity?.descriptions?.hu?.value || entity?.descriptions?.en?.value || summary?.description || "").toLowerCase();
  const extract = (summary?.extract || "").toLowerCase();
  const haystack = `${desc} ${extract}`;
  const haystackTokens = tokenize(haystack);

  const labels = [entity?.labels?.hu?.value, entity?.labels?.en?.value].filter(Boolean);
  const nameLower = org.name.toLowerCase();
  if (labels.some((l: string) => l.toLowerCase() === nameLower)) {
    score += 0.35; evidence.signals.push("label_exact");
  } else if (labels.some((l: string) => l.toLowerCase().includes(nameLower))) {
    score += 0.15; evidence.signals.push("label_partial");
  }

  if (entity?.sitelinks?.huwiki) { score += 0.2; evidence.signals.push("huwiki"); }
  if (summary?.lang === "hu") { score += 0.1; evidence.signals.push("hu_summary"); }

  // P31 check vs org_type
  const claims = entity?.claims?.P31 || [];
  const p31Ids = claims.map((c: any) => c?.mainsnak?.datavalue?.value?.id).filter(Boolean);
  const expected = EXPECTED_P31[org.org_type] || [];
  if (p31Ids.includes(HUMAN)) {
    score -= 0.5; evidence.signals.push("is_human_penalty");
  } else if (expected.length && p31Ids.some((id: string) => expected.includes(id))) {
    score += 0.2; evidence.signals.push("p31_match");
  } else if (p31Ids.length > 0 && expected.length > 0) {
    score -= 0.05; evidence.signals.push("p31_no_match");
  }

  // context overlap
  let overlap = 0;
  for (const t of ctxTokens) if (haystackTokens.has(t)) overlap++;
  if (overlap >= 3) { score += 0.25; evidence.signals.push(`context_overlap_${overlap}`); }
  else if (overlap >= 1) { score += 0.1; evidence.signals.push(`context_overlap_${overlap}`); }

  // single-word name penalty (ambiguous)
  if (org.name.trim().split(/\s+/).length < 2 && org.name.length < 6) {
    score -= 0.15; evidence.signals.push("short_name_penalty");
  }

  evidence.description = desc.slice(0, 220);
  evidence.labels = labels;
  evidence.p31 = p31Ids.slice(0, 5);
  return { score: Math.max(0, Math.min(1, score)), evidence };
}

async function processOrg(admin: any, orgId: string): Promise<any> {
  const { data: o } = await admin.from("organizations").select("*").eq("id", orgId).maybeSingle();
  if (!o) return { skipped: "not_found" };
  if (!o.is_public) return { id: orgId, skipped: "not_public" };
  if (o.is_podcast_internal) return { id: orgId, skipped: "podcast_internal" };
  if (["hide", "reject", "merge"].includes(o.ai_recommended_action || "")) {
    return { id: orgId, skipped: "ai_blocked" };
  }

  // Context
  const { data: aliases } = await admin.from("organization_aliases").select("alias").eq("organization_id", orgId).limit(20);
  const { data: maps } = await admin
    .from("episode_organization_map")
    .select("episode_id, podcast_id, episodes!inner(title), podcasts(title)")
    .eq("organization_id", orgId)
    .limit(20);
  const ctx = {
    name: o.name,
    org_type: o.org_type,
    aliases: (aliases || []).map((a: any) => a.alias),
    podcast_titles: Array.from(new Set((maps || []).map((r: any) => r.podcasts?.title).filter(Boolean))),
    episode_titles: (maps || []).map((r: any) => r.episodes?.title).filter(Boolean),
  };

  try {
    const searched = await searchWikidataMulti(o.name);
    const candidates = o.wikidata_id
      ? [{ id: o.wikidata_id }, ...searched.filter((c: any) => c?.id !== o.wikidata_id)]
      : searched;

    let best: any = null;
    let bestScore = 0;
    let bestEvidence: any = {};
    let bestEntity: any = null;
    let bestSummary: any = null;

    for (const c of candidates.slice(0, 5)) {
      const ent = await getWikidataEntity(c.id);
      if (!ent) continue;
      const huTitle = ent?.sitelinks?.huwiki?.title || null;
      const enTitle = ent?.sitelinks?.enwiki?.title || null;
      const summary = huTitle ? await getWikipediaSummary(huTitle, "hu")
                              : (enTitle ? await getWikipediaSummary(enTitle, "en") : null);
      const { score, evidence } = scoreCandidate(ctx, ent, summary);
      if (score > bestScore) {
        best = c; bestScore = score; bestEvidence = evidence; bestEntity = ent; bestSummary = summary;
      }
    }

    const wasVerifiedSame = o.wikipedia_match_status === "verified" && o.wikidata_id && best?.id === o.wikidata_id;
    const matchStatus = wasVerifiedSame ? "verified"
      : bestScore >= 0.65 ? "verified"
      : bestScore >= 0.4 ? "needs_review"
      : "no_match";

    const update: any = {
      wikipedia_match_status: matchStatus,
      wikipedia_match_confidence: bestScore,
      wikipedia_match_evidence: { ...bestEvidence, qid: best?.id || null },
      wiki_match_run_at: new Date().toISOString(),
      wiki_match_reason: `org_wikimedia:${matchStatus}:${bestScore.toFixed(2)}:${(bestEvidence?.signals || []).join(",").slice(0, 180)}`,
    };

    if (bestEntity) {
      const huTitle = bestEntity?.sitelinks?.huwiki?.title || null;
      const enTitle = bestEntity?.sitelinks?.enwiki?.title || null;
      update.wikidata_id = best.id;
      update.wikipedia_title = huTitle || enTitle || null;
      update.wikipedia_url = huTitle ? `https://hu.wikipedia.org/wiki/${encodeURIComponent(huTitle.replace(/ /g, "_"))}`
                          : enTitle ? `https://en.wikipedia.org/wiki/${encodeURIComponent(enTitle.replace(/ /g, "_"))}`
                          : null;
      update.wikipedia_extract = bestSummary?.extract?.slice(0, 1200) || null;
      update.wikipedia_description = bestSummary?.description || bestEntity?.descriptions?.hu?.value || bestEntity?.descriptions?.en?.value || null;
    }

    // Logo cache for verified only — prefer P154 (logo), fallback P18 (image)
    if (matchStatus === "verified" && bestEntity && !o.logo_url) {
      const p154 = bestEntity?.claims?.P154?.[0]?.mainsnak?.datavalue?.value;
      const p18 = bestEntity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
      const filename = p154 || p18 || null;
      if (filename) {
        const imgInfo = await getCommonsImageInfo(filename);
        const meta = imgInfo?.extmetadata || {};
        const licenseShort = meta?.LicenseShortName?.value || null;
        const licenseUrl = meta?.LicenseUrl?.value || null;
        const author = meta?.Artist?.value?.replace(/<[^>]+>/g, "").trim() || null;
        const attribution = meta?.Attribution?.value?.replace(/<[^>]+>/g, "").trim() || author || null;

        if (imgInfo?.url && (isReusableLicense(licenseShort, licenseUrl) || p154)) {
          // For logos (P154), we cache even with permissive license; for P18 only reusable
          try {
            const imgResp = await fetch(imgInfo.thumburl || imgInfo.url, { headers: { "User-Agent": "PodiverzumBot/1.0" } });
            if (imgResp.ok) {
              const bytes = new Uint8Array(await imgResp.arrayBuffer());
              const ext = (imgInfo.url.split(".").pop() || "png").toLowerCase().split(/[?#]/)[0];
              const safeExt = ["jpg", "jpeg", "png", "webp", "svg", "gif"].includes(ext) ? ext : "png";
              const path = `organizations/${orgId}/logo.${safeExt}`;
              const contentType = imgResp.headers.get("content-type") || `image/${safeExt}`;
              const { error: upErr } = await admin.storage.from("entity-images").upload(path, bytes, { contentType, upsert: true });
              if (!upErr) {
                const { data: pub } = admin.storage.from("entity-images").getPublicUrl(path);
                update.logo_url = pub.publicUrl;
                update.logo_storage_path = path;
                update.logo_source = "wikimedia";
                update.logo_license = licenseShort;
                update.logo_attribution = attribution;
              }
            }
          } catch (_e) { /* swallow */ }
        }
      }
    }

    await admin.from("organizations").update(update).eq("id", orgId);

    return {
      id: orgId,
      name: o.name,
      match_status: matchStatus,
      confidence: bestScore,
      qid: best?.id || null,
      logo_cached: !!update.logo_url,
    };
  } catch (e: any) {
    return { id: orgId, error: String(e?.message || e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const body = await req.json().catch(() => ({}));
  const limit = Math.min(Number(body.limit || 25), 200);
  const orgIds: string[] = Array.isArray(body.organization_ids) ? body.organization_ids : [];

  // queue-health-controller pause respect.
  if (!body.force && orgIds.length === 0) {
    const { data: ctrlRow } = await admin.from("app_settings").select("value").eq("key", "organization_wikimedia_enricher_controls").maybeSingle();
    if (ctrlRow?.value && (ctrlRow.value as any).enabled === false) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "disabled_by_controls", auto_paused_reason: (ctrlRow.value as any).auto_paused_reason || null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }


  let ids: string[] = orgIds;
  if (ids.length === 0) {
    const staleCutoff = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
    // Bug fix: az .or() nested and() + ISO timestamp kombináció némán hibázik a Supabase JS-ben
    // (`:` és `+` karakterek). Bontsuk fel két query-re, aztán mergeljünk.
    const base = admin
      .from("organizations")
      .select("id, gated_episode_count, wikipedia_match_status, wiki_match_run_at, ai_recommended_action, is_podcast_internal")
      .eq("is_public", true)
      .eq("is_podcast_internal", false)
      .gte("gated_episode_count", 1)
      .order("gated_episode_count", { ascending: false })
      .limit(limit * 2);

    const { data: uncheckedRows, error: uncheckedErr } = await base.or(
      "wikipedia_match_status.eq.unchecked,wikipedia_match_status.is.null"
    );
    if (uncheckedErr) console.error("unchecked query error", uncheckedErr);

    let combined: any[] = uncheckedRows || [];
    if (combined.length < limit) {
      const { data: staleRows, error: staleErr } = await admin
        .from("organizations")
        .select("id, gated_episode_count, wikipedia_match_status, wiki_match_run_at, ai_recommended_action, is_podcast_internal")
        .eq("is_public", true)
        .eq("is_podcast_internal", false)
        .gte("gated_episode_count", 1)
        .eq("wikipedia_match_status", "no_match")
        .lt("wiki_match_run_at", staleCutoff)
        .order("gated_episode_count", { ascending: false })
        .limit(limit * 2);
      if (staleErr) console.error("stale query error", staleErr);
      combined = combined.concat(staleRows || []);
    }

    const filtered = combined.filter((r: any) =>
      !["hide", "reject", "merge"].includes(r.ai_recommended_action || "")
    ).slice(0, limit);
    ids = filtered.map((r: any) => r.id);
    console.log(`[org-wiki] candidates: unchecked=${uncheckedRows?.length || 0} combined=${combined.length} processing=${ids.length}`);
  }

  const results: any[] = [];
  for (const id of ids) {
    const r = await processOrg(admin, id);
    results.push(r);
    await new Promise(res => setTimeout(res, 250)); // be nice to wikimedia
  }

  return new Response(JSON.stringify({ processed: results.length, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
