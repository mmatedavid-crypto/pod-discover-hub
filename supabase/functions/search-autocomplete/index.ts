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
  type: "podcast" | "person" | "topic" | "category" | "query";
  label: string;
  subtitle?: string;
  href: string;
  image_url?: string | null;
  confidence: number;
};

function norm(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
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
    const ilike = `%${q}%`;
    const prefix = `${q}%`;
    // Accent-insensitive variants for `podcasts.normalized_title`
    const qNoSpace = q.replace(/\s+/g, " ").trim();
    const nIlike = `%${qNoSpace}%`;
    const nPrefix = `${qNoSpace}%`;
    const nTokenInfix = `% ${qNoSpace} %`;

    const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // Parallel reads — keep each one tight.
    const [podRes, persRes, aliasRes, topRes, catRes, qcacheRes] = await Promise.all([
      supa.from("podcasts")
        .select("title,slug,image_url,podiverzum_rank,rank_label,normalized_title")
        .eq("is_hungarian", true)
        .eq("language_decision", "accept_hungarian")
        .or(`normalized_title.ilike.${nPrefix},normalized_title.ilike.${nTokenInfix},normalized_title.ilike.${nIlike},title.ilike.${ilike}`)
        .order("podiverzum_rank", { ascending: false, nullsFirst: false })
        .limit(8),
      supa.from("people")
        .select("name,slug,image_url,gated_episode_count,is_indexable,disambiguation_label,normalized_name")
        .eq("is_public", true)
        .or(`name.ilike.${prefix},normalized_name.ilike.${prefix}`)
        .order("gated_episode_count", { ascending: false })
        .limit(8),
      // Alias lookup — surfaces canonical people via known aliases (e.g. "Zsiday" → "Zsiday Viktor")
      supa.from("person_aliases")
        .select("alias, confidence, people!inner(name,slug,image_url,is_public,gated_episode_count)")
        .ilike("normalized_alias", prefix)
        .gte("confidence", 0.7)
        .limit(5),
      supa.from("topics")
        .select("name,slug,short_name,episode_count,is_public")
        .eq("is_public", true)
        .or(`name.ilike.${ilike},short_name.ilike.${ilike}`)
        .order("episode_count", { ascending: false })
        .limit(5),
      supa.from("categories")
        .select("name,slug,active")
        .eq("active", true)
        .ilike("name", ilike)
        .limit(4),
      // Past popular search queries — Google-style "people also searched for"
      supa.from("search_query_cache")
        .select("q_norm,hits")
        .ilike("q_norm", prefix)
        .order("hits", { ascending: false })
        .limit(4),
    ]);

    const out: Suggestion[] = [];

    // Podcasts first — exact/title-prefix matches get the highest confidence.
    for (const p of (podRes.data || [])) {
      const t = String((p as any).title || "");
      const tNorm = norm(t);
      let conf = 0.5;
      if (tNorm === q) conf = 1.0;
      else if (tNorm.startsWith(q)) conf = 0.9;
      else if (tNorm.includes(` ${q}`) || tNorm.includes(`${q} `)) conf = 0.75;
      out.push({
        type: "podcast",
        label: t,
        subtitle: "Podcast",
        href: `/podcast/${(p as any).slug}`,
        image_url: (p as any).image_url || null,
        confidence: conf,
      });
    }

    // People — score by (exact name match → big bonus) + (startsWith → small bonus) + gated episode count.
    // This prevents "Magyar Péter" query from being outranked by similarly-spelled "Magyari Péter"
    // just because the latter has more gated episodes.
    const peopleRanked = (persRes.data || [])
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
      if (!person || !person.is_public) continue;
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
        href: `/category/${(c as any).slug}`,
        confidence: norm(name).startsWith(q) ? 0.7 : 0.5,
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
