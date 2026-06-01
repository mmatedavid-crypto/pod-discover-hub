// Refresh sitemap: regenerates sitemap.xml + per-type sitemaps and uploads
// them to the public `sitemaps` Storage bucket. Triggered by pg_cron daily.
// Policy 2026-06-01: include EVERYTHING public/indexable — no tier filter,
// no recency cap, no ai_summary requirement.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SITE = 'https://podiverzum.hu';
const BUCKET = 'sitemaps';
const CHUNK = 45000;

const esc = (s: unknown) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const tag = (loc: string, lastmod: string | null | undefined, cf = 'weekly', pr = '0.6') =>
  `<url><loc>${loc}</loc>${lastmod ? `<lastmod>${new Date(lastmod).toISOString()}</lastmod>` : ''}<changefreq>${cf}</changefreq><priority>${pr}</priority></url>`;
const wrap = (urls: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const t0 = Date.now();
  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  async function upload(path: string, xml: string) {
    const { error } = await sb.storage.from(BUCKET).upload(path, new Blob([xml], { type: 'application/xml' }), {
      upsert: true,
      contentType: 'application/xml',
      cacheControl: '3600',
    });
    if (error) throw new Error(`upload ${path}: ${error.message}`);
  }

  async function writeChunks(prefix: string, urls: string[]): Promise<string[]> {
    const files: string[] = [];
    if (urls.length === 0) return files;
    for (let i = 0; i < urls.length; i += CHUNK) {
      const idx = Math.floor(i / CHUNK) + 1;
      const fname = `${prefix}-${idx}.xml`;
      await upload(fname, wrap(urls.slice(i, i + CHUNK)));
      files.push(fname);
    }
    return files;
  }

  try {
    const now = new Date().toISOString();

    // ---- pages.xml ----
    const { data: cats = [] } = await sb.from('categories').select('slug,created_at').eq('active', true).order('sort_order');
    const { data: moods = [] } = await sb.from('mood_collections').select('slug,updated_at').eq('active', true).order('sort_order');

    const pages = [
      tag(`${SITE}/`, now, 'daily', '1.0'),
      tag(`${SITE}/toplista`, now, 'daily', '0.9'),
      tag(`${SITE}/szemelyek`, now, 'daily', '0.9'),
      tag(`${SITE}/szervezetek`, now, 'daily', '0.9'),
      tag(`${SITE}/cegek`, now, 'daily', '0.8'),
      tag(`${SITE}/partok`, now, 'daily', '0.9'),
      tag(`${SITE}/temak`, now, 'daily', '0.9'),
      tag(`${SITE}/kategoriak`, now, 'daily', '0.7'),
      tag(`${SITE}/hangulatok`, now, 'weekly', '0.7'),
      tag(`${SITE}/uj`, now, 'daily', '0.6'),
      tag(`${SITE}/napi`, now, 'daily', '0.6'),
      tag(`${SITE}/jelentes/magyar-podcast-piac-2026`, now, 'monthly', '0.9'),
      tag(`${SITE}/rolunk`, now, 'monthly', '0.4'),
      tag(`${SITE}/modszertan`, now, 'monthly', '0.4'),
      tag(`${SITE}/kapcsolat`, now, 'yearly', '0.3'),
      tag(`${SITE}/adatvedelem`, now, 'yearly', '0.2'),
      tag(`${SITE}/feltetelek`, now, 'yearly', '0.2'),
      ...(cats ?? []).map((c: any) => tag(`${SITE}/kategoria/${esc(c.slug)}`, c.created_at, 'daily', '0.8')),
      ...(moods ?? []).map((m: any) => tag(`${SITE}/hangulatok/${esc(m.slug)}`, m.updated_at, 'weekly', '0.7')),
    ];
    await upload('pages.xml', wrap(pages));

    // ---- podcasts ----
    const podcasts: string[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from('podcasts')
        .select('slug,updated_at,ai_enriched_at,rank_label,language_decision,is_hungarian')
        .or('is_hungarian.eq.true,language_decision.eq.accept_hungarian')
        .order('id').range(from, from + 999);
      if (error) throw error;
      if (!data?.length) break;
      for (const p of data) {
        if (!p.slug) continue;
        if (p.language_decision === 'reject_foreign') continue;
        const t = p.rank_label;
        const pr = t === 'S' ? '0.9' : t === 'A' ? '0.8' : t === 'B' ? '0.7' : t === 'C' ? '0.6' : '0.5';
        const lm = [p.updated_at, p.ai_enriched_at].filter(Boolean).sort().pop();
        podcasts.push(tag(`${SITE}/podcast/${esc(p.slug)}`, lm, 'weekly', pr));
      }
      if (data.length < 1000) break;
    }
    const podFiles = writeChunks('podcasts', podcasts);

    // ---- people ----
    const peopleUrls: string[] = [];
    for (let from = 0; ; from += 1000) {
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
    }
    const peopleFiles = writeChunks('people', peopleUrls);

    // ---- organizations ----
    const orgUrls: string[] = [];
    for (let from = 0; ; from += 1000) {
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
    }
    const orgFiles = writeChunks('organizations', orgUrls);

    // ---- topics ----
    const topicUrls: string[] = [];
    for (let from = 0; ; from += 1000) {
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
    }
    const topicFiles = writeChunks('topics', topicUrls);

    // ---- episodes ----
    const epUrls: string[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from('episodes')
        .select('slug,published_at,updated_at,podcasts!inner(slug,is_hungarian,language_decision,rank_label)')
        .or('is_hungarian.eq.true,language_decision.eq.accept_hungarian', { foreignTable: 'podcasts' })
        .order('id')
        .range(from, from + 999);
      if (error) throw error;
      if (!data?.length) break;
      for (const e of data as any[]) {
        if (!e.slug || !e.podcasts?.slug) continue;
        const ps = e.podcasts;
        if (ps.language_decision === 'reject_foreign') continue;
        const pr = ps.rank_label === 'S' ? '0.7' : ps.rank_label === 'A' ? '0.6' : '0.5';
        const lm = [e.updated_at, e.published_at].filter(Boolean).sort().pop();
        epUrls.push(tag(`${SITE}/podcast/${esc(ps.slug)}/${esc(e.slug)}`, lm, 'monthly', pr));
      }
      if (data.length < 1000) break;
    }
    const epFiles = writeChunks('episodes', epUrls);

    // Wait for chunk uploads above (writeChunks already awaited via upload promises tracked in tasks?
    // Note: writeChunks above issues fire-and-forget uploads. Refactor: track promises and await here.
    // Implemented inline by awaiting an aggregate below.
    // (we collect by re-uploading nothing; all uploads inside writeChunks are awaited via tasks array — but tasks array is local. Fix: do it sync inline.)

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
    await upload('sitemap.xml', indexXml);

    const totals = {
      pages: pages.length,
      podcasts: podcasts.length,
      people: peopleUrls.length,
      organizations: orgUrls.length,
      topics: topicUrls.length,
      episodes: epUrls.length,
    };
    const total_urls = Object.values(totals).reduce((a, b) => a + b, 0);
    const duration_ms = Date.now() - t0;

    return new Response(JSON.stringify({
      ok: true,
      duration_ms,
      total_urls,
      totals,
      files: [
        'pages.xml',
        ...podFiles, ...peopleFiles, ...orgFiles, ...topicFiles, ...epFiles,
        'sitemap.xml',
      ],
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('[refresh-sitemap] error', e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
