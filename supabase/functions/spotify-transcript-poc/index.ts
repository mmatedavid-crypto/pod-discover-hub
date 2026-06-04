// Spotify auto-transcript PoC
// Tries to fetch Spotify's auto-generated transcripts for HU episodes
// via the reverse-engineered Web Player endpoint. No DB writes.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SB_URL = Deno.env.get('SUPABASE_URL')!
const SB_SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

async function getAccessToken(): Promise<{ accessToken: string; clientId: string }> {
  const r = await fetch('https://open.spotify.com/get_access_token?reason=transport&productType=web_player', {
    headers: { 'User-Agent': UA, 'Accept': 'application/json' },
  })
  if (!r.ok) throw new Error(`get_access_token failed: ${r.status} ${await r.text()}`)
  const j = await r.json()
  return { accessToken: j.accessToken, clientId: j.clientId }
}

async function getClientToken(clientId: string): Promise<string> {
  const r = await fetch('https://clienttoken.spotify.com/v1/clienttoken', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': UA,
    },
    body: JSON.stringify({
      client_data: {
        client_version: '1.2.46.25.g7f5e2865',
        client_id: clientId,
        js_sdk_data: {
          device_brand: 'unknown',
          device_model: 'unknown',
          os: 'linux',
          os_version: 'unknown',
          device_id: crypto.randomUUID().replace(/-/g, ''),
          device_type: 'computer',
        },
      },
    }),
  })
  if (!r.ok) throw new Error(`clienttoken failed: ${r.status} ${await r.text()}`)
  const j = await r.json()
  return j?.granted_token?.token ?? ''
}

async function fetchTranscript(episodeId: string, accessToken: string, clientToken: string) {
  const url = `https://spclient.wg.spotify.com/transcript-read-along/v2/episode/${episodeId}?format=json&platform=web`
  const r = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      'App-Platform': 'WebPlayer',
      'Spotify-App-Version': '1.2.46.25.g7f5e2865',
      'Client-Token': clientToken,
      'User-Agent': UA,
    },
  })
  const txt = await r.text()
  let json: any = null
  try { json = JSON.parse(txt) } catch (_) {}
  return { status: r.status, json, raw: txt.slice(0, 400) }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supa = createClient(SB_URL, SB_SR)

    // Two-step fetch since FK not declared
    const { data: meta, error: e1 } = await supa
      .from('episode_spotify_meta')
      .select('episode_id, spotify_episode_id')
      .not('spotify_episode_id', 'is', null)
      .limit(200)
    if (e1) throw e1

    const epIds = (meta ?? []).map((m: any) => m.episode_id)
    const { data: eps, error: e2 } = await supa
      .from('episodes')
      .select('id, title, podcast_id, podcasts!inner(id, title, language)')
      .in('id', epIds)
      .ilike('podcasts.language', 'hu%')
      .limit(200)
    if (e2) throw e2

    const metaById: Record<string, string> = {}
    for (const m of meta ?? []) metaById[m.episode_id] = m.spotify_episode_id

    // dedupe per podcast (max 3), prefer Telex / Partizán
    const preferred = (t: string) => /telex|partizán|partizan|444|index|mindset|24\.hu/i.test(t || '')
    const sorted = (eps ?? []).sort((a: any, b: any) =>
      Number(preferred(b.podcasts?.title)) - Number(preferred(a.podcasts?.title))
    )
    const perPodcast: Record<string, number> = {}
    const picks: any[] = []
    for (const e of sorted) {
      const pid = e.podcast_id
      perPodcast[pid] = (perPodcast[pid] || 0) + 1
      if (perPodcast[pid] <= 3) picks.push({
        episodes: e,
        spotify_episode_id: metaById[e.id],
      })
      if (picks.length >= 20) break
    }

    if (picks.length === 0) {
      return new Response(JSON.stringify({ ok: false, reason: 'no_samples' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { accessToken, clientId } = await getAccessToken()
    let clientToken = ''
    try { clientToken = await getClientToken(clientId) } catch (e) {
      console.warn('clienttoken fetch failed, proceeding without:', String(e))
    }

    const results: any[] = []
    for (const s of picks) {
      const sid = s.spotify_episode_id
      try {
        const r = await fetchTranscript(sid, accessToken, clientToken)
        const segs: any[] = r.json?.section ?? r.json?.sections ?? r.json?.transcript ?? []
        const segCount = Array.isArray(segs) ? segs.length : 0
        const text = Array.isArray(segs)
          ? segs.map((x: any) => x?.text || x?.body || '').filter(Boolean).join(' ').slice(0, 500)
          : ''
        results.push({
          podcast: s.episodes.podcasts.title,
          ep_title: s.episodes.title?.slice(0, 80),
          spotify_id: sid,
          status: r.status,
          has_transcript: r.status === 200 && segCount > 0,
          segments: segCount,
          sample: text.slice(0, 200),
          raw_keys: r.json ? Object.keys(r.json).slice(0, 8) : null,
          raw_preview: r.status !== 200 ? r.raw : null,
        })
      } catch (e) {
        results.push({ spotify_id: sid, error: String(e) })
      }
      await new Promise(r => setTimeout(r, 800)) // 800ms throttle
    }

    const hits = results.filter(r => r.has_transcript).length
    const summary = {
      tested: results.length,
      hits,
      hit_rate: results.length ? (hits / results.length) : 0,
      status_distribution: results.reduce((acc: any, r) => { acc[r.status ?? 'err'] = (acc[r.status ?? 'err'] || 0) + 1; return acc }, {}),
      have_client_token: !!clientToken,
    }

    return new Response(JSON.stringify({ ok: true, summary, results }, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    const msg = e?.message || e?.toString?.() || JSON.stringify(e)
    return new Response(JSON.stringify({ ok: false, error: msg, stack: e?.stack?.split('\n').slice(0,5) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
