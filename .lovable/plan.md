## Cél

A `bible-prefetch` ne üres placeholder-t rakjon ki 18:00 UTC-kor, hanem egy **tartalmas, ~700–1000 szavas oldalt**, amit a Google 7+ órán át indexálhat, mielőtt a Zarándok RSS 01:00 CEST-kor élesedik.

## Adatforrások (nem kell fordítanunk)

1. **Ascension "The Bible in a Year" hivatalos 365-napos terv** — nyilvános PDF. Napi 2–3 szentírási hivatkozás + Timeline periódus (12 db, pl. "Ősidők", "Pátriárkák", "Egyiptomi rabság", "Sivatagi vándorlás", "Honfoglalás", "Bírák", "Királyság", "Megosztott királyság", "Fogság", "Hazatérés", "Makkabeus", "Messiás").
2. **Magyar könyv-rövidítések** — Katolikus Egyház hivatalos rendje (Szent István Társulat): `Gen`→`Ter`, `Ex`→`Kiv`, `1 Sam`→`1 Sám`, `Ps`→`Zsolt`, stb. Fixed mapping, ~73 könyv.
3. **Perikópa szövege** — később, per epizód a zarandok.ma-ról scrape-elhető (`/N-nap-{slug}/`), amint publikálva van. Placeholder-be NEM tesszük (jogi/időbeli okból), csak a hivatkozásokat.
4. **AI elmélkedés** — Lovable AI Gateway, `google/gemini-3.5-flash`, magyar rendszer-prompt: „katolikus lelki elmélkedés, 350–450 szó, a napi szentírási olvasmányokra". Egyszer generálva, jégre tesszük az adatbázisban.

## Építkezés

### 1. Új tábla `bible_reading_plan` (migration)

```
day          smallint PRIMARY KEY  (1–365)
readings     text[]                (['Iz 9', 'Iz 10'])
readings_display text              ('Iz 9–10, 2 Kir 17, Zsolt 78')
period_hu    text                  ('Fogság')
period_intro text                  (rövid, ~1 mondat: „Izrael és Júda kettészakadása után…")
```

Grants + RLS anon SELECT. Seed insert: 365 sor egy admin-migration-ben (én generálom az Ascension PDF alapján, magyar könyvnevekkel).

### 2. `bible-prefetch` frissítés

- `nextDay` alapján kiolvassa a `bible_reading_plan` sort.
- Ha nincs sor → mai fallback (mostani placeholder marad).
- `description` + `ai_summary` felépítése:
  - **H2**: "N. nap – ma este 01:00-kor" (audio előtt)
  - Blokk: „Korszak: {period_hu}" + `period_intro`
  - Blokk: „Napi olvasmány: {readings_display}"
  - Blokk: AI elmélkedés 350–450 szó (LLM hívás, `google/gemini-3.5-flash`, HU prompt, rendszer: „katolikus atya hangja, első személyű reflekció, nem panasz, hitéleti kontextus")
  - Utolsó sor: „Ma este 01:00-kor Fábry Kornél püspök atya hangján is meghallgathatod."
- Mentés az `episodes` sorba (`description`, `ai_summary`, `seo_description`).
- Ping-ek (Google Indexing, IndexNow, sitemap) marad.

### 3. Költség és hatás

- **AI hívás**: ~1500 token/nap × `google/gemini-3.5-flash` ≈ $0.001/nap → elhanyagolható.
- **Placeholder tartalom**: 700–1000 szó → Google „thin content" nem fogja letiltani, indexálja.
- **Élesedéskor** a `fetch-one` merge-eli a valódi audio-t + RSS description-t; ekkor az AI-elmélkedést cseréljük a valódi Fábry-tartalomra (vagy megőrizzük extra-blokként — később eldönthető).

## Nem szerepel a plan-ban

- SZIT bibliai szöveg beemelése — külön fázis, ha kell (jogi tisztázás után).
- Zarandok.ma per-nap scraping — később a valódi perikópa-szöveghez, most nem.
- Múltbeli epizódok visszamenőleges dúsítása — csak jövőbeli placeholderekre.

## Kérdés hozzád indulás előtt

Az AI elmélkedés hangvétele:
(a) **Fábry-imitáló** ("Kedves testvéreim, ma este arról olvasunk…") — kockázat: fake identity.  
(b) **Semleges lelki reflekció** ("A mai olvasmány három szentírási helyet ölel át…") — biztonságosabb, egyértelműen szerkesztőségi.  
(c) **Kontextus-magyarázó** ("A Fogság korszakának 6. napján járunk…") — tanulmányi jelleg, SEO-erősebb.

Alapból (b)+(c) hibrid — jóváhagyod, vagy (a) legyen?
