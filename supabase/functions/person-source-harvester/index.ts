// person-source-harvester
// Collects trusted external biographical sources for people (hosts + guests),
// scrapes them via Firecrawl, and runs an AI name-match gate before publishing.
// Writes to public.person_external_sources; the bio-generator consumes verified rows.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callLovableAI } from "../_shared/lovable-ai.ts";
import { chatTokenCostUsd } from "../_shared/ai-pricing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FIRECRAWL_KEY = Deno.env.get("FIRECRAWL_API_KEY") || "";
const NAME_MATCH_MODEL = "google/gemini-2.5-flash-lite";
const FIRECRAWL_COST_ESTIMATE = 0.002; // conservative per scrape

type Controls = {
  enabled: boolean;
  dry_run: boolean;
  budget_usd_daily: number;
  batch_size: number;
  concurrency: number;
  publish_confidence_min: number;
  draft_confidence_min: number;
  rescrape_days: number;
  max_attempts: number;
  source_types_enabled: string[];
  blocked_domains: string[];
};

async function getControls(sb: any): Promise<Controls> {
  const { data } = await sb.from("app_settings").select("value").eq("key", "person_source_harvester_controls").maybeSingle();
  const v = (data?.value || {}) as any;
  return {
    enabled: !!v.enabled,
    dry_run: v.dry_run !== false,
    budget_usd_daily: Number(v.budget_usd_daily ?? 2),
    batch_size: Number(v.batch_size ?? 15),
    concurrency: Number(v.concurrency ?? 3),
    publish_confidence_min: Number(v.publish_confidence_min ?? 0.8),
    draft_confidence_min: Number(v.draft_confidence_min ?? 0.5),
    rescrape_days: Number(v.rescrape_days ?? 90),
    max_attempts: Number(v.max_attempts ?? 3),
    source_types_enabled: Array.isArray(v.source_types_enabled) ? v.source_types_enabled : ["podcast_website","episode_desc_url","rss_owner","podcast_desc"],
    blocked_domains: Array.isArray(v.blocked_domains) ? v.blocked_domains.map((s: string) => s.toLowerCase()) : [],
  };
}

async function todaySpend(sb: any): Promise<number> {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data } = await sb
    .from("person_external_sources")
    .select("firecrawl_cost, ai_cost")
    .gte("updated_at", since);
  return (data || []).reduce((s: number, r: any) => s + Number(r.firecrawl_cost || 0) + Number(r.ai_cost || 0), 0);
}

function normalizeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let u = String(raw).trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  try {
    const parsed = new URL(u);
    parsed.hash = "";
    parsed.search = ""; // strip UTM + tracking
    let out = parsed.toString();
    if (out.endsWith("/") && parsed.pathname === "/") out = out.slice(0, -1);
    return out;
  } catch {
    return null;
  }
}

function domainOf(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; }
}

function isBlockedDomain(url: string, blocked: string[]): boolean {
  const d = domainOf(url);
  if (!d) return true;
  return blocked.some((b) => d === b || d.endsWith("." + b));
}

function extractUrlsFromText(text: string, blocked: string[]): string[] {
  if (!text) return [];
  const re = /https?:\/\/[^\s)<>"']+/g;
  const found = new Set<string>();
  for (const m of text.matchAll(re)) {
    const clean = normalizeUrl(m[0].replace(/[.,;:!?)]+$/, ""));
    if (!clean) continue;
    if (isBlockedDomain(clean, blocked)) continue;
    found.add(clean);
  }
  return Array.from(found);
}

async function firecrawlScrape(url: string): Promise<{ markdown: string | null; title: string | null; status: number | null }> {
  if (!FIRECRAWL_KEY) throw new Error("FIRECRAWL_API_KEY not configured");
  try {
    const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { "Authorization": `Bearer ${FIRECRAWL_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, waitFor: 800 }),
    });
    if (!res.ok) {
      console.warn(`firecrawl ${url} -> ${res.status}`);
      return { markdown: null, title: null, status: res.status };
    }
    const data = await res.json();
    const md = data?.data?.markdown || data?.markdown || null;
    const title = data?.data?.metadata?.title || data?.metadata?.title || null;
    return { markdown: md, title, status: 200 };
  } catch (e: any) {
    console.error("firecrawl_error", e?.message);
    return { markdown: null, title: null, status: null };
  }
}

async function nameMatchGate(personName: string, markdown: string, sourceUrl: string): Promise<{ score: number; reason: string; cost: number }> {
  const text = markdown.slice(0, 6000);
  const system = "You are a strict fact-checker. Given a person's name and web page text, decide if the page is ABOUT that specific person. Reply as JSON.";
  const user = `Person name (Hungarian): ${personName}
Source URL: ${sourceUrl}

Rules:
- Return score in [0,1]. 1.0 = the entire page is a bio/about-page of exactly this person. 0.5 = mentions them but page is about something else. 0.0 = different person / not about them.
- If the name appears but the page is about a different person with the same name (different profession, wrong context), return < 0.3.
- If the page is a homepage of an organization the person leads AND their name+bio appears clearly, 0.7-0.9.
- Reason: 1 short sentence in English.

PAGE TEXT (markdown, truncated):
${text}

Reply with JSON: {"score": number, "reason": string}`;
  try {
    const ai = await callLovableAI({
      model: NAME_MATCH_MODEL,
      job_type: "person_source_name_match",
      target_type: "person",
      prompt_version: "name-match-v1",
      input_text: user,
      min_input_chars: 100,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.1,
    });
    if (!ai.ok) return { score: 0, reason: `ai_error:${ai.error || ai.status}`, cost: 0 };
    const raw = (ai.text || "").trim().replace(/^```json\s*|\s*```$/g, "").trim();
    let parsed: any = null;
    try { parsed = JSON.parse(raw); } catch {
      const m = raw.match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
    }
    const score = Math.max(0, Math.min(1, Number(parsed?.score) || 0));
    const reason = String(parsed?.reason || "no_reason").slice(0, 300);
    const cost = chatTokenCostUsd(NAME_MATCH_MODEL, ai.input_tokens || 0, ai.output_tokens || 0) || 0;
    return { score, reason, cost };
  } catch (e: any) {
    return { score: 0, reason: `exception:${e?.message?.slice(0,200) || "?"}`, cost: 0 };
  }
}

type Candidate = {
  person_id: string;
  person_name: string;
  source_type: string;
  source_url: string;
  podcast_id: string | null;
  episode_id: string | null;
  trust_score: number;
};

// -------- Candidate sourcing --------

function isEligibleUrl(u: string | null | undefined, blocked: string[]): boolean {
  if (!u) return false;
  const clean = normalizeUrl(u);
  if (!clean) return false;
  if (isBlockedDomain(clean, blocked)) return false;
  // must be http(s), must have a domain with a dot
  const host = domainOf(clean);
  if (!host || !host.includes(".")) return false;
  // reject IP-only
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
  return true;
}

async function sourceHostCandidates(sb: any, blocked: string[], limit: number): Promise<Candidate[]> {
  const { data, error } = await sb.rpc("harvest_host_candidates", { p_limit: limit }).maybeSingle();
  if (error || !data) {
    // Fallback direct query if RPC not present
    const { data: rows } = await sb
      .from("people")
      .select("id, name, overview_text, person_podcast_map!inner(podcast_id, podcasts!inner(id, website_url))")
      .eq("is_public", true)
      .eq("is_indexable", true)
      .gt("host_count", 0)
      .limit(limit * 3);
    const out: Candidate[] = [];
    (rows || []).forEach((p: any) => {
      const bioLen = (p.overview_text || "").length;
      if (bioLen > 400) return;
      const maps = p.person_podcast_map || [];
      for (const m of maps) {
        const url = normalizeUrl(m?.podcasts?.website_url);
        if (!url || !isEligibleUrl(url, blocked)) continue;
        out.push({
          person_id: p.id, person_name: p.name,
          source_type: "podcast_website", source_url: url,
          podcast_id: m?.podcasts?.id || null, episode_id: null,
          trust_score: 0.85,
        });
      }
    });
    return out.slice(0, limit);
  }
  return (data as any) || [];
}

async function sourceEpisodeUrlCandidates(sb: any, blocked: string[], limit: number): Promise<Candidate[]> {
  // Find guest mentions where episode description contains external URLs
  const { data: rows } = await sb
    .from("person_episode_mentions")
    .select(`
      person_id,
      episode_id,
      podcast_id,
      mention_type,
      relevance_status,
      episodes!inner(id, description, podcast_id),
      people!inner(id, name, overview_text, is_public, is_indexable, host_count, persona)
    `)
    .in("relevance_status", ["accepted"])
    .in("mention_type", ["guest","subject","interviewee","speaker"])
    .not("episodes.description", "is", null)
    .limit(limit * 8);

  const out: Candidate[] = [];
  const seen = new Set<string>();
  (rows || []).forEach((r: any) => {
    const person = r.people; if (!person?.is_public || !person?.is_indexable) return;
    if ((person.overview_text || "").length > 400) return;
    if (person.persona === "historical") return;
    const desc = String(r.episodes?.description || "");
    if (!desc) return;
    const urls = extractUrlsFromText(desc, blocked);
    for (const u of urls.slice(0, 3)) {
      const k = `${person.id}|${u}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({
        person_id: person.id, person_name: person.name,
        source_type: "episode_desc_url", source_url: u,
        podcast_id: r.podcast_id, episode_id: r.episode_id,
        trust_score: 0.55,
      });
    }
  });
  return out.slice(0, limit);
}

async function filterAlreadyProcessed(sb: any, cands: Candidate[], rescrapeDays: number): Promise<Candidate[]> {
  if (cands.length === 0) return [];
  const keys = cands.map(c => c.person_id + "|" + c.source_url);
  const { data: existing } = await sb
    .from("person_external_sources")
    .select("person_id, source_url, status, attempt_count, updated_at")
    .in("person_id", cands.map(c => c.person_id));
  const map = new Map<string, any>();
  (existing || []).forEach((r: any) => map.set(r.person_id + "|" + r.source_url, r));
  const cutoff = Date.now() - rescrapeDays * 24 * 3600 * 1000;
  return cands.filter(c => {
    const row = map.get(c.person_id + "|" + c.source_url);
    if (!row) return true;
    if (row.status === "verified" || row.status === "rejected" || row.status === "name_mismatch") return false;
    if (row.attempt_count >= 3) return false;
    if (row.status === "draft" && new Date(row.updated_at).getTime() > cutoff) return false;
    return true;
  });
}

// -------- Processing --------

async function processCandidate(sb: any, c: Candidate, ctl: Controls, dry: boolean): Promise<{ ok: boolean; status: string; cost: number }> {
  const domain = domainOf(c.source_url);
  if (dry) {
    await sb.from("person_external_sources").upsert({
      person_id: c.person_id, source_url: c.source_url, source_domain: domain,
      source_type: c.source_type, podcast_id: c.podcast_id, episode_id: c.episode_id,
      trust_score: c.trust_score, status: "pending",
      last_attempt_at: new Date().toISOString(),
    }, { onConflict: "person_id,source_url" });
    return { ok: true, status: "dry_queued", cost: 0 };
  }

  const scrape = await firecrawlScrape(c.source_url);
  const firecrawlCost = FIRECRAWL_COST_ESTIMATE;
  if (!scrape.markdown) {
    await sb.from("person_external_sources").upsert({
      person_id: c.person_id, source_url: c.source_url, source_domain: domain,
      source_type: c.source_type, podcast_id: c.podcast_id, episode_id: c.episode_id,
      trust_score: c.trust_score, status: "scrape_failed",
      http_status: scrape.status, firecrawl_cost: firecrawlCost,
      last_attempt_at: new Date().toISOString(),
      attempt_count: 1,
      error: `scrape_failed:${scrape.status}`,
    }, { onConflict: "person_id,source_url" });
    return { ok: false, status: "scrape_failed", cost: firecrawlCost };
  }

  const match = await nameMatchGate(c.person_name, scrape.markdown, c.source_url);
  let status = "rejected";
  if (match.score >= ctl.publish_confidence_min) status = "verified";
  else if (match.score >= ctl.draft_confidence_min) status = "draft";
  else status = "name_mismatch";

  await sb.from("person_external_sources").upsert({
    person_id: c.person_id, source_url: c.source_url, source_domain: domain,
    source_type: c.source_type, podcast_id: c.podcast_id, episode_id: c.episode_id,
    scraped_at: new Date().toISOString(),
    scraped_text: scrape.markdown.slice(0, 8000),
    scraped_title: (scrape.title || "").slice(0, 300),
    content_length: scrape.markdown.length,
    name_match_score: match.score,
    name_match_reason: match.reason,
    name_match_model: NAME_MATCH_MODEL,
    trust_score: c.trust_score,
    status,
    http_status: 200,
    firecrawl_cost: firecrawlCost,
    ai_cost: match.cost,
    last_attempt_at: new Date().toISOString(),
    attempt_count: 1,
  }, { onConflict: "person_id,source_url" });

  return { ok: true, status, cost: firecrawlCost + match.cost };
}

async function runBatch(sb: any, opts: { limitPerType?: number; force?: boolean; dryOverride?: boolean } = {}): Promise<any> {
  const ctl = await getControls(sb);
  if (!ctl.enabled && !opts.force) {
    return { ok: false, error: "runner_disabled", ctl };
  }
  const spend = await todaySpend(sb);
  if (spend >= ctl.budget_usd_daily * 1.1) {
    return { ok: false, error: "budget_cap_hit", spend, cap: ctl.budget_usd_daily };
  }
  const dry = opts.dryOverride !== undefined ? opts.dryOverride : ctl.dry_run;

  const perType = opts.limitPerType || ctl.batch_size;
  const [hosts, guests] = await Promise.all([
    ctl.source_types_enabled.includes("podcast_website") ? sourceHostCandidates(sb, ctl.blocked_domains, perType) : Promise.resolve([]),
    ctl.source_types_enabled.includes("episode_desc_url") ? sourceEpisodeUrlCandidates(sb, ctl.blocked_domains, perType) : Promise.resolve([]),
  ]);
  const allRaw = [...hosts, ...guests];
  const all = await filterAlreadyProcessed(sb, allRaw, ctl.rescrape_days);

  const results: any[] = [];
  const chunks: Candidate[][] = [];
  for (let i = 0; i < all.length; i += ctl.concurrency) chunks.push(all.slice(i, i + ctl.concurrency));
  let totalCost = 0;
  for (const chunk of chunks) {
    const out = await Promise.all(chunk.map(c => processCandidate(sb, c, ctl, dry).catch(e => ({ ok: false, status: "exception", cost: 0, error: e?.message }))));
    out.forEach((r, i) => results.push({ ...chunk[i], ...r }));
    totalCost += out.reduce((s, r) => s + Number(r.cost || 0), 0);
    if (spend + totalCost >= ctl.budget_usd_daily * 1.1) break;
  }

  return {
    ok: true,
    dry_run: dry,
    processed: results.length,
    verified: results.filter(r => r.status === "verified").length,
    draft: results.filter(r => r.status === "draft").length,
    name_mismatch: results.filter(r => r.status === "name_mismatch").length,
    scrape_failed: results.filter(r => r.status === "scrape_failed").length,
    cost_usd: Number(totalCost.toFixed(4)),
    spend_today_usd: Number((spend + totalCost).toFixed(4)),
    budget_cap_usd: ctl.budget_usd_daily,
    sample: results.slice(0, 10),
  };
}

async function harvestForPerson(sb: any, personId: string, dry: boolean): Promise<any> {
  const ctl = await getControls(sb);
  const { data: p } = await sb
    .from("people").select("id, name, overview_text, is_public, persona").eq("id", personId).maybeSingle();
  if (!p) return { ok: false, error: "person_not_found" };

  // Collect all candidate URLs for this person
  const cands: Candidate[] = [];
  // 1) Podcast websites via person_podcast_map
  const { data: pmaps } = await sb
    .from("person_podcast_map")
    .select("podcast_id, podcasts!inner(id, website_url)")
    .eq("person_id", personId);
  (pmaps || []).forEach((m: any) => {
    const url = normalizeUrl(m?.podcasts?.website_url);
    if (url && isEligibleUrl(url, ctl.blocked_domains)) {
      cands.push({ person_id: p.id, person_name: p.name, source_type: "podcast_website", source_url: url, podcast_id: m?.podcasts?.id, episode_id: null, trust_score: 0.85 });
    }
  });
  // 2) Episode description URLs
  const { data: mentions } = await sb
    .from("person_episode_mentions")
    .select("episode_id, podcast_id, episodes!inner(id, description)")
    .eq("person_id", personId)
    .in("relevance_status", ["accepted"]);
  const seen = new Set<string>();
  (mentions || []).forEach((r: any) => {
    const desc = String(r.episodes?.description || "");
    const urls = extractUrlsFromText(desc, ctl.blocked_domains);
    for (const u of urls) {
      if (seen.has(u)) continue; seen.add(u);
      cands.push({ person_id: p.id, person_name: p.name, source_type: "episode_desc_url", source_url: u, podcast_id: r.podcast_id, episode_id: r.episode_id, trust_score: 0.55 });
    }
  });

  const filtered = await filterAlreadyProcessed(sb, cands, ctl.rescrape_days);
  const results: any[] = [];
  for (const c of filtered.slice(0, 8)) {
    const r = await processCandidate(sb, c, ctl, dry).catch(e => ({ ok: false, status: "exception", cost: 0, error: e?.message }));
    results.push({ ...c, ...r });
  }
  return { ok: true, person: p.name, dry_run: dry, candidates: cands.length, processed: results.length, results };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "harvest_person" && body.person_id) {
      const out = await harvestForPerson(sb, String(body.person_id), body.dry_run !== false);
      return new Response(JSON.stringify(out), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (body.action === "list_candidates") {
      const ctl = await getControls(sb);
      const [hosts, guests] = await Promise.all([
        sourceHostCandidates(sb, ctl.blocked_domains, body.limit || 20),
        sourceEpisodeUrlCandidates(sb, ctl.blocked_domains, body.limit || 20),
      ]);
      return new Response(JSON.stringify({ ok: true, hosts, guests }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const out = await runBatch(sb, { limitPerType: body.limit_per_type, force: !!body.force, dryOverride: typeof body.dry_run === "boolean" ? body.dry_run : undefined });
    return new Response(JSON.stringify(out), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("person-source-harvester error", e);
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
