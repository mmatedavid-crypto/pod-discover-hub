// rss-transcript-tag-audit
// One-shot audit: fetches RSS feeds for HU podcasts, parses for
// <podcast:transcript url=... type=...> tags (Podcasting 2.0 spec), and
// records per-podcast counts to `app_settings.rss_transcript_audit`.
//
// Invoke:
//   POST /rss-transcript-tag-audit            // defaults: tiers S,A,B, limit 400
//   POST /rss-transcript-tag-audit { "tiers": ["S","A","B","C"], "limit": 800 }
//   POST /rss-transcript-tag-audit { "podcast_ids": ["..."] }
//
// Output (jsonb in app_settings.rss_transcript_audit):
//   {
//     ran_at, tiers, scanned, with_tag, episodes_with_tag_total,
//     per_format: { "application/srt": N, "text/vtt": N, ... },
//     hits: [ { podcast_id, title, episodes_total, episodes_with_tag, sample_urls[3], formats[] } ],
//     errors: [ { podcast_id, error } ]
//   }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// Regex matches <podcast:transcript .../> (self-closing or with body) — case-insensitive,
// tolerates attribute order and single/double quotes.
const TRANSCRIPT_TAG_RE = /<podcast:transcript\b([^>]*)\/?>/gi;
const ATTR_RE = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(raw)) !== null) {
    out[m[1].toLowerCase()] = (m[2] ?? m[3] ?? "").trim();
  }
  return out;
}

interface AuditHit {
  podcast_id: string;
  title: string;
  rss_url: string;
  episodes_total: number;
  episodes_with_tag: number;
  sample_urls: string[];
  formats: string[];
}

async function auditFeed(podcast: { id: string; title: string; rss_url: string }): Promise<AuditHit | { error: string; podcast_id: string }> {
  try {
    const r = await fetch(podcast.rss_url, {
      headers: { "User-Agent": "Podiverzum/1.0 (transcript-audit)" },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return { podcast_id: podcast.id, error: `http_${r.status}` };
    const xml = await r.text();

    // Split per <item> to count "episodes with at least one transcript tag" precisely.
    const items = xml.split(/<item\b/i).slice(1); // first chunk is channel-level
    let episodes_total = items.length;
    let episodes_with_tag = 0;
    const sample_urls: string[] = [];
    const formats = new Set<string>();

    for (const itm of items) {
      const end = itm.indexOf("</item>");
      const body = end >= 0 ? itm.slice(0, end) : itm;
      TRANSCRIPT_TAG_RE.lastIndex = 0;
      let found = false;
      let m: RegExpExecArray | null;
      while ((m = TRANSCRIPT_TAG_RE.exec(body)) !== null) {
        const a = parseAttrs(m[1] || "");
        if (!a.url) continue;
        found = true;
        if (a.type) formats.add(a.type);
        if (sample_urls.length < 3) sample_urls.push(a.url);
      }
      if (found) episodes_with_tag++;
    }

    return {
      podcast_id: podcast.id,
      title: podcast.title,
      rss_url: podcast.rss_url,
      episodes_total,
      episodes_with_tag,
      sample_urls,
      formats: [...formats],
    };
  } catch (e) {
    return { podcast_id: podcast.id, error: String((e as Error).message || e).slice(0, 200) };
  }
}

async function runAudit(opts: { tiers?: string[]; limit?: number; podcast_ids?: string[]; concurrency?: number }) {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const tiers = opts.tiers ?? ["S", "A", "B"];
  const limit = Math.min(opts.limit ?? 400, 1500);
  const concurrency = Math.min(opts.concurrency ?? 8, 16);

  let q = admin.from("podcasts").select("id,title,rss_url,rank_label").ilike("language", "hu%").not("rss_url", "is", null);
  if (opts.podcast_ids?.length) q = q.in("id", opts.podcast_ids);
  else q = q.in("rank_label", tiers);
  q = q.limit(limit);
  const { data: podcasts, error } = await q;
  if (error) throw new Error(error.message);

  const targets = (podcasts ?? []).filter((p: any) => p.rss_url);
  const hits: AuditHit[] = [];
  const errors: { podcast_id: string; error: string }[] = [];

  // Bounded concurrency
  let cursor = 0;
  async function worker() {
    while (cursor < targets.length) {
      const i = cursor++;
      const p = targets[i] as any;
      const res = await auditFeed({ id: p.id, title: p.title, rss_url: p.rss_url });
      if ("error" in res) errors.push(res);
      else if (res.episodes_with_tag > 0) hits.push(res);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const per_format: Record<string, number> = {};
  let episodes_with_tag_total = 0;
  for (const h of hits) {
    episodes_with_tag_total += h.episodes_with_tag;
    for (const f of h.formats) per_format[f] = (per_format[f] || 0) + h.episodes_with_tag;
  }
  hits.sort((a, b) => b.episodes_with_tag - a.episodes_with_tag);

  const payload = {
    ran_at: new Date().toISOString(),
    tiers,
    scanned: targets.length,
    with_tag: hits.length,
    episodes_with_tag_total,
    per_format,
    hits: hits.slice(0, 200),
    errors: errors.slice(0, 50),
    error_count: errors.length,
  };

  await admin.from("app_settings").upsert({ key: "rss_transcript_audit", value: payload as any });
  return payload;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const result = await runAudit(body);
    return json({ ok: true, ...result });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message || e) }, 500);
  }
});
