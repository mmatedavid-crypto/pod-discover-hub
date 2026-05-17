// Generates HU-only sitemap index + per-type sitemaps for podiverzum.hu.
// Run: node scripts/gen-sitemap.mjs  (requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const SITE = 'https://podiverzum.hu';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const esc = s => String(s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const tag = (loc, lastmod, cf='daily', pr='0.6') =>
  `<url><loc>${loc}</loc>${lastmod?`<lastmod>${new Date(lastmod).toISOString()}</lastmod>`:''}<changefreq>${cf}</changefreq><priority>${pr}</priority></url>`;
const wrap = urls => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;

fs.mkdirSync('public/sitemaps', { recursive: true });

const now = new Date().toISOString();

// ---- pages.xml (static + categories + moods) ----
const { data: cats = [] } = await sb
  .from('categories').select('slug,created_at')
  .eq('active', true).order('sort_order');

const { data: moods = [] } = await sb
  .from('mood_collections').select('slug,updated_at,recommended_episode_count')
  .eq('active', true).order('sort_order');

const pages = [
  tag(`${SITE}/`, now, 'daily', '1.0'),
  tag(`${SITE}/kategoriak`, now, 'daily', '0.7'),
  tag(`${SITE}/temak`, now, 'weekly', '0.6'),
  tag(`${SITE}/szemelyek`, now, 'daily', '0.7'),
  tag(`${SITE}/hangulatok`, now, 'weekly', '0.7'),
  tag(`${SITE}/uj`, now, 'daily', '0.6'),
  tag(`${SITE}/napi`, now, 'daily', '0.6'),
  tag(`${SITE}/rolunk`, now, 'monthly', '0.4'),
  tag(`${SITE}/modszertan`, now, 'monthly', '0.4'),
  tag(`${SITE}/kapcsolat`, now, 'yearly', '0.3'),
  tag(`${SITE}/adatvedelem`, now, 'yearly', '0.2'),
  tag(`${SITE}/feltetelek`, now, 'yearly', '0.2'),
  ...cats.map(c => tag(`${SITE}/kategoria/${esc(c.slug)}`, c.created_at, 'daily', '0.8')),
  ...moods.filter(m => (m.recommended_episode_count ?? 0) >= 10)
          .map(m => tag(`${SITE}/hangulatok/${esc(m.slug)}`, m.updated_at, 'weekly', '0.7')),
];
fs.writeFileSync('public/sitemaps/pages.xml', wrap(pages));
console.log('pages.xml:', pages.length, 'urls');

// ---- podcasts (HU-only, healthy, non-E tier) ----
const BAD = new Set(['needs_manual_rss_review','quarantined_spam','confirmed_dead']);
let from = 0, podcasts = [];
while (true) {
  const { data, error } = await sb.from('podcasts')
    .select('slug,updated_at,ai_enriched_at,rss_status,rank_label,language,shadow_rank_components')
    .ilike('language', 'hu%')
    .order('id').range(from, from + 999);
  if (error) throw error;
  if (!data?.length) break;
  for (const p of data) {
    if (!p.slug) continue;
    if (p.rss_status === 'failed' || p.rss_status === 'inactive') continue;
    if (p.rank_label === 'E') continue;
    const hs = p.shadow_rank_components?.health_state;
    if (BAD.has(hs)) continue;
    const t = p.rank_label;
    const pr = t === 'S' ? '0.9' : t === 'A' ? '0.8' : t === 'B' ? '0.7' : t === 'C' ? '0.6' : '0.4';
    const lm = [p.updated_at, p.ai_enriched_at].filter(Boolean).sort().pop();
    podcasts.push(tag(`${SITE}/podcast/${esc(p.slug)}`, lm, 'daily', pr));
  }
  if (data.length < 1000) break;
  from += 1000;
}
const CHUNK = 45000;
const podFiles = [];
for (let i = 0; i < podcasts.length; i += CHUNK) {
  const idx = Math.floor(i / CHUNK) + 1;
  const fname = `podcasts-${idx}.xml`;
  fs.writeFileSync(`public/sitemaps/${fname}`, wrap(podcasts.slice(i, i + CHUNK)));
  podFiles.push(fname);
  console.log(fname + ':', Math.min(CHUNK, podcasts.length - i), 'urls');
}

// ---- people (indexable only) ----
const peopleUrls = [];
from = 0;
while (true) {
  const { data, error } = await sb.from('people')
    .select('slug,updated_at,is_indexable,latest_episode_at')
    .eq('is_indexable', true)
    .order('id').range(from, from + 999);
  if (error) throw error;
  if (!data?.length) break;
  for (const p of data) {
    if (!p.slug) continue;
    const lm = [p.latest_episode_at, p.updated_at].filter(Boolean).sort().pop();
    peopleUrls.push(tag(`${SITE}/szemelyek/${esc(p.slug)}`, lm, 'weekly', '0.6'));
  }
  if (data.length < 1000) break;
  from += 1000;
}
const peopleFiles = [];
for (let i = 0; i < peopleUrls.length; i += CHUNK) {
  const idx = Math.floor(i / CHUNK) + 1;
  const fname = `people-${idx}.xml`;
  fs.writeFileSync(`public/sitemaps/${fname}`, wrap(peopleUrls.slice(i, i + CHUNK)));
  peopleFiles.push(fname);
  console.log(fname + ':', Math.min(CHUNK, peopleUrls.length - i), 'urls');
}

// ---- episodes (HU, S/A/B with ai_summary, last 180d) ----
const epUrls = [];
from = 0;
const SINCE = new Date(Date.now() - 180 * 86400_000).toISOString();
while (true) {
  const { data, error } = await sb.from('episodes')
    .select('slug,published_at,updated_at,podcast_id,podcasts!inner(slug,language,rank_label,rss_status)')
    .ilike('podcasts.language', 'hu%')
    .in('podcasts.rank_label', ['S','A','B'])
    .not('ai_summary', 'is', null)
    .gte('published_at', SINCE)
    .order('published_at', { ascending: false })
    .range(from, from + 999);
  if (error) throw error;
  if (!data?.length) break;
  for (const e of data) {
    if (!e.slug || !e.podcasts?.slug) continue;
    const ps = e.podcasts;
    if (ps.rss_status === 'failed' || ps.rss_status === 'inactive') continue;
    const pr = ps.rank_label === 'S' ? '0.8' : ps.rank_label === 'A' ? '0.7' : '0.6';
    const lm = [e.updated_at, e.published_at].filter(Boolean).sort().pop();
    epUrls.push(tag(`${SITE}/podcast/${esc(ps.slug)}/${esc(e.slug)}`, lm, 'weekly', pr));
  }
  if (data.length < 1000) break;
  from += 1000;
  if (epUrls.length >= 40000) break; // cap to keep crawl budget healthy
}
const epFiles = [];
for (let i = 0; i < epUrls.length; i += CHUNK) {
  const idx = Math.floor(i / CHUNK) + 1;
  const fname = `episodes-${idx}.xml`;
  fs.writeFileSync(`public/sitemaps/${fname}`, wrap(epUrls.slice(i, i + CHUNK)));
  epFiles.push(fname);
  console.log(fname + ':', Math.min(CHUNK, epUrls.length - i), 'urls');
}

// ---- sitemap.xml (index) ----
const lastmod = new Date().toISOString();
const entries = [
  `<sitemap><loc>${SITE}/sitemaps/pages.xml</loc><lastmod>${lastmod}</lastmod></sitemap>`,
  ...podFiles.map(f => `<sitemap><loc>${SITE}/sitemaps/${f}</loc><lastmod>${lastmod}</lastmod></sitemap>`),
  ...peopleFiles.map(f => `<sitemap><loc>${SITE}/sitemaps/${f}</loc><lastmod>${lastmod}</lastmod></sitemap>`),
  ...epFiles.map(f => `<sitemap><loc>${SITE}/sitemaps/${f}</loc><lastmod>${lastmod}</lastmod></sitemap>`),
];
const indexXml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</sitemapindex>\n`;
fs.writeFileSync('public/sitemap.xml', indexXml);
console.log('sitemap.xml index entries:', entries.length);
