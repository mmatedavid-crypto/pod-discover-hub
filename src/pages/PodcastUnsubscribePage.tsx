import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

type State = 'loading' | 'valid' | 'invalid' | 'done' | 'already' | 'error';

export default function PodcastUnsubscribePage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<State>('loading');
  const [podcastTitle, setPodcastTitle] = useState<string>('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setState('invalid');
      return;
    }
    (async () => {
      try {
        const r = await fetch(
          `${SUPABASE_URL}/functions/v1/podcast-unsubscribe?token=${encodeURIComponent(token)}`,
          { headers: { apikey: SUPABASE_ANON } },
        );
        const j = await r.json();
        if (j.podcast_title) setPodcastTitle(j.podcast_title);
        if (j.valid && j.already) setState('already');
        else if (j.valid) setState('valid');
        else setState('invalid');
      } catch {
        setState('error');
      }
    })();
  }, [token]);

  const confirm = async () => {
    setBusy(true);
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/podcast-unsubscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON },
        body: JSON.stringify({ token }),
      });
      const j = await r.json();
      if (j.podcast_title) setPodcastTitle(j.podcast_title);
      if (j.success && j.already) setState('already');
      else if (j.success) setState('done');
      else setState('error');
    } catch {
      setState('error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="max-w-md w-full border rounded-lg p-8 bg-card text-card-foreground">
        <h1 className="text-2xl font-semibold mb-4">Leiratkozás</h1>
        {state === 'loading' && <p className="text-muted-foreground">Token ellenőrzése…</p>}
        {state === 'valid' && (
          <>
            <p className="mb-4">
              Biztosan le szeretnél iratkozni a(z){' '}
              <strong>{podcastTitle || 'podcast'}</strong> új epizódjairól szóló emailekről?
            </p>
            <button
              onClick={confirm}
              disabled={busy}
              className="px-4 py-2 rounded bg-primary text-primary-foreground disabled:opacity-50"
            >
              {busy ? 'Folyamatban…' : 'Leiratkozás megerősítése'}
            </button>
          </>
        )}
        {state === 'done' && (
          <p>
            Sikeresen leiratkoztál {podcastTitle ? <>a(z) <strong>{podcastTitle}</strong> </> : ''}
            értesítésekről. Többé nem küldünk emailt erről a podcastról.
          </p>
        )}
        {state === 'already' && (
          <p>
            Ez a cím már le van iratkozva
            {podcastTitle ? <> a(z) <strong>{podcastTitle}</strong> értesítéseiről</> : ''}.
          </p>
        )}
        {state === 'invalid' && <p>Érvénytelen vagy lejárt link.</p>}
        {state === 'error' && <p>Hiba történt. Próbáld újra később.</p>}
      </div>
    </div>
  );
}
