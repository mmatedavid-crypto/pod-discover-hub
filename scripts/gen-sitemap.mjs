// Generates HU-only sitemap index + per-type sitemaps for podiverzum.hu.
// Policy 2026-06-01: include EVERYTHING public/indexable — no tier filter,
// no recency cap, no ai_summary requirement. Press-release inbound links
// are coming, give Google the full surface.
// Run: node scripts/gen-sitemap.mjs  (requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const SITE = 'https://podiverzum.hu';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const esc = s => String(s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const tag = (loc, lastmod, cf='weekly', pr='0.6') =>
  `<url><loc>${loc}</loc>${lastmod?`<lastmod>${new Date(lastmod).toISOString()}</lastmod>`:''}<changefreq>${cf}</changefreq><priority>${pr}</priority></url>`;
const wrap = urls => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;

fs.mkdirSync('public/sitemaps', { recursive: true });

const now = new Date().toISOString();
// Keep shards comfortably below Google limits and CDN/origin timeout-sensitive
// ~10 MB responses. 25k episode URLs is ~5–6 MB uncompressed.
const CHUNK = 25000;

function writeChunks(prefix, urls) {
  const files = [];
  if (urls.length === 0) return files;
  for (let i = 0; i < urls.length; i += CHUNK) {
    const idx = Math.floor(i / CHUNK) + 1;
    const fname = `${prefix}-${idx}.xml`;
    fs.writeFileSync(`public/sitemaps/${fname}`, wrap(urls.slice(i, i + CHUNK)));
    files.push(fname);
    console.log(fname + ':', Math.min(CHUNK, urls.length - i), 'urls');
  }
  return files;
}

// ---- pages.xml (static + categories + moods + topics hub list) ----
const { data: cats = [] } = await sb
  .from('categories').select('slug,created_at')
  .eq('active', true).order('sort_order');

const { data: moods = [] } = await sb
  .from('mood_collections').select('slug,updated_at')
  .eq('active', true).order('sort_order');

const pages = [
  tag(`${SITE}/`, now, 'daily', '1.0'),
  tag(`${SITE}/toplista`, now, 'daily', '0.9'),
  tag(`${SITE}/szemelyek`, now, 'daily', '0.9'),
  tag(`${SITE}/cegek`, now, 'daily', '0.9'),
  tag(`${SITE}/partok`, now, 'daily', '0.9'),
  tag(`${SITE}/temak`, now, 'daily', '0.9'),
  tag(`${SITE}/kategoriak`, now, 'daily', '0.7'),
  tag(`${SITE}/hangulatok`, now, 'weekly', '0.7'),
  tag(`${SITE}/uj-podcastok`, now, 'daily', '0.6'),
  tag(`${SITE}/napi`, now, 'daily', '0.6'),
  tag(`${SITE}/heti`, now, 'weekly', '0.8'),
  tag(`${SITE}/jelentes/magyar-podcast-piac-2026`, now, 'monthly', '0.9'),
  tag(`${SITE}/rolunk`, now, 'monthly', '0.4'),
  tag(`${SITE}/modszertan`, now, 'monthly', '0.4'),
  tag(`${SITE}/kapcsolat`, now, 'yearly', '0.3'),
  tag(`${SITE}/adatvedelem`, now, 'yearly', '0.2'),
  tag(`${SITE}/feltetelek`, now, 'yearly', '0.2'),
  ...cats.map(c => tag(`${SITE}/kategoria/${esc(c.slug)}`, c.created_at, 'daily', '0.8')),
  ...moods.map(m => tag(`${SITE}/hangulatok/${esc(m.slug)}`, m.updated_at, 'weekly', '0.7')),
];
fs.writeFileSync('public/sitemaps/pages.xml', wrap(pages));
console.log('pages.xml:', pages.length, 'urls');

// ---- podcasts (curated HU only; RSS is_hungarian is noisy) ----
let from = 0, podcasts = [];
while (true) {
  const { data, error } = await sb.from('podcasts')
    .select('slug,updated_at,ai_enriched_at,rank_label,language_decision')
    .eq('language_decision', 'accept_hungarian')
    .order('id').range(from, from + 999);
  if (error) throw error;
  if (!data?.length) break;
  for (const p of data) {
    if (!p.slug) continue;
    const t = p.rank_label;
    const pr = t === 'S' ? '0.9' : t === 'A' ? '0.8' : t === 'B' ? '0.7' : t === 'C' ? '0.6' : '0.5';
    const lm = [p.updated_at, p.ai_enriched_at].filter(Boolean).sort().pop();
    podcasts.push(tag(`${SITE}/podcast/${esc(p.slug)}`, lm, 'weekly', pr));
  }
  if (data.length < 1000) break;
  from += 1000;
}
const podFiles = writeChunks('podcasts', podcasts);

// ---- people (indexable) ----
const peopleUrls = [];
from = 0;
while (true) {
  const { data, error } = await sb.from('people')
    .select('slug,updated_at,latest_episode_at')
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
const peopleFiles = writeChunks('people', peopleUrls);

// ---- organizations (indexable; canonical route is /ceg/:slug for all org types) ----
const orgUrls = [];
from = 0;
while (true) {
  const { data, error } = await sb.from('organizations')
    .select('slug,updated_at,latest_episode_at,org_type')
    .eq('is_indexable', true)
    .order('id').range(from, from + 999);
  if (error) throw error;
  if (!data?.length) break;
  for (const o of data) {
    if (!o.slug) continue;
    const lm = [o.latest_episode_at, o.updated_at].filter(Boolean).sort().pop();
    const pr = o.org_type === 'party' ? '0.7' : '0.6';
    orgUrls.push(tag(`${SITE}/ceg/${esc(o.slug)}`, lm, 'weekly', pr));
  }
  if (data.length < 1000) break;
  from += 1000;
}
const orgFiles = writeChunks('organizations', orgUrls);

// ---- topics (public) ----
const topicUrls = [];
from = 0;
while (true) {
  const { data, error } = await sb.from('topics')
    .select('slug,updated_at')
    .eq('is_public', true)
    .order('id').range(from, from + 999);
  if (error) throw error;
  if (!data?.length) break;
  for (const t of data) {
    if (!t.slug) continue;
    topicUrls.push(tag(`${SITE}/temak/${esc(t.slug)}`, t.updated_at, 'weekly', '0.6'));
  }
  if (data.length < 1000) break;
  from += 1000;
}
const topicFiles = writeChunks('topics', topicUrls);

// ---- episodes (curated HU only; no recency cap, no ai_summary filter) ----
const epUrls = [];
from = 0;
while (true) {
  const { data, error } = await sb.from('episodes')
    .select('slug,published_at,updated_at,podcasts!inner(slug,language_decision,rank_label)')
    .eq('podcasts.language_decision', 'accept_hungarian')
    .order('id')
    .range(from, from + 999);
  if (error) throw error;
  if (!data?.length) break;
  for (const e of data) {
    if (!e.slug || !e.podcasts?.slug) continue;
    const ps = e.podcasts;
    const pr = ps.rank_label === 'S' ? '0.7' : ps.rank_label === 'A' ? '0.6' : '0.5';
    const lm = [e.updated_at, e.published_at].filter(Boolean).sort().pop();
    epUrls.push(tag(`${SITE}/podcast/${esc(ps.slug)}/${esc(e.slug)}`, lm, 'monthly', pr));
  }
  if (data.length < 1000) break;
  from += 1000;
}
const epFiles = writeChunks('episodes', epUrls);

// ---- sitemap.xml (index) ----
const lastmod = new Date().toISOString();
const entries = [
  `<sitemap><loc>${SITE}/sitemaps/pages.xml</loc><lastmod>${lastmod}</lastmod></sitemap>`,
  ...podFiles.map(f => `<sitemap><loc>${SITE}/sitemaps/${f}</loc><lastmod>${lastmod}</lastmod></sitemap>`),
  ...peopleFiles.map(f => `<sitemap><loc>${SITE}/sitemaps/${f}</loc><lastmod>${lastmod}</lastmod></sitemap>`),
  ...orgFiles.map(f => `<sitemap><loc>${SITE}/sitemaps/${f}</loc><lastmod>${lastmod}</lastmod></sitemap>`),
  ...topicFiles.map(f => `<sitemap><loc>${SITE}/sitemaps/${f}</loc><lastmod>${lastmod}</lastmod></sitemap>`),
  ...epFiles.map(f => `<sitemap><loc>${SITE}/sitemaps/${f}</loc><lastmod>${lastmod}</lastmod></sitemap>`),
];
const indexXml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</sitemapindex>\n`;
fs.writeFileSync('public/sitemap.xml', indexXml);
console.log('sitemap.xml index entries:', entries.length);
console.log('TOTAL URLs:', pages.length + podcasts.length + peopleUrls.length + orgUrls.length + topicUrls.length + epUrls.length);
