// Refresh sitemap: regenerates per-type sitemaps and uploads them to the
// public `sitemaps` Storage bucket. Triggered by pg_cron daily.
// Two run modes (CPU budget split):
//   ?type=lite      → pages + podcasts + people + organizations + topics + index
//   ?type=episodes  → episodes only + index
//   (default = lite)
// Each call updates `app_settings.sitemap_state` with its file list, then
// rebuilds sitemap.xml from the merged state so the index always works.
// Policy 2026-06-01: include EVERYTHING public/indexable — no tier filter.
// Policy 2026-06-03: Search Console submit is gated by newly added news URLs.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SITE = 'https://podiverzum.hu';
const BUCKET = 'sitemaps';
// Keep episode sitemap shards comfortably below Google limits and CDN/origin
// timeout-sensitive ~10 MB responses. 25k URLs is ~5–6 MB uncompressed.
const CHUNK = 25000;
const PAGE = 1000;

const esc = (s: unknown) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const tag = (loc: string, lastmod: string | null | undefined, cf = 'weekly', pr = '0.6') =>
  `<url><loc>${loc}</loc>${lastmod ? `<lastmod>${new Date(lastmod).toISOString()}</lastmod>` : ''}<changefreq>${cf}</changefreq><priority>${pr}</priority></url>`;
const wrap = (urls: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
const xmlUnescape = (s: string) => s
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'");
const extractXmlLocs = (xml: string): string[] =>
  Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g), (m) => xmlUnescape(m[1] || '').trim()).filter(Boolean);

const TRUSTED_NEWS_SOURCE_RX = /\b(444|telex|partizan|partizán|hvg|portfolio|hold|hold-after-hours|g7|qubit|direkt36|atlatszo|átlátszó|lakmusz|magyar-hang|magyar hang|valasz|válasz|inforadio|infostart|klubradio|szabad-europa|szabad európa|forbes|concorde)\b/i;
const NEWSWORTHY_CATEGORIES = new Set([
  'News & Politics',
  'Finance',
  'Business & Finance',
  'Technology',
  'Science',
  'Science & Ideas',
  'Sports',
  'History',
  'Society & Culture',
  'Education & Explainer',
]);
const NEWS_EXCLUDED_CATEGORIES = new Set([
  'Religion & Spirituality',
  'Kids & Family',
  'Fiction',
  'Music',
  'Sleep',
]);
const NEWS_TITLE_NOISE_RX = /\b(beköszönés|elköszönés|hangcsapda|játék|adásnapló|esti mese|napi biblia|igeidő|szentmise|áhítat|rövid változat|short version|trailer|előzetes)\b/i;
const NEWS_FOREIGN_NOISE_RX = /\b(seo\s*\+\s*ia|venta asistida|ecommerce|masterclass|sunday mood)\b/i;

type GoogleSubmitResult = {
  attempted: boolean;
  ok: boolean;
  status: number | null;
  reason: string | null;
};

function isTrustedNewsPodcast(p: any): boolean {
  const haystack = `${p?.slug || ''} ${p?.title || ''} ${p?.display_title || ''}`;
  return TRUSTED_NEWS_SOURCE_RX.test(haystack);
}

function isNewsworthyEpisode(e: any): boolean {
  const p = e?.podcasts || {};
  const title = String(e?.display_title || e?.title || '').trim();
  if (!title || !e?.slug || !p?.slug) return false;
  if (NEWS_TITLE_NOISE_RX.test(title) || NEWS_FOREIGN_NOISE_RX.test(title)) return false;
  if (NEWS_EXCLUDED_CATEGORIES.has(String(p?.category || ''))) return false;
  const trusted = isTrustedNewsPodcast(p);
  if (trusted) return true;
  const tier = String(p?.rank_label || '');
  return NEWSWORTHY_CATEGORIES.has(String(p?.category || '')) && ['S', 'A', 'B'].includes(tier);
}

function isSafePersonSitemapRow(p: any): boolean {
  if (!p?.slug || p.is_public !== true || p.is_indexable !== true) return false;
  if (!['indexable', 'manual_approved', null, undefined].includes(p.activation_status)) return false;
  if (['hide', 'reject'].includes(p.ai_recommended_action || '')) return false;
  if (['needs_human_review', 'duplicate_candidate'].includes(p.ai_review_status || '')) return false;
  if (p.identity_status === 'split_resolved') return false;
  const trustedWiki = p.wikipedia_match_status === 'verified' && Number(p.wikipedia_match_confidence || 0) >= 0.8;
  const temporalTopicOnly = p.has_archival_evidence !== true && p.manual_approved !== true && (
    p.is_deceased === true
    || p.is_historical === true
    || p.persona === 'historical'
    || p.date_of_death
    || p.is_living === false
  );
  if (temporalTopicOnly) return false;
  if (p.identity_ambiguous && !p.manual_approved && !trustedWiki) return false;
  return Number(p.gated_episode_count || p.episode_count || 0) >= 1;
}

function newsTag(loc: string, publishedAt: string, title: string) {
  return `<url>
  <loc>${esc(loc)}</loc>
  <news:news>
    <news:publication>
      <news:name>Podiverzum</news:name>
      <news:language>hu</news:language>
    </news:publication>
    <news:publication_date>${new Date(publishedAt).toISOString()}</news:publication_date>
    <news:title>${esc(title)}</news:title>
  </news:news>
</url>`;
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function submitGoogleSearchConsoleSitemap(feedpath: string): Promise<GoogleSubmitResult> {
  const lovableKey = Deno.env.get('LOVABLE_API_KEY');
  const connectionKey = Deno.env.get('GOOGLE_SEARCH_CONSOLE_API_KEY');
  if (!lovableKey || !connectionKey) {
    return { attempted: false, ok: false, status: null as number | null, reason: 'missing_lovable_gsc_connector_credentials' };
  }

  // GSC property identifier — hardcoded; not a secret. Domain property for podiverzum.hu.
  const siteUrl = Deno.env.get('GOOGLE_SEARCH_CONSOLE_SITE_URL') || 'sc-domain:podiverzum.hu';
  const endpoint = `https://connector-gateway.lovable.dev/google_search_console/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(feedpath)}`;
  const res = await fetch(endpoint, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      'X-Connection-Api-Key': connectionKey,
    },
  });
  if (res.status === 404) {
    return {
      attempted: true,
      ok: false,
      status: null,
      reason: 'lovable_gsc_connector_route_missing_404',
    };
  }
  return {
    attempted: true,
    ok: res.ok,
    status: res.status,
    reason: res.ok ? null : `lovable_gsc_submit_${res.status}`,
  };
}

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

  async function readExistingSitemapLocs(path: string): Promise<string[]> {
    const { data, error } = await sb.storage.from(BUCKET).download(path);
    if (error || !data) return [];
    return extractXmlLocs(await data.text());
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
        tag(`${SITE}/toplista/all-time`, now, 'weekly', '0.9'),
        tag(`${SITE}/szemelyek`, now, 'daily', '0.9'),
        tag(`${SITE}/cegek`, now, 'daily', '0.9'),
        tag(`${SITE}/partok`, now, 'daily', '0.9'),
        tag(`${SITE}/temak`, now, 'daily', '0.9'),
        tag(`${SITE}/szemelyek/abc`, now, 'weekly', '0.7'),
        tag(`${SITE}/cegek/abc`, now, 'weekly', '0.7'),
        tag(`${SITE}/temak/abc`, now, 'weekly', '0.7'),
        tag(`${SITE}/podcastok/abc`, now, 'weekly', '0.7'),
        tag(`${SITE}/kategoriak`, now, 'daily', '0.7'),
        tag(`${SITE}/hangulatok`, now, 'weekly', '0.7'),
        tag(`${SITE}/uj-podcastok`, now, 'daily', '0.6'),
        tag(`${SITE}/napi`, now, 'daily', '0.6'),
        tag(`${SITE}/te-podiverzumod`, now, 'weekly', '0.5'),
        tag(`${SITE}/heti`, now, 'weekly', '0.8'),
        tag(`${SITE}/jelentes/magyar-podcast-piac-2026`, now, 'monthly', '0.9'),
        tag(`${SITE}/intelligence`, now, 'weekly', '0.5'),
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

      // News sitemap — editorial posts + fresh, newsworthy Hungarian episodes.
      // Keep this aggressive enough for Partizán / Hold After Hours / Portfolio /
      // HVG / 444 / Telex, but gated enough that bedtime stories, daily prayers,
      // foreign SEO spam and radio filler do not pollute Google News.
      const NEWS_CUTOFF = Date.now() - 2 * 24 * 3600 * 1000;
      const seenNewsUrls = new Set<string>();
      const newsItems: string[] = [];
      const newsSourceCounts: Record<string, number> = {};
      const addNewsItem = (loc: string, publishedAt: string, title: string, source: string) => {
        if (newsItems.length >= 1000 || seenNewsUrls.has(loc)) return;
        seenNewsUrls.add(loc);
        newsSourceCounts[source] = (newsSourceCounts[source] || 0) + 1;
        newsItems.push(newsTag(loc, publishedAt, title));
      };

      // 1) Pin the weekly editorial hub at the very top of the news sitemap so
      //    Google sees the flagship column even when many fresh episodes follow.
      //    Use the most recent published_at as lastmod (or week_start fallback).
      const latestHetiTop = (hetiRows ?? [])[0] as any;
      if (latestHetiTop) {
        const hubLastmod = latestHetiTop.published_at || latestHetiTop.updated_at || latestHetiTop.week_start || new Date().toISOString();
        addNewsItem(`${SITE}/heti`, hubLastmod, 'Podiverzum Heti — magyar podcastfigyelő', 'Podiverzum Heti Hub');
      }

      (hetiRows ?? [])
        .filter((p: any) => p.published_at && new Date(p.published_at).getTime() >= NEWS_CUTOFF)
        .slice(0, 1000)
        .forEach((p: any) => {
          const slug = hetiSlugOf(p);
          const title = p.title || `Podiverzum Heti – ${p.week_start}`;
          addNewsItem(`${SITE}/heti/${slug}`, p.published_at, title, 'Podiverzum Heti');
        });

      const { data: freshEpisodes = [] } = await sb
        .from('episodes')
        .select('slug,title,display_title,published_at,podcasts!inner(slug,title,display_title,category,rank_label,language_decision,rss_status)')
        .gte('published_at', new Date(NEWS_CUTOFF).toISOString())
        // Canonical HU gate: language_decision is curated/AI-reviewed; the RSS HU flag is noisy.
        .eq('podcasts.language_decision', 'accept_hungarian')
        .order('published_at', { ascending: false })
        .limit(1500);

      // 2) Source-diversity caps. Previously trusted=40 / others=12 let Infostart
      //    eat ~60% of slots. Tighten to give Telex / 444 / HVG / Partizán / etc.
      //    room to surface across the 1000-URL budget. Two-pass: first a tight
      //    cap to maximize publisher diversity, then a backfill pass to use
      //    remaining slots without leaving the sitemap underfilled.
      const TRUSTED_CAP_PASS1 = 10;
      const OTHER_CAP_PASS1 = 6;
      const TRUSTED_CAP_PASS2 = 25;
      const OTHER_CAP_PASS2 = 12;
      const perPodcast = new Map<string, number>();
      const runPass = (cap: (trusted: boolean) => number) => {
        for (const ep of freshEpisodes ?? []) {
          if (newsItems.length >= 1000) break;
          if (!isNewsworthyEpisode(ep)) continue;
          const p = (ep as any).podcasts || {};
          if (['failed', 'inactive', 'deleted'].includes(String(p.rss_status || ''))) continue;
          const key = String(p.slug || '_');
          const limit = cap(isTrustedNewsPodcast(p));
          if ((perPodcast.get(key) || 0) >= limit) continue;
          const loc = `${SITE}/podcast/${p.slug}/${(ep as any).slug}`;
          if (seenNewsUrls.has(loc)) continue;
          perPodcast.set(key, (perPodcast.get(key) || 0) + 1);
          const title = String((ep as any).display_title || (ep as any).title || '').trim();
          addNewsItem(loc, (ep as any).published_at, title, String(p.display_title || p.title || p.slug || 'podcast'));
        }
      };
      runPass((trusted) => (trusted ? TRUSTED_CAP_PASS1 : OTHER_CAP_PASS1));
      if (newsItems.length < 600) {
        runPass((trusted) => (trusted ? TRUSTED_CAP_PASS2 : OTHER_CAP_PASS2));
      }

      const realNewsItemCount = newsItems.length;

      // Final empty-state fallback (should rarely trigger now that the /heti hub
      // is pinned above). Keep timestamp stable so it does not spam Search Console.
      if (newsItems.length === 0) {
        const latestHeti = (hetiRows ?? [])[0] as any;
        const fallbackDate = latestHeti?.updated_at || latestHeti?.published_at || latestHeti?.week_start || '2026-06-01T00:00:00.000Z';
        addNewsItem(`${SITE}/heti`, fallbackDate, 'Podiverzum Heti — magyar podcastfigyelő', 'fallback');
      }

      const newsXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${newsItems.join('\n')}
</urlset>
`;
      const newsHash = await sha256Hex(newsXml);
      const { data: newsStateRow } = await sb
        .from('app_settings')
        .select('value')
        .eq('key', 'news_sitemap_state')
        .maybeSingle();
      const previousState = (newsStateRow?.value as any) || {};
      const previousHash = previousState?.hash || null;
      const previousStateHasUrls = Array.isArray(previousState?.urls);
      const previousKnownUrls = previousStateHasUrls
        ? previousState.urls
        : await readExistingSitemapLocs('news-sitemap.xml');
      const hasReliablePreviousUrlBaseline = previousStateHasUrls || previousKnownUrls.length > 0;
      const previousUrls = new Set<string>(previousKnownUrls);
      await upload('news-sitemap.xml', newsXml);
      const currentUrls = Array.from(seenNewsUrls);
      const newUrls = currentUrls.filter((loc) => !previousUrls.has(loc));
      const changed = newsHash !== previousHash;
      const googleSubmitPolicy = 'submit_only_when_news_sitemap_has_new_urls';
      const shouldSubmitToGoogle = hasReliablePreviousUrlBaseline && newUrls.length > 0 && realNewsItemCount > 0;
      let googleSubmit: GoogleSubmitResult = {
        attempted: false,
        ok: false,
        status: null,
        reason: shouldSubmitToGoogle
          ? 'not_attempted'
          : !hasReliablePreviousUrlBaseline
            ? 'baseline_saved_without_submit'
            : changed
              ? 'changed_without_new_news_urls'
              : 'unchanged',
      };
      if (shouldSubmitToGoogle) {
        try {
          googleSubmit = await submitGoogleSearchConsoleSitemap(`${SITE}/news-sitemap.xml`);
        } catch (e) {
          googleSubmit = {
            attempted: true,
            ok: false,
            status: null,
            reason: `search_console_submit_error:${String((e as any)?.message || e).slice(0, 120)}`,
          };
        }
      }
      await sb.from('app_settings').upsert({
        key: 'news_sitemap_state',
        value: {
          hash: newsHash,
          previous_hash: previousHash,
          changed,
          urls: currentUrls,
          previous_url_source: previousStateHasUrls ? 'state' : 'existing_news_sitemap_xml',
          previous_url_baseline_reliable: hasReliablePreviousUrlBaseline,
          new_url_count: newUrls.length,
          new_urls_sample: newUrls.slice(0, 20),
          url_count: newsItems.length,
          real_news_item_count: realNewsItemCount,
          source_counts: newsSourceCounts,
          google_submit_policy: googleSubmitPolicy,
          google_submit_method: 'PUT',
          google_submit_attempted: googleSubmit.attempted,
          google_submit_ok: googleSubmit.ok,
          google_submit_status: googleSubmit.status,
          google_submit_reason: googleSubmit.reason,
          submit_needed: shouldSubmitToGoogle && !googleSubmit.ok,
          updated_at: new Date().toISOString(),
        },
      });



      // podcasts
      const podcasts: string[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await sb.from('podcasts')
          .select('slug,updated_at,ai_enriched_at,rank_label,language_decision')
          .eq('language_decision', 'accept_hungarian')
          .order('id').range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data?.length) break;
        for (const p of data) {
          if (!p.slug) continue;
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
          .select('slug,updated_at,latest_episode_at,is_public,is_indexable,activation_status,ai_recommended_action,ai_review_status,identity_status,identity_ambiguous,manual_approved,wikipedia_match_status,wikipedia_match_confidence,is_deceased,is_historical,has_archival_evidence,persona,is_topic_only,date_of_death,is_living,participant_count,host_count,guest_count,gated_episode_count,episode_count')
          .eq('is_public', true)
          .eq('is_indexable', true)
          .in('activation_status', ['indexable', 'manual_approved'])
          .order('id').range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data?.length) break;
        for (const p of data) {
          if (!isSafePersonSitemapRow(p)) continue;
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
          news: newsItems.length,
        },
        news_sitemap: {
          changed,
          new_url_count: newUrls.length,
          source_counts: newsSourceCounts,
          google_submit_policy: googleSubmitPolicy,
          google_submit_attempted: googleSubmit.attempted,
          google_submit_ok: googleSubmit.ok,
          google_submit_status: googleSubmit.status,
          google_submit_reason: googleSubmit.reason,
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
          .select('id,slug,rank_label,language_decision')
          .eq('language_decision', 'accept_hungarian')
          .order('id').range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data?.length) break;
        for (const p of data) {
          if (!p.slug) continue;
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
          const lm = [e.updated_at, e.published_at].filter(Boolean).sort().pop();
          // Fresh-episode crawl boost: episodes published within the last 7
          // days get priority 0.9 + changefreq=hourly so Googlebot revisits
          // them while the topic is still hot. Older episodes fall back to
          // tier-based priority (S=0.7, A=0.6, else 0.5) with monthly cadence.
          const ageDays = e.published_at
            ? (Date.now() - new Date(e.published_at).getTime()) / 86400000
            : Infinity;
          const isFresh = ageDays <= 7;
          const pr = isFresh
            ? '0.9'
            : ps.rank === 'S' ? '0.7' : ps.rank === 'A' ? '0.6' : '0.5';
          const cf = isFresh ? 'hourly' : 'monthly';
          current.push(tag(`${SITE}/podcast/${esc(ps.slug)}/${esc(e.slug)}`, lm, cf, pr));
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
