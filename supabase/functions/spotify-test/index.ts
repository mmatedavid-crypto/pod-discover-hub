// Spotify Client Credentials smoke test.
// Fetches an app access token and runs a single show search to verify the API keys.
// No DB writes. Safe to call repeatedly.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const clientId = Deno.env.get('SPOTIFY_CLIENT_ID');
  const clientSecret = Deno.env.get('SPOTIFY_CLIENT_SECRET');

  if (!clientId || !clientSecret) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // Optional ?q=... override
  const url = new URL(req.url);
  const q = url.searchParams.get('q') ?? 'Partizán';
  const market = url.searchParams.get('market') ?? 'HU';

  try {
    // 1. Get access token (Client Credentials flow)
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      },
      body: 'grant_type=client_credentials',
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      return new Response(
        JSON.stringify({ ok: false, stage: 'token', status: tokenRes.status, body: text }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const tokenJson = await tokenRes.json();
    const accessToken = tokenJson.access_token as string;
    const expiresIn = tokenJson.expires_in as number;

    // 2. Search for a show in HU market
    const searchRes = await fetch(
      `https://api.spotify.com/v1/search?type=show&limit=5&market=${market}&q=${encodeURIComponent(q)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!searchRes.ok) {
      const text = await searchRes.text();
      return new Response(
        JSON.stringify({ ok: false, stage: 'search', status: searchRes.status, body: text }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const searchJson = await searchRes.json();
    const shows = (searchJson.shows?.items ?? []).map((s: any) => ({
      id: s.id,
      name: s.name,
      publisher: s.publisher,
      total_episodes: s.total_episodes,
      explicit: s.explicit,
      languages: s.languages,
      media_type: s.media_type,
      external_url: s.external_urls?.spotify,
      image: s.images?.[0]?.url ?? null,
    }));

    return new Response(
      JSON.stringify({
        ok: true,
        token_expires_in: expiresIn,
        query: q,
        market,
        result_count: shows.length,
        shows,
      }, null, 2),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: String(e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
