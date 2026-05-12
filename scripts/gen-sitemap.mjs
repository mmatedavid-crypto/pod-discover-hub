import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const SITE = 'https://podiverzum.hu';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
const tag = (loc, lastmod, cf='daily', pr='0.6') =>
  `<url><loc>${loc}</loc>${lastmod?`<lastmod>${new Date(lastmod).toISOString()}</lastmod>`:''}<changefreq>${cf}</changefreq><priority>${pr}</priority></url>`;
const wrap = urls => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;

// ---- pages.xml (static + categories) ----
const { data: cats } = await sb.from('categories').select('slug,created_at').order('slug');
const now = new Date().toISOString();
const pages = [
  tag(`${SITE}/`, now, 'daily', '1.0'),
  tag(`${SITE}/search`, now, 'weekly', '0.5'),
  tag(`${SITE}/categories`, now, 'daily', '0.7'),
  tag(`${SITE}/about`, now, 'monthly', '0.4'),
  tag(`${SITE}/methodology`, now, 'monthly', '0.4'),
  tag(`${SITE}/new-podcasts`, now, 'daily', '0.6'),
  ...cats.map(c => tag(`${SITE}/category/${esc(c.slug)}`, c.created_at, 'daily', '0.8')),
];
fs.writeFileSync('public/sitemaps/pages.xml', wrap(pages));
console.log('pages.xml:', pages.length, 'urls');

// ---- podcasts-1.xml ----
const BAD = new Set(['needs_manual_rss_review','quarantined_spam','confirmed_dead']);
let from = 0, all = [];
while (true) {
  const { data, error } = await sb.from('podcasts')
    .select('slug,updated_at,ai_enriched_at,rss_status,rank_label,shadow_rank_components')
    .order('id').range(from, from + 999);
  if (error) throw error;
  if (!data?.length) break;
  for (const p of data) {
    if (p.rss_status === 'failed' || p.rss_status === 'inactive') continue;
    if (p.rank_label === 'E') continue;
    const hs = p.shadow_rank_components?.health_state;
    if (BAD.has(hs)) continue;
    const t = p.rank_label;
    const pr = t === 'S' ? '0.9' : t === 'A' ? '0.8' : t === 'B' ? '0.7' : t === 'C' ? '0.6' : '0.4';
    const lm = [p.updated_at, p.ai_enriched_at].filter(Boolean).sort().pop();
    all.push(tag(`${SITE}/podcast/${esc(p.slug)}`, lm, 'daily', pr));
  }
  if (data.length < 1000) break;
  from += 1000;
}
// chunk into 45k each
const CHUNK = 45000;
const podFiles = [];
for (let i = 0; i < all.length; i += CHUNK) {
  const idx = Math.floor(i / CHUNK) + 1;
  const fname = `podcasts-${idx}.xml`;
  fs.writeFileSync(`public/sitemaps/${fname}`, wrap(all.slice(i, i + CHUNK)));
  podFiles.push(fname);
  console.log(fname + ':', Math.min(CHUNK, all.length - i), 'urls');
}

// ---- sitemap.xml (index) ----
const lastmod = new Date().toISOString();
const entries = [
  `<sitemap><loc>${SITE}/sitemaps/pages.xml</loc><lastmod>${lastmod}</lastmod></sitemap>`,
  ...podFiles.map(f => `<sitemap><loc>${SITE}/sitemaps/${f}</loc><lastmod>${lastmod}</lastmod></sitemap>`),
];
const indexXml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</sitemapindex>\n`;
fs.writeFileSync('public/sitemap.xml', indexXml);
console.log('sitemap.xml index entries:', entries.length);
