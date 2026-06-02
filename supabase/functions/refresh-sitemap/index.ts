// Refresh sitemap: regenerates per-type sitemaps and uploads them to the
// public `sitemaps` Storage bucket. Triggered by pg_cron daily.
// Two run modes (CPU budget split):
//   ?type=lite      → pages + podcasts + people + organizations + topics + index
//   ?type=episodes  → episodes only + index
//   (default = lite)
// Each call updates `app_settings.sitemap_state` with its file list, then
// rebuilds sitemap.xml from the merged state so the index always works.
// Policy 2026-06-01: include EVERYTHING public/indexable — no tier filter.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SITE = 'https://podiverzum.hu';
const BUCKET = 'sitemaps';
const CHUNK = 45000;
const PAGE = 1000;

const esc = (s: unknown) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const tag = (loc: string, lastmod: string | null | undefined, cf = 'weekly', pr = '0.6') =>
  `<url><loc>${loc}</loc>${lastmod ? `<lastmod>${new Date(lastmod).toISOString()}</lastmod>` : ''}<changefreq>${cf}</changefreq><priority>${pr}</priority></url>`;
const wrap = (urls: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = new URL(req.url);
  const type = (url.searchParams.get('type') || 'lite').toLowerCase();
  const t0 = Date.now();

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  async function upload(path: string, xml: string) {
    const { error } = await sb.storage.from(BUCKET).upload(
      path,
      new Blob([xml], { type: 'application/xml' }),
      { upsert: true, contentType: 'application/xml', cacheControl: '3600' },
    );
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

  async function getState(): Promise<Record<string, string[]>> {
    const { data } = await sb.from('app_settings').select('value').eq('key', 'sitemap_state').maybeSingle();
    return (data?.value as Record<string, string[]>) || {};
  }
  async function setState(patch: Record<string, string[]>) {
    const cur = await getState();
    const next = { ...cur, ...patch, updated_at: [new Date().toISOString()] };
    await sb.from('app_settings').upsert({ key: 'sitemap_state', value: next });
  }

  async function rebuildIndex() {
    const st = await getState();
    const lastmod = new Date().toISOString();
    const order = ['pages', 'podcasts', 'people', 'organizations', 'topics', 'episodes'];
    const entries: string[] = [];
    for (const k of order) {
      const files = (st[k] as string[]) || [];
      for (const f of files) {
        entries.push(`<sitemap><loc>${SITE}/sitemaps/${f}</loc><lastmod>${lastmod}</lastmod></sitemap>`);
      }
    }
    const indexXml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</sitemapindex>\n`;
    await upload('sitemap.xml', indexXml);
    return entries.length;
  }

  try {
    const result: Record<string, unknown> = { type };

    if (type === 'lite') {
      // pages.xml
      const now = new Date().toISOString();
      const { data: cats = [] } = await sb.from('categories').select('slug,created_at').eq('active', true).order('sort_order');
      const { data: moods = [] } = await sb.from('mood_collections').select('slug,updated_at').eq('active', true).order('sort_order');

      // Podiverzum Heti — fetch published weekly columns once, reuse for pages.xml + news-sitemap.xml.
      const { data: hetiRows = [] } = await sb
        .from('editorial_posts')
        .select('week_start,week_end,title,published_at,updated_at')
        .eq('status', 'published')
        .order('week_start', { ascending: false })
        .limit(200);
      const HU_MAP: Record<string, string> = { á:'a',é:'e',í:'i',ó:'o',ö:'o',ő:'o',ú:'u',ü:'u',ű:'u',Á:'a',É:'e',Í:'i',Ó:'o',Ö:'o',Ő:'o',Ú:'u',Ü:'u',Ű:'u' };
      const slugifyHu = (s: string) => s.split('').map(c => HU_MAP[c] ?? c).join('').toLowerCase()
        .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'podiverzum-heti';
      const isoWeek = (dateStr: string) => {
        const d = new Date(`${dateStr}T00:00:00Z`);
        const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
        const dn = t.getUTCDay() || 7;
        t.setUTCDate(t.getUTCDate() + 4 - dn);
        const ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
        return { year: t.getUTCFullYear(), week: Math.ceil((((+t - +ys) / 86400000) + 1) / 7) };
      };
      const hetiSlugOf = (p: { week_start: string; title: string | null }) => {
        const { year, week } = isoWeek(p.week_start);
        return `${year}-${String(week).padStart(2,'0')}-${p.title ? slugifyHu(p.title) : 'podiverzum-heti'}`;
      };

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
        tag(`${SITE}/heti`, now, 'weekly', '0.8'),
        tag(`${SITE}/jelentes/magyar-podcast-piac-2026`, now, 'monthly', '0.9'),
        tag(`${SITE}/rolunk`, now, 'monthly', '0.4'),
        tag(`${SITE}/modszertan`, now, 'monthly', '0.4'),
        tag(`${SITE}/kapcsolat`, now, 'yearly', '0.3'),
        tag(`${SITE}/adatvedelem`, now, 'yearly', '0.2'),
        tag(`${SITE}/feltetelek`, now, 'yearly', '0.2'),
        ...(cats ?? []).map((c: any) => tag(`${SITE}/kategoria/${esc(c.slug)}`, c.created_at, 'daily', '0.8')),
        ...(moods ?? []).map((m: any) => tag(`${SITE}/hangulatok/${esc(m.slug)}`, m.updated_at, 'weekly', '0.7')),
        ...(hetiRows ?? []).map((p: any) => tag(`${SITE}/heti/${esc(hetiSlugOf(p))}`, p.updated_at || p.published_at, 'weekly', '0.7')),
      ];
      await upload('pages.xml', wrap(pages));

      // News sitemap — Google News namespace. 48h freshness window per spec.
      // Sources: (a) published Podiverzum Heti posts, (b) recent HU episodes.
      const NEWS_CUTOFF_MS = Date.now() - 2 * 24 * 3600 * 1000;
      const newsItems: string[] = [];

      for (const p of (hetiRows ?? []) as any[]) {
        if (!p.published_at) continue;
        if (new Date(p.published_at).getTime() < NEWS_CUTOFF_MS) continue;
        const slug = hetiSlugOf(p);
        const title = p.title || `Podiverzum Heti – ${p.week_start}`;
        newsItems.push(`<url>
  <loc>${SITE}/heti/${esc(slug)}</loc>
  <news:news>
    <news:publication>
      <news:name>Podiverzum</news:name>
      <news:language>hu</news:language>
    </news:publication>
    <news:publication_date>${new Date(p.published_at).toISOString()}</news:publication_date>
    <news:title>${esc(title)}</news:title>
  </news:news>
</url>`);
      }

      // Recent HU episodes (last 48h). Inner join via the HU podcast set we
      // already built for the main sitemap (looked up in podcasts ágban lentebb),
      // but here we do a focused query to keep this section self-contained.
      const cutoffIso = new Date(NEWS_CUTOFF_MS).toISOString();
      const { data: freshEps = [] } = await sb
        .from('episodes')
        .select('slug,title,published_at,podcasts!inner(slug,is_hungarian,language_decision)')
        .gte('published_at', cutoffIso)
        .order('published_at', { ascending: false })
        .limit(1500);
      for (const e of (freshEps ?? []) as any[]) {
        const pod = e.podcasts;
        if (!pod || !pod.slug || !e.slug || !e.title) continue;
        if (pod.language_decision === 'reject_foreign') continue;
        if (!(pod.is_hungarian === true || pod.language_decision === 'accept_hungarian')) continue;
        newsItems.push(`<url>
  <loc>${SITE}/podcast/${esc(pod.slug)}/${esc(e.slug)}</loc>
  <news:news>
    <news:publication>
      <news:name>Podiverzum</news:name>
      <news:language>hu</news:language>
    </news:publication>
    <news:publication_date>${new Date(e.published_at).toISOString()}</news:publication_date>
    <news:title>${esc(e.title)}</news:title>
  </news:news>
</url>`);
      }

      // Always include the /heti hub as a fallback so the sitemap is never empty
      // (Google News rejects sitemaps with zero items).
      if (newsItems.length === 0) {
        newsItems.push(`<url>
  <loc>${SITE}/heti</loc>
  <news:news>
    <news:publication>
      <news:name>Podiverzum</news:name>
      <news:language>hu</news:language>
    </news:publication>
    <news:publication_date>${new Date().toISOString()}</news:publication_date>
    <news:title>Podiverzum Heti — magyar podcastfigyelő</news:title>
  </news:news>
</url>`);
      }

      const newsXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${newsItems.join('\n')}
</urlset>
`;
      await upload('news-sitemap.xml', newsXml);



      // podcasts
      const podcasts: string[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await sb.from('podcasts')
          .select('slug,updated_at,ai_enriched_at,rank_label,language_decision,is_hungarian')
          .or('is_hungarian.eq.true,language_decision.eq.accept_hungarian')
          .order('id').range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data?.length) break;
        for (const p of data) {
          if (!p.slug || p.language_decision === 'reject_foreign') continue;
          const t = p.rank_label;
          const pr = t === 'S' ? '0.9' : t === 'A' ? '0.8' : t === 'B' ? '0.7' : t === 'C' ? '0.6' : '0.5';
          const lm = [p.updated_at, p.ai_enriched_at].filter(Boolean).sort().pop();
          podcasts.push(tag(`${SITE}/podcast/${esc(p.slug)}`, lm, 'weekly', pr));
        }
        if (data.length < PAGE) break;
      }
      const podFiles = await writeChunks('podcasts', podcasts);

      // people
      const peopleUrls: string[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await sb.from('people')
          .select('slug,updated_at,latest_episode_at')
          .eq('is_indexable', true).order('id').range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data?.length) break;
        for (const p of data) {
          if (!p.slug) continue;
          const lm = [p.latest_episode_at, p.updated_at].filter(Boolean).sort().pop();
          peopleUrls.push(tag(`${SITE}/szemelyek/${esc(p.slug)}`, lm, 'weekly', '0.6'));
        }
        if (data.length < PAGE) break;
      }
      const peopleFiles = await writeChunks('people', peopleUrls);

      // organizations
      const orgUrls: string[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await sb.from('organizations')
          .select('slug,updated_at,latest_episode_at,org_type')
          .eq('is_indexable', true).order('id').range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data?.length) break;
        for (const o of data) {
          if (!o.slug) continue;
          const lm = [o.latest_episode_at, o.updated_at].filter(Boolean).sort().pop();
          const pr = o.org_type === 'party' ? '0.7' : '0.6';
          orgUrls.push(tag(`${SITE}/ceg/${esc(o.slug)}`, lm, 'weekly', pr));
        }
        if (data.length < PAGE) break;
      }
      const orgFiles = await writeChunks('organizations', orgUrls);

      // topics
      const topicUrls: string[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await sb.from('topics')
          .select('slug,updated_at').eq('is_public', true).order('id').range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data?.length) break;
        for (const t of data) {
          if (!t.slug) continue;
          topicUrls.push(tag(`${SITE}/temak/${esc(t.slug)}`, t.updated_at, 'weekly', '0.6'));
        }
        if (data.length < PAGE) break;
      }
      const topicFiles = await writeChunks('topics', topicUrls);

      await setState({
        pages: ['pages.xml'],
        podcasts: podFiles,
        people: peopleFiles,
        organizations: orgFiles,
        topics: topicFiles,
      });
      const indexEntries = await rebuildIndex();

      Object.assign(result, {
        ok: true,
        totals: {
          pages: pages.length,
          podcasts: podcasts.length,
          people: peopleUrls.length,
          organizations: orgUrls.length,
          topics: topicUrls.length,
        },
        files: ['pages.xml', ...podFiles, ...peopleFiles, ...orgFiles, ...topicFiles],
        index_entries: indexEntries,
      });
    } else if (type === 'episodes') {
      // Fetch HU podcasts map once (small) to avoid PostgREST inner join cost
      // and per-row JSON re-parsing on 138k episodes.
      const podMap = new Map<string, { slug: string; rank: string | null }>();
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await sb.from('podcasts')
          .select('id,slug,rank_label,is_hungarian,language_decision')
          .or('is_hungarian.eq.true,language_decision.eq.accept_hungarian')
          .order('id').range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data?.length) break;
        for (const p of data) {
          if (!p.slug || p.language_decision === 'reject_foreign') continue;
          podMap.set(String(p.id), { slug: p.slug, rank: p.rank_label });
        }
        if (data.length < PAGE) break;
      }

      // Stream episodes, flush to Storage whenever current chunk hits CHUNK.
      let current: string[] = [];
      const epFiles: string[] = [];
      let chunkIdx = 0;
      async function flush() {
        if (!current.length) return;
        chunkIdx++;
        const fname = `episodes-${chunkIdx}.xml`;
        await upload(fname, wrap(current));
        epFiles.push(fname);
        current = [];
      }

      let total = 0;
      // Keyset pagination by id to keep PostgREST happy on large tables.
      let lastId: number | null = null;
      while (true) {
        let q = sb.from('episodes')
          .select('id,slug,published_at,updated_at,podcast_id')
          .order('id', { ascending: true })
          .limit(PAGE);
        if (lastId !== null) q = q.gt('id', lastId);
        const { data, error } = await q;
        if (error) throw error;
        if (!data?.length) break;
        for (const e of data as any[]) {
          lastId = e.id;
          if (!e.slug) continue;
          const ps = podMap.get(String(e.podcast_id));
          if (!ps) continue;
          const pr = ps.rank === 'S' ? '0.7' : ps.rank === 'A' ? '0.6' : '0.5';
          const lm = [e.updated_at, e.published_at].filter(Boolean).sort().pop();
          current.push(tag(`${SITE}/podcast/${esc(ps.slug)}/${esc(e.slug)}`, lm, 'monthly', pr));
          total++;
          if (current.length >= CHUNK) await flush();
        }
        if (data.length < PAGE) break;
      }
      await flush();

      await setState({ episodes: epFiles });
      const indexEntries = await rebuildIndex();

      Object.assign(result, {
        ok: true,
        totals: { episodes: total, hu_podcasts: podMap.size },
        files: epFiles,
        index_entries: indexEntries,
      });
    } else if (type === 'index') {
      const indexEntries = await rebuildIndex();
      Object.assign(result, { ok: true, index_entries: indexEntries });
    } else {
      return new Response(JSON.stringify({ ok: false, error: `unknown type: ${type}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    result.duration_ms = Date.now() - t0;
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[refresh-sitemap] error', e);
    return new Response(JSON.stringify({ ok: false, type, error: (e as Error).message, duration_ms: Date.now() - t0 }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
