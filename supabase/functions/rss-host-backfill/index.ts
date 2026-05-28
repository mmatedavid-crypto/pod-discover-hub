// Backfills podcasts.hosts from RSS <itunes:author>, <itunes:owner><itunes:name>,
// <managingEditor>, or <author>. Only writes when the value looks like a personal
// name (filters out publishers like "Rádió X", "Spotler Media Kft", etc.).
//
// POST body: { limit?: number (default 100, max 300), dry_run?: boolean,
//              only_missing?: boolean (default true) }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TIME_BUDGET_MS = 110_000;

// Tokens that disqualify a chunk from being a person name.
const PUBLISHER_TOKENS = [
  "rádió","radio","podcast","podcasts","network","media","studio","studios",
  "tv","kft","zrt","bt","nyrt","kiadó","kiadó.","hírek","news","magazin",
  "csatorna","group","közösség","klub","production","productions","music",
  "ltd","inc","llc","co.","company","kiadója","szerkesztőség","official",
  "channel","fm","am","online","portál","portal","blog","show","sport",
  "egyház","gyülekezet","intézet","alapítvány","klinika","akadémia",
  "egyetem","college","university","gazdaság","gazdasági","fitness",
  "magyar","podiverzum","spotify","apple","youtube","mindset","mindset.",
  "infostart","telex","hvg","index","24.hu","mandiner","origó","origo",
  "blikk","ripost","atv","rtl","tv2","duna","mtva","kossuth","klubrádió",
];

function looksLikePersonName(raw: string): string | null {
  const s = raw.replace(/\s+/g, " ").trim().replace(/[.,;:]+$/, "");
  if (!s) return null;
  if (s.length < 4 || s.length > 60) return null;
  if (/[@/\\|()<>]/.test(s)) return null;
  if (/\d/.test(s)) return null;
  const lower = s.toLowerCase();
  for (const t of PUBLISHER_TOKENS) {
    const re = new RegExp(`(^|\\s|[.,])${t.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}(\\s|$|[.,])`, "i");
    if (re.test(` ${lower} `)) return null;
  }
  const words = s.split(/\s+/);
  if (words.length < 2 || words.length > 4) return null;
  // each word should start with uppercase letter (allow ÁÉÍÓÖŐÚÜŰ)
  for (const w of words) {
    if (!/^[A-ZÁÉÍÓÖŐÚÜŰ][\p{L}'’.-]+$/u.test(w)) return null;
  }
  return s;
}

function splitNames(raw: string): string[] {
  if (!raw) return [];
  // split on common separators
  const parts = raw.split(/\s*(?:,|&|\/|·|\||\bés\b|\band\b)\s*/i);
  const out: string[] = [];
  for (const p of parts) {
    const n = looksLikePersonName(p);
    if (n) out.push(n);
  }
  // dedup
  return [...new Set(out)];
}

function unwrapCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}
function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
function getTag(xml: string, name: string): string {
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${n}>`, "i");
  const m = xml.match(re);
  if (!m) return "";
  return decodeEntities(unwrapCdata(m[1])).trim();
}

function extractCandidates(xml: string): string[] {
  // restrict to channel header (before first <item> or <entry>)
  const cut = xml.search(/<(item|entry)\b/i);
  const head = cut > 0 ? xml.slice(0, cut) : xml;
  const ownerBlock = getTag(head, "itunes:owner");
  const ownerName = ownerBlock ? getTag(ownerBlock, "itunes:name") : "";
  const candidates = [
    getTag(head, "itunes:author"),
    getTag(head, "googleplay:author"),
    ownerName,
    getTag(head, "managingEditor"),
    getTag(head, "author"),
    getTag(head, "dc:creator"),
  ].filter(Boolean);
  return candidates;
}

async function fetchRss(url: string, signal: AbortSignal): Promise<string | null> {
  try {
    const r = await fetch(url, {
      signal,
      headers: {
        "user-agent": "Podiverzum-HostBackfill/1.0 (+https://podiverzum.hu)",
        "accept": "application/rss+xml, application/xml, text/xml, */*",
      },
      redirect: "follow",
    });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const t0 = Date.now();
  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const limit = Math.max(1, Math.min(Number(body?.limit) || 100, 300));
  const dryRun = !!body?.dry_run;
  const onlyMissing = body?.only_missing !== false;

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let q = sb.from("podcasts")
    .select("id, title, rss_url, hosts")
    .ilike("language", "hu%")
    .not("rss_url", "is", null)
    .order("podiverzum_rank", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (onlyMissing) q = q.or("hosts.is.null,hosts.eq.{}");
  const { data, error } = await q;
  if (error) return json({ ok: false, error: error.message }, 500);

  const rows = (data || []) as Array<{ id: string; title: string; rss_url: string; hosts: string[] | null }>;
  const result = {
    scanned: 0,
    updated: 0,
    no_candidate: 0,
    fetch_failed: 0,
    skipped_publisher_only: 0,
    examples_updated: [] as Array<{ title: string; hosts: string[]; source: string }>,
    examples_publisher: [] as Array<{ title: string; raw: string }>,
  };

  const CONC = 8;
  let idx = 0;
  async function worker() {
    while (idx < rows.length) {
      if (Date.now() - t0 > TIME_BUDGET_MS) return;
      const row = rows[idx++];
      result.scanned++;
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 12_000);
      const xml = await fetchRss(row.rss_url, ctl.signal);
      clearTimeout(to);
      if (!xml) { result.fetch_failed++; continue; }
      const cands = extractCandidates(xml);
      let names: string[] = [];
      for (const c of cands) {
        names = splitNames(c);
        if (names.length) break;
      }
      if (!names.length) {
        if (cands.length) {
          result.skipped_publisher_only++;
          if (result.examples_publisher.length < 8) {
            result.examples_publisher.push({ title: row.title, raw: cands[0].slice(0, 80) });
          }
        } else {
          result.no_candidate++;
        }
        continue;
      }
      if (!dryRun) {
        const { error: upErr } = await sb.from("podcasts").update({
          hosts: names,
          hosts_source: "rss_author",
          hosts_updated_at: new Date().toISOString(),
        }).eq("id", row.id);
        if (upErr) continue;
      }
      result.updated++;
      if (result.examples_updated.length < 8) {
        result.examples_updated.push({ title: row.title, hosts: names, source: "rss_author" });
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, () => worker()));

  return json({ ok: true, dry_run: dryRun, elapsed_ms: Date.now() - t0, ...result, remaining_estimate: Math.max(0, rows.length - result.scanned) });
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }, status,
  });
}
