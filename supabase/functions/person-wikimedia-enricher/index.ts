// Wikimedia/Wikidata matcher + image cache for People
// Matches person name against Wikidata, verifies via description + sitelinks,
// fetches commons image if license is reusable, caches to entity-images bucket.
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
];
const FAIR_USE_HINTS = ["fair use", "fairuse", "non-free", "nonfree", "all rights reserved"];

function isReusableLicense(licenseShort: string | null, licenseUrl: string | null): boolean {
  const blob = ((licenseShort || "") + " " + (licenseUrl || "")).toLowerCase();
  if (FAIR_USE_HINTS.some(h => blob.includes(h))) return false;
  return REUSABLE_LICENSES.some(t => blob.includes(t));
}

async function searchWikidata(name: string, lang = "hu"): Promise<any[]> {
  const u = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=${lang}&uselang=${lang}&type=item&limit=5&format=json&origin=*`;
  try {
    const r = await fetch(u, { headers: { "User-Agent": "PodiverzumBot/1.0 (podiverzum.hu)" } });
    const j = await r.json();
    return j.search || [];
  } catch { return []; }
}

async function searchWikidataMulti(name: string): Promise<any[]> {
  // HU first, then EN fallback. Dedupe by qid.
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
  const u = `https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=url|extmetadata|size&titles=${encodeURIComponent(f)}&format=json&origin=*&iiurlwidth=640`;
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

async function getWikipediaPageImage(title: string, lang = "hu"): Promise<{ filename: string | null; original: string | null } | null> {
  try {
    const u = new URL(`https://${lang}.wikipedia.org/w/api.php`);
    u.searchParams.set("action", "query");
    u.searchParams.set("format", "json");
    u.searchParams.set("origin", "*");
    u.searchParams.set("titles", title);
    u.searchParams.set("prop", "pageimages");
    u.searchParams.set("piprop", "name|original|thumbnail");
    u.searchParams.set("pithumbsize", "640");
    const r = await fetch(u.toString(), { headers: { "User-Agent": "PodiverzumBot/1.0" } });
    if (!r.ok) return null;
    const j = await r.json();
    const page: any = Object.values(j.query?.pages || {})[0];
    return {
      filename: page?.pageimage || null,
      original: page?.original?.source || page?.thumbnail?.source || null,
    };
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

function scoreCandidate(person: any, entity: any, summary: any): { score: number; evidence: any } {
  const evidence: any = { signals: [] };
  let score = 0;
  const personTokens = tokenize([person.name, ...(person.aliases || []), ...(person.podcast_titles || []), ...(person.episode_titles || []).slice(0, 10)].join(" "));
  const desc = (entity?.descriptions?.hu?.value || entity?.descriptions?.en?.value || summary?.description || "").toLowerCase();
  const extract = (summary?.extract || "").toLowerCase();
  const haystack = `${desc} ${extract}`;
  const haystackTokens = tokenize(haystack);

  // exact-name label match
  const labels = [entity?.labels?.hu?.value, entity?.labels?.en?.value].filter(Boolean);
  if (labels.some((l: string) => l.toLowerCase() === person.name.toLowerCase())) {
    score += 0.35; evidence.signals.push("label_exact");
  } else if (labels.some((l: string) => l.toLowerCase().includes(person.name.toLowerCase()))) {
    score += 0.15; evidence.signals.push("label_partial");
  }

  // Hungarian Wikipedia exists
  if (entity?.sitelinks?.huwiki) { score += 0.2; evidence.signals.push("huwiki"); }
  if (summary?.lang === "hu") { score += 0.1; evidence.signals.push("hu_summary"); }

  // is human
  const claims = entity?.claims?.P31 || [];
  const isHuman = claims.some((c: any) => c?.mainsnak?.datavalue?.value?.id === "Q5");
  if (isHuman) { score += 0.15; evidence.signals.push("instance_of_human"); }
  else if (claims.length > 0) { score -= 0.4; evidence.signals.push("not_human"); }

  // context overlap
  let overlap = 0;
  for (const t of personTokens) if (haystackTokens.has(t)) overlap++;
  if (overlap >= 3) { score += 0.25; evidence.signals.push(`context_overlap_${overlap}`); }
  else if (overlap >= 1) { score += 0.1; evidence.signals.push(`context_overlap_${overlap}`); }

  // first-name-only penalty
  if (person.name.trim().split(/\s+/).length < 2) {
    score -= 0.2; evidence.signals.push("single_name_penalty");
  }

  evidence.description = desc.slice(0, 220);
  evidence.labels = labels;
  return { score: Math.max(0, Math.min(1, score)), evidence };
}

async function processPerson(admin: any, personId: string): Promise<any> {
  const { data: p } = await admin.from("people").select("*").eq("id", personId).maybeSingle();
  if (!p) return { skipped: "not_found" };
  // Activation/review gate — do not waste enrichment on inactive/blocked people.
  if (!p.is_public || p.activation_status === "inactive") return { id: personId, skipped: "inactive" };
  if (["hide","reject","merge"].includes(p.ai_recommended_action || "")) return { id: personId, skipped: "ai_blocked" };
  if (["needs_human_review","duplicate_candidate"].includes(p.ai_review_status || "")) return { id: personId, skipped: "review_pending" };

  // gather context
  const { data: aliases } = await admin.from("person_aliases").select("alias").eq("person_id", personId).limit(20);
  const { data: ppm } = await admin.from("person_podcast_map").select("podcast_id, podcasts!inner(title)").eq("person_id", personId).limit(10);
  const { data: mentions } = await admin.from("person_episode_mentions").select("episode_id, episodes!inner(title)").eq("person_id", personId).limit(20);
  const personCtx = {
    name: p.name,
    aliases: (aliases || []).map((a: any) => a.alias),
    podcast_titles: (ppm || []).map((r: any) => r.podcasts?.title).filter(Boolean),
    episode_titles: (mentions || []).map((r: any) => r.episodes?.title).filter(Boolean),
  };

  const jobInsert = await admin.from("person_enrichment_jobs").insert({
    person_id: personId, job_type: "wikimedia", status: "running", started_at: new Date().toISOString(),
    input_snapshot: personCtx,
  }).select("id").maybeSingle();
  const jobId = (jobInsert.data as any)?.id;

  try {
    const searchedCandidates = await searchWikidataMulti(p.name);
    const candidates = p.wikidata_id
      ? [{ id: p.wikidata_id }, ...searchedCandidates.filter((c: any) => c?.id !== p.wikidata_id)]
      : searchedCandidates;
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
      const summary = huTitle ? await getWikipediaSummary(huTitle, "hu") : (enTitle ? await getWikipediaSummary(enTitle, "en") : null);
      const { score, evidence } = scoreCandidate(personCtx, ent, summary);
      if (score > bestScore) {
        best = c; bestScore = score; bestEvidence = evidence; bestEntity = ent; bestSummary = summary;
      }
    }

    // Relaxed thresholds (2026-05-21 Phase 2): verified 0.75→0.65, needs_review 0.5→0.4.
    // If this row was already manually/previously verified with a Wikidata id, image refreshes must not downgrade it.
    const wasVerifiedSameEntity = p.wikipedia_match_status === "verified" && p.wikidata_id && best?.id === p.wikidata_id;
    const matchStatus = wasVerifiedSameEntity ? "verified" : bestScore >= 0.65 ? "verified" : bestScore >= 0.4 ? "needs_review" : "no_match";
    const update: any = {
      wikipedia_match_status: matchStatus,
      wikipedia_match_confidence: bestScore,
      wikipedia_match_evidence: { ...bestEvidence, qid: best?.id || null },
      image_checked_at: new Date().toISOString(),
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

    // Image: only for verified
    let imageInfo: any = null;
    if (matchStatus === "verified" && bestEntity) {
      const huTitle = bestEntity?.sitelinks?.huwiki?.title || null;
      const enTitle = bestEntity?.sitelinks?.enwiki?.title || null;
      const summaryLang = huTitle ? "hu" : "en";
      const pageImage = (huTitle || enTitle) ? await getWikipediaPageImage(huTitle || enTitle, summaryLang) : null;
      const p18 = bestEntity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
      const summaryThumb = bestSummary?.originalimage?.source || bestSummary?.thumbnail?.source;
      const filename = p18 || pageImage?.filename || (summaryThumb || pageImage?.original ? decodeURIComponent((summaryThumb || pageImage?.original).split("/").slice(-1)[0]).replace(/^\d+px-/, "") : null);
      if (filename) {
        imageInfo = await getCommonsImageInfo(filename);
        const meta = imageInfo?.extmetadata || {};
        const licenseShort = meta?.LicenseShortName?.value || null;
        const licenseUrl = meta?.LicenseUrl?.value || null;
        const author = meta?.Artist?.value?.replace(/<[^>]+>/g, "").trim() || null;
        const attribution = meta?.Attribution?.value?.replace(/<[^>]+>/g, "").trim() || author || null;

        if (imageInfo?.url && isReusableLicense(licenseShort, licenseUrl)) {
          // Download image
          try {
            const imgResp = await fetch(imageInfo.thumburl || imageInfo.url, { headers: { "User-Agent": "PodiverzumBot/1.0" } });
            if (imgResp.ok) {
              const bytes = new Uint8Array(await imgResp.arrayBuffer());
              const ext = (imageInfo.url.split(".").pop() || "jpg").toLowerCase().split(/[?#]/)[0];
              const safeExt = ["jpg","jpeg","png","webp","gif"].includes(ext) ? ext : "jpg";
              const path = `people/${personId}/original.${safeExt}`;
              const contentType = imgResp.headers.get("content-type") || `image/${safeExt}`;
              const { error: upErr } = await admin.storage.from("entity-images").upload(path, bytes, { contentType, upsert: true });
              if (!upErr) {
                const { data: pub } = admin.storage.from("entity-images").getPublicUrl(path);
                update.image_storage_path = path;
                update.image_url = pub.publicUrl;
                update.image_source = "wikimedia";
                update.image_license = licenseShort;
                update.image_license_url = licenseUrl;
                update.image_author = author;
                update.image_attribution = attribution;
                update.image_original_url = imageInfo.url;
                update.image_status = "cached";
              } else {
                update.image_status = "failed";
              }
            } else {
              update.image_status = "failed";
            }
          } catch {
            update.image_status = "failed";
          }
        } else if (imageInfo?.url) {
          update.image_status = "needs_review";
          update.image_original_url = imageInfo.url;
          update.image_license = licenseShort;
        } else {
          update.image_status = "none";
        }
      } else {
        update.image_status = "none";
      }
    }

    await admin.from("people").update(update).eq("id", personId);
    if (jobId) await admin.from("person_enrichment_jobs").update({
      status: "completed", finished_at: new Date().toISOString(),
      output_snapshot: { confidence: bestScore, status: matchStatus, image_status: update.image_status, qid: best?.id || null },
    }).eq("id", jobId);

    return { id: personId, match_status: matchStatus, confidence: bestScore, image_status: update.image_status, qid: best?.id };
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
  const limit = Math.min(Number(body.limit || 50), 300);
  const personIds: string[] = Array.isArray(body.person_ids) ? body.person_ids : [];

  let ids: string[] = personIds;
  if (ids.length === 0) {
    // Priority 1: unchecked / null. Priority 2: stale no_match (>7d) for periodic revisit.
    const staleCutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const { data } = await admin
      .from("people")
      .select("id, episode_count, podcast_count, strong_mention_count, latest_episode_at, wikipedia_match_status, wiki_match_run_at, activation_status, ai_recommended_action, ai_review_status")
      .eq("is_public", true)
      .in("activation_status", ["indexable","manual_approved","public_noindex"])
      .or(`wikipedia_match_status.eq.unchecked,wikipedia_match_status.is.null,and(wikipedia_match_status.eq.no_match,wiki_match_run_at.lt.${staleCutoff}),and(wikipedia_match_status.eq.verified,image_url.is.null,image_status.in.(none,failed,unchecked))`)
      .order("episode_count", { ascending: false })
      .order("podcast_count", { ascending: false })
      .order("latest_episode_at", { ascending: false, nullsFirst: false })
      .limit(limit * 2);
    const filtered = (data || []).filter((r: any) =>
      !["hide","reject","merge"].includes(r.ai_recommended_action || "") &&
      !["needs_human_review","duplicate_candidate"].includes(r.ai_review_status || "")
    ).slice(0, limit);
    ids = filtered.map((r: any) => r.id);
  }

  const results: any[] = [];
  for (const id of ids) {
    const r = await processPerson(admin, id);
    results.push(r);
    await new Promise(res => setTimeout(res, 250)); // be nice to wikimedia
  }

  return new Response(JSON.stringify({ processed: results.length, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
