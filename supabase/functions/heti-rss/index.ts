// Public RSS 2.0 feed for the Podiverzum Heti weekly editorial column.
// Served at https://podiverzum.hu/heti/rss.xml via Cloudflare worker proxy.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SITE = "https://podiverzum.hu";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/rss+xml; charset=utf-8",
  "Cache-Control": "public, max-age=900, s-maxage=900",
};

function esc(s: string | null | undefined): string {
  if (!s) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function isoWeek(dateStr: string): { year: number; week: number } {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((target.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return { year: target.getUTCFullYear(), week };
}

function kebab(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function hetiSlug(p: { week_start: string; title: string | null }): string {
  const { year, week } = isoWeek(p.week_start);
  const tail = kebab(p.title || "podiverzum-heti") || "podiverzum-heti";
  return `${year}-${String(week).padStart(2, "0")}-${tail}`;
}

Deno.serve(async (_req) => {
  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data } = await sb
      .from("editorial_posts" as any)
      .select("id,week_start,week_end,title,intro,cover_image_url,published_at")
      .eq("status", "published")
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(20);

    const items = (data || []).map((p: any) => {
      const slug = hetiSlug(p);
      const link = `${SITE}/heti/${slug}`;
      const { year, week } = isoWeek(p.week_start);
      const title = p.title || `Podiverzum Heti — ${year}/${week}. hét`;
      const desc = (p.intro || "").replace(/\s+/g, " ").trim().slice(0, 500);
      const pub = new Date(p.published_at || `${p.week_end}T00:00:00Z`).toUTCString();
      const enclosure = p.cover_image_url
        ? `\n  <enclosure url="${esc(p.cover_image_url)}" type="image/jpeg" />`
        : "";
      return `<item>
  <title>${esc(title)}</title>
  <link>${esc(link)}</link>
  <guid isPermaLink="true">${esc(link)}</guid>
  <pubDate>${pub}</pubDate>
  <dc:creator>Podiverzum szerkesztőség</dc:creator>
  <category>Podiverzum Heti</category>
  <description>${esc(desc)}</description>${enclosure}
</item>`;
    }).join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <title>Podiverzum Heti</title>
  <link>${SITE}/heti</link>
  <atom:link href="${SITE}/heti/rss.xml" rel="self" type="application/rss+xml" />
  <description>Magyar podcastfigyelő: heti válogatás magyar podcastokból, témákból és idézetekből.</description>
  <language>hu-HU</language>
  <copyright>© Podiverzum</copyright>
  <managingEditor>szerkesztoseg@podiverzum.hu (Podiverzum szerkesztőség)</managingEditor>
  <webMaster>szerkesztoseg@podiverzum.hu (Podiverzum szerkesztőség)</webMaster>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
  <image>
    <url>${SITE}/icon-512.png</url>
    <title>Podiverzum Heti</title>
    <link>${SITE}/heti</link>
  </image>
${items}
</channel>
</rss>`;
    return new Response(xml, { headers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Podiverzum Heti</title><description>temporary error: ${esc(msg)}</description></channel></rss>`,
      { status: 500, headers },
    );
  }
});
