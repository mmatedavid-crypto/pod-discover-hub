## Helyzetkép

- 61 097 epizód (60 555 HU). Cél: ≥100k → ~40k hiányzik.
- 15 829 epizódnak már van `ai_summary` (SEO runner munkája), de **0**-nak van entitása (people/companies/topics). Ezeket újra kell futtatni — de **csak entitás-extrakcióval**, az ai_summary maradhat.
- A maradék ~45k még feldolgozatlan: ezeknek mostantól **egyben** kell mennie (summary + entitások egy AI hívásban).

## Terv

### 1) Új SEO/summary feldolgozás leállítása, váltás kombinált pipeline-ra

- `seo-enrich-enqueue` cron (jobid 5) átállítása: csak akkor töltsön `seo_episode` jobokat, ha az episode-nak **nincs** ai_summary-je (ez már így megy). Új jobokat viszont az `ai-enrich` runner dolgozza fel, hogy egyszerre kapjon summary+entitást.
- Két út:
  - **A:** Új job-kind `enrich_episode_full` bevezetése, és új runner `ai-enrich-runner` (drain-loop, mint a seo-runneré, de Gemini tool-callinggal entitásokat is kér).
  - **B:** A meglévő `seo-enrich-runner`-be belerakjuk az entitás kinyerést (a `_shared/seo-prompt.ts` tool-schemájához hozzáadjuk: people/companies/tickers/topics/ingredients), és egy hívásban mindent visszakap. Olcsóbb (kevesebb új infra).
- **Választás: B.** Egyetlen prompt, egyetlen call, ugyanaz a runner; a táblát csak bővítjük.

### 2) 15 829 már-summarizált epizód entitás-backfillje

- Új edge function `entity-backfill-runner`: lapoz az `episodes`-ban (`ai_summary IS NOT NULL AND ai_entities_version = 0`), Gemini Flash Lite tool-call **csak** entitásokra (kisebb prompt, olcsóbb), bulk update people/companies/tickers/topics + `ai_entities_version=1`.
- Saját kis cron: `*/2 * * * *`, batch 100, drain-loop 110s. Becsült költség: 15 829 × ~$0.0003 ≈ **$5 össz**, 1–2 nap alatt lefut a $50/nap kereten belül (parallel a fő SEO drain-nel).

### 3) Epizódszám felhúzása ~100k-ra

Két párhuzamos forrás:

- **Deep hydration boost:** A 158 A-tier + 142 S-tier HU podcast nagy részénél a back-catalog még nincs lehúzva (`deep_done=0` mindenhol). A sprint cél most S=1000/A=600/B=300/C=100 epizód/pod — ez papíron **142×1000 + 158×600 + 312×300 + 38×100 = ~330k** kapacitás. Csak a runner cadence-én múlik. → A `deep-hydrate-runner` cron felgyorsítása `*/2`-ről `* * * * *`-re, amíg el nem érjük a 100k-t.
- **Új HU forrás keresés:** `ai-feed-scout` HU sources kibővítése (Apple HU charts, Spotify HU, gPodder HU, Listen Notes HU, magyar podcast aggregátorok). Ez napi 50–200 új feed-et hoz be → `pi-dump-process` automatikusan beemeli őket.

### Sorrend

1. Most: B opció — `seo-enrich-runner` + `_shared/seo-prompt.ts` bővítése entitásokkal (új feldolgozású ~45k egyben jön).
2. Most: új `entity-backfill-runner` + cron a 15 829 már-summarizált epizódra.
3. Most: `deep-hydrate-runner` cron `* * * * *`-ra (jobid 2), amíg a HU epizódszám ≥100k. Adaptív RPC visszaállítja, ha kifogynak a candidate-ek.
4. Most: `ai-feed-scout` HU forráslista bővítése (külön mini-PR, már részben megvolt).

### Költség / idő

- Kombinált runner (B): a már beállított $50/nap budget bőven elég, ai-summary az új 45k-n ugyanannyiba kerül mint korábban, az entitások járulékos +20% token.
- Backfill 15.8k: ~$5 össz, ~1 nap.
- Deep hydration: nincs AI költsége, csak fetch/parse.
- ETA: 100k epizód ~3–4 nap, teljes entitás-coverage ~3 nap.

## Technikai részletek

- `_shared/seo-prompt.ts` `EPISODE_SEO_TOOL` paraméterek bővítése: `people[]`, `companies[]`, `tickers[]`, `topics[]`, `ingredients[]` (max 6/lista, csak ha valóban szerepelnek). Strict JSON schema, `additionalProperties:false`.
- `seo-enrich-runner` parsed-handler: episode-update-be belerakni `people/companies/tickers/topics/ingredients` mezőket + `ai_entities_version=1`.
- `entity-backfill-runner`: külön function, saját kis tool csak entity arrays-szel, NEM ír seo_title/seo_description/ai_summary-be. Drain loop, $5/nap saját budget.
- `set_deep_hydration_schedule` RPC `*` cron-ra állítása amíg `count(episodes WHERE p.language='hu') < 100000`.

Indulás után ezt egy üzenetben követem (queue mélység, epizódszám, költés).
