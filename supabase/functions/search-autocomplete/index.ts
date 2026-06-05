// search-autocomplete: rich typed typeahead for the global search box.
// POST { q: string, limit?: number } -> { suggestions: Suggestion[] }
// Suggestion = { type: 'podcast'|'person'|'topic'|'category'|'query',
//                label, subtitle?, href, image_url?, confidence }
//
// HU-only by design (the public site is HU-only). No PII logging, no cookies.
// Fast: 4 parallel ILIKE/trgm queries against indexed columns. No AI call,
// no cache table writes — purely read-only for stability.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Suggestion = {
  type: "podcast" | "person" | "topic" | "category" | "organization" | "query";
  label: string;
  subtitle?: string;
  href: string;
  image_url?: string | null;
  confidence: number;
};

function orgTypeLabel(t: string): string {
  switch (t) {
    case "party": return "Párt";
    case "media": return "Média";
    case "radio_station": return "Rádió";
    case "institution": return "Intézmény";
    case "ngo": return "Civil szervezet";
    case "university": return "Egyetem";
    case "research": return "Kutatóintézet";
    case "church": return "Egyház";
    case "sport_team": return "Sportklub";
    case "sport_league": return "Sportliga";
    default: return "Szervezet";
  }
}

function orgHref(t: string, slug: string): string {
  return `/ceg/${slug}`;
}

function norm(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
}

function isSafePublicPerson(p: any): boolean {
  if (!p || p.is_public !== true || p.is_indexable !== true) return false;
  if (!["indexable", "manual_approved", null, undefined].includes(p.activation_status)) return false;
  if (["hide", "reject"].includes(p.ai_recommended_action || "")) return false;
  if (["needs_human_review", "duplicate_candidate"].includes(p.ai_review_status || "")) return false;
  if (p.identity_status === "split_resolved") return false;
  const trustedWiki = p.wikipedia_match_status === "verified" && Number(p.wikipedia_match_confidence || 0) >= 0.8;
  const temporalTopicOnly = p.has_archival_evidence !== true && p.manual_approved !== true && (
    p.is_deceased === true
    || p.is_historical === true
    || p.persona === "historical"
    || p.date_of_death
    || p.is_living === false
  );
  if (temporalTopicOnly) return false;
  if (p.identity_ambiguous && !p.manual_approved && !trustedWiki) return false;
  return Number(p.gated_episode_count || p.episode_count || 0) >= 1;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const body = await req.json().catch(() => ({}));
    const rawQ = String(body?.q ?? body?.prefix ?? "").trim();
    const limit = Math.min(12, Math.max(3, Number(body?.limit ?? 8)));
    if (rawQ.length < 2) return json({ suggestions: [] });
    const q = norm(rawQ);
    // Standalone .ilike() helpers accept `%` directly.
    const ilike = `%${q}%`;
    const prefix = `${q}%`;
    // IMPORTANT: PostgREST .or() filter values must use `*` (not `%`) for ILIKE
    // wildcards — raw `%` inside an `or=(...)` URL value is treated as the
    // start of a percent-escape by Cloudflare/PostgREST and silently returns 0
    // rows (or a 1101 worker error). Using `*` avoids URL encoding pitfalls.
    const qNoSpace = q.replace(/\s+/g, " ").trim();
    const nPrefixStar = `${qNoSpace}*`;
    const nIlikeStar = `*${qNoSpace}*`;
    const nTokenInfixStar = `* ${qNoSpace} *`;
    const ilikeStar = `*${q}*`;
    const prefixStar = `${q}*`;

    const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // Parallel reads — keep each one tight.
    const [podRes, podAliasRes, persRes, aliasRes, topRes, catRes, orgRes, orgAliasRes, qcacheRes] = await Promise.all([
      supa.from("podcasts")
        .select("title,slug,image_url,podiverzum_rank,rank_label,normalized_title")
        .eq("is_hungarian", true)
        .eq("language_decision", "accept_hungarian")
        .or(`normalized_title.ilike.${nPrefixStar},normalized_title.ilike.${nTokenInfixStar},normalized_title.ilike.${nIlikeStar},title.ilike.${ilikeStar}`)
        .order("podiverzum_rank", { ascending: false, nullsFirst: false })
        .limit(12),
      // Podcast aliases — surfaces canonical podcasts via known short forms
      // (e.g. "after" → Hold After Hours, "part" → Partizán)
      supa.from("podcast_aliases")
        .select("alias,confidence,podcasts!inner(title,slug,image_url,podiverzum_rank,rank_label,is_hungarian,language_decision,rss_status)")
        .or(`normalized_alias.eq.${qNoSpace},normalized_alias.ilike.${nPrefixStar}`)
        .gte("confidence", 0.7)
        .limit(8),
      supa.from("people")
        .select("name,slug,image_url,gated_episode_count,episode_count,is_public,is_indexable,activation_status,ai_recommended_action,ai_review_status,identity_status,identity_ambiguous,manual_approved,wikipedia_match_status,wikipedia_match_confidence,is_deceased,is_historical,has_archival_evidence,persona,is_topic_only,date_of_death,is_living,participant_count,host_count,guest_count,disambiguation_label,normalized_name")
        .eq("is_public", true)
        .eq("is_indexable", true)
        .in("activation_status", ["indexable", "manual_approved"])
        .or(`name.ilike.${prefixStar},normalized_name.ilike.${prefixStar}`)
        .order("gated_episode_count", { ascending: false })
        .limit(8),
      // Alias lookup — surfaces canonical people via known aliases (e.g. "Zsiday" → "Zsiday Viktor")
      supa.from("person_aliases")
        .select("alias, confidence, people!inner(name,slug,image_url,gated_episode_count,episode_count,is_public,is_indexable,activation_status,ai_recommended_action,ai_review_status,identity_status,identity_ambiguous,manual_approved,wikipedia_match_status,wikipedia_match_confidence,is_deceased,is_historical,has_archival_evidence,persona,is_topic_only,date_of_death,is_living,participant_count,host_count,guest_count)")
        .ilike("normalized_alias", prefix)
        .gte("confidence", 0.7)
        .limit(5),
      supa.from("topics")
        .select("name,slug,short_name,episode_count,is_public")
        .eq("is_public", true)
        .or(`name.ilike.${ilikeStar},short_name.ilike.${ilikeStar}`)
        .order("episode_count", { ascending: false })
        .limit(5),
      supa.from("categories")
        .select("name,slug,active")
        .eq("active", true)
        .ilike("name", ilike)
        .limit(4),
      // Organizations (cégek, médiumok, pártok, intézmények, egyetemek, sport stb.)
      supa.from("organizations")
        .select("name,slug,org_type,logo_url,gated_episode_count,normalized_name,is_indexable")
        .eq("is_indexable", true)
        .or(`normalized_name.ilike.${nPrefixStar},normalized_name.ilike.${nIlikeStar},name.ilike.${ilikeStar}`)
        .order("gated_episode_count", { ascending: false })
        .limit(8),
      // Organization aliases (e.g. "MNB" → Magyar Nemzeti Bank, "Lakers" → Los Angeles Lakers)
      supa.from("organization_aliases")
        .select("alias,confidence,organizations!inner(name,slug,org_type,logo_url,gated_episode_count,is_indexable)")
        .or(`normalized_alias.eq.${qNoSpace},normalized_alias.ilike.${nPrefixStar}`)
        .gte("confidence", 0.5)
        .limit(8),
      // Past popular search queries — Google-style "people also searched for"
      supa.from("search_query_cache")
        .select("q_norm,hits")
        .ilike("q_norm", prefix)
        .order("hits", { ascending: false })
        .limit(4),
    ]);

    const out: Suggestion[] = [];

    // Rank-label tiebreak — small bonus so ties surface the bigger brand first.
    const rankLabelBonus = (rl: any): number => {
      const s = String(rl || "").toUpperCase();
      if (s === "S") return 0.04;
      if (s === "A") return 0.03;
      if (s === "B") return 0.02;
      if (s === "C") return 0.01;
      return 0;
    };

    const podSlugsSeen = new Set<string>();

    // Podcast aliases first — high-confidence brand-intent matches sit just
    // below true exact-title matches (1.0). Sort so EXACT alias rows win the
    // dedupe race over weaker prefix-alias rows for the same podcast.
    const aliasRows = ((podAliasRes.data || []) as any[]).slice().sort((a, b) => {
      const an = norm(String(a.alias || ""));
      const bn = norm(String(b.alias || ""));
      const ax = an === q || an === qNoSpace ? 0 : 1;
      const bx = bn === q || bn === qNoSpace ? 0 : 1;
      return ax - bx;
    });
    for (const row of aliasRows) {
      const p = row.podcasts;
      if (!p) continue;
      if (!p.is_hungarian || p.language_decision !== "accept_hungarian") continue;
      if (["failed", "inactive", "blocked", "dead"].includes(String(p.rss_status || ""))) continue;
      const slug = String(p.slug || "");
      if (!slug || podSlugsSeen.has(slug)) continue;
      podSlugsSeen.add(slug);
      const aliasNorm = norm(String(row.alias || ""));
      const exactAlias = aliasNorm === q || aliasNorm === qNoSpace;
      const aliasConf = Number(row.confidence) || 0.9;
      // Exact alias with strong confidence wins decisively; weaker matches
      // (prefix-on-alias) get a modest boost only.
      const base = exactAlias && aliasConf >= 0.85 ? 0.96 : 0.86 * aliasConf;
      const conf = Math.min(0.99, base + rankLabelBonus(p.rank_label));
      out.push({
        type: "podcast",
        label: String(p.title || ""),
        subtitle: "Podcast",
        href: `/podcast/${slug}`,
        image_url: p.image_url || null,
        confidence: conf,
      });
    }


    // Podcasts — title-based matches.
    for (const p of (podRes.data || [])) {
      const slug = String((p as any).slug || "");
      if (!slug || podSlugsSeen.has(slug)) continue;
      podSlugsSeen.add(slug);
      const t = String((p as any).title || "");
      const nt = String((p as any).normalized_title || norm(t));
      let base = 0.5;
      if (nt === q || nt === qNoSpace) base = 1.0;
      else if (nt.startsWith(qNoSpace)) base = 0.9;
      else if ((` ${nt} `).includes(` ${qNoSpace} `)) base = 0.85;
      else if (nt.includes(qNoSpace)) base = 0.7;
      const conf = Math.min(0.99, base + rankLabelBonus((p as any).rank_label));
      out.push({
        type: "podcast",
        label: t,
        subtitle: "Podcast",
        href: `/podcast/${slug}`,
        image_url: (p as any).image_url || null,
        confidence: conf,
      });
    }

    // People — score by (exact name match → big bonus) + (startsWith → small bonus) + gated episode count.
    // This prevents "Magyar Péter" query from being outranked by similarly-spelled "Magyari Péter"
    // just because the latter has more gated episodes.
    const peopleRanked = (persRes.data || [])
      .filter(isSafePublicPerson)
      .map((p: any) => {
        const n = String(p.name || "");
        const nn = String(p.normalized_name || norm(n));
        const exact = nn === q;
        const starts = nn.startsWith(q + " ") || nn === q;
        const eps = Number(p.gated_episode_count || 0);
        const score = (exact ? 10000 : 0) + (starts ? 500 : 0) + eps;
        return { p, n, nn, exact, starts, score };
      })
      .filter((r) => r.n)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    for (const r of peopleRanked) {
      const conf = r.exact ? 0.95 : r.starts ? 0.85 : 0.6;
      const dis = String((r.p as any).disambiguation_label || "").trim();
      out.push({
        type: "person",
        label: r.n,
        subtitle: dis ? `Személy · ${dis}` : "Személy",
        href: `/szemelyek/${(r.p as any).slug}`,
        image_url: (r.p as any).image_url || null,
        confidence: conf,
      });
    }

    // Aliases → canonical people (e.g. "Zsiday" → "Zsiday Viktor")
    const personSlugsSeen = new Set(
      (persRes.data || []).map((p: any) => String(p.slug || "")),
    );
    for (const row of (aliasRes.data || []) as any[]) {
      const person = row.people;
      if (!isSafePublicPerson(person)) continue;
      const slug = String(person.slug || "");
      if (!slug || personSlugsSeen.has(slug)) continue;
      personSlugsSeen.add(slug);
      const aliasLabel = String(row.alias || "").trim();
      const canonical = String(person.name || "");
      if (!canonical) continue;
      out.push({
        type: "person",
        label: canonical,
        subtitle: aliasLabel && norm(aliasLabel) !== norm(canonical) ? `Személy · ${aliasLabel}` : "Személy",
        href: `/szemelyek/${slug}`,
        image_url: person.image_url || null,
        confidence: 0.82,
      });
    }

    // Topics
    for (const t of (topRes.data || [])) {
      const name = String((t as any).name || "");
      if (!name) continue;
      const conf = norm(name).startsWith(q) ? 0.8 : 0.55;
      out.push({
        type: "topic",
        label: name,
        subtitle: "Téma",
        href: `/temak/${(t as any).slug}`,
        confidence: conf,
      });
    }

    // Categories
    for (const c of (catRes.data || [])) {
      const name = String((c as any).name || "");
      if (!name) continue;
      out.push({
        type: "category",
        label: name,
        subtitle: "Kategória",
        href: `/kategoria/${(c as any).slug}`,
        confidence: norm(name).startsWith(q) ? 0.7 : 0.5,
      });
    }

    // Organizations (cégek, médiumok, pártok, intézmények, sport stb.)
    const orgSlugsSeen = new Set<string>();
    // Alias matches first — short forms (MNB, Lakers) should win the dedupe.
    for (const row of (orgAliasRes.data || []) as any[]) {
      const o = row.organizations;
      if (!o || !o.is_indexable) continue;
      const slug = String(o.slug || "");
      if (!slug || orgSlugsSeen.has(slug)) continue;
      orgSlugsSeen.add(slug);
      const aliasNorm = norm(String(row.alias || ""));
      const exact = aliasNorm === q || aliasNorm === qNoSpace;
      const aliasConf = Number(row.confidence) || 0.8;
      const conf = Math.min(0.97, exact && aliasConf >= 0.8 ? 0.94 : 0.78 * aliasConf);
      out.push({
        type: "organization",
        label: String(o.name || ""),
        subtitle: orgTypeLabel(String(o.org_type || "")),
        href: orgHref(String(o.org_type || ""), slug),
        image_url: o.logo_url || null,
        confidence: conf,
      });
    }
    for (const o of (orgRes.data || []) as any[]) {
      const slug = String(o.slug || "");
      if (!slug || orgSlugsSeen.has(slug)) continue;
      orgSlugsSeen.add(slug);
      const name = String(o.name || "");
      const nn = String(o.normalized_name || norm(name));
      let base = 0.55;
      if (nn === q || nn === qNoSpace) base = 0.96;
      else if (nn.startsWith(qNoSpace)) base = 0.85;
      else if ((` ${nn} `).includes(` ${qNoSpace} `)) base = 0.78;
      else if (nn.includes(qNoSpace)) base = 0.65;
      out.push({
        type: "organization",
        label: name,
        subtitle: orgTypeLabel(String(o.org_type || "")),
        href: orgHref(String(o.org_type || ""), slug),
        image_url: o.logo_url || null,
        confidence: base,
      });
    }

    // Past popular search queries from cache (Google-style query suggestions).
    for (const row of (qcacheRes.data || []) as any[]) {
      const qn = String(row.q_norm || "").trim();
      if (!qn || qn === q) continue;
      out.push({
        type: "query",
        label: qn,
        subtitle: "Korábbi keresés",
        href: `/kereses?q=${encodeURIComponent(qn)}`,
        confidence: 0.65,
      });
    }

    // Always cap and dedupe by (type,label) — sort by confidence desc.
    const seen = new Set<string>();
    const deduped = out
      .sort((a, b) => b.confidence - a.confidence)
      .filter((s) => {
        const k = `${s.type}:${s.label.toLowerCase()}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, limit);

    // Always offer a "Search …" fallback as the last row so the user can
    // submit free-text even if nothing matches structurally.
    deduped.push({
      type: "query",
      label: rawQ,
      subtitle: `Keresés: „${rawQ}”`,
      href: `/kereses?q=${encodeURIComponent(rawQ)}`,
      confidence: 0.1,
    });

    return json({ suggestions: deduped });
  } catch (e) {
    console.error("search-autocomplete err", e);
    return json({ suggestions: [], error: (e as Error).message }, 200);
  }
});
