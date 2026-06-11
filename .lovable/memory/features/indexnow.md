---
name: IndexNow integration
description: Bing IndexNow ping setup — key file, edge function, daily cron
type: feature
---
**LIVE 2026-06-11**

- **Key**: `cd4aa0ff3daa6bff678ed60d1431affc45fcf9ef72ff14c90613492dc7c32f6a` (kódolva a CF workerben). Worker szolgálja `/<key>.txt` útvonalon (200, `text/plain`). Nincs `public/<key>.txt` fájl — felesleges, a worker mindkét hostra (apex + www) válaszol.
- **Edge function**: `indexnow-submit`
  - `POST {urls:[]}` → manuális, ad-hoc submit
  - `GET ?mode=recent&hours=24&max=3000` → utolsó N óra: új/frissített HU epizódok (`/podcast/{podSlug}/{epSlug}`), bumped podcastok, frissült indexable people/orgs + a `/` főoldal
  - 100 URL/batch, 1.5s delay, 429/403-nál azonnali backoff. IndexNow endpoint: `https://api.indexnow.org/IndexNow`
- **Cron jobid 91 `indexnow-submit-daily`** `15 5 * * *` UTC → `?hours=26&max=3000`. 26h overlap a 24h cron ellen, hogy egy elmaradt futás se ejtsen URL-eket.
- Tesztelve: 1071 URL / 11 batch → mind 200 OK. Egyetlen nagy batch (1071) viszont 403-at adott, ezért kell a 100-as bontás.
- Bővítés: ha új entitás-típus indexable lesz, vedd fel `collectRecent()`-be a megfelelő table+route prefixszel.
