## Cél
Az epizód `ai_summary` (és SEO + entitások) generálását kibővítjük úgy, hogy ha létezik `episode_transcripts.transcript`, azt használjuk elsődleges forrásként a rövid description helyett. Eredmény: jobb minőségű, ténylegesen tartalomalapú összefoglaló, ami automatikusan bekerül az episode embeddingbe is (mert az `ai_summary`-t embedeljük).

## Mit változtatunk

### 1. `_shared/seo-prompt.ts` — `episodeUserPrompt` kibővítése
- Új paraméter: `transcript?: string | null`.
- Ha van transcript: az AI-nak átadott blokk:
  ```
  Transcript excerpt (PRIMARY SOURCE — use this for summary and entities):
  <első ~4000 karakter>
  ```
  + `Description: ...` továbbra is, mint másodlagos kontextus (~800 char-ra vágva, hogy ne lopja a token-keretet).
- Ha nincs transcript: változatlan viselkedés.
- System promptba beillesztünk egy mondatot: "If a transcript excerpt is provided, base ai_summary, topics and entities on the transcript, not the description."

Token-költség: ~4000 char ≈ 1200-1500 token + ~600 token description és host blokk = nagyjából 3x a jelenlegi átlag. Flash-Lite-on ez ~$0.0008/epizód, max 5000 epizódra ~$4. Bőven a $5/nap seo-budget-en belül egy ütemezett re-run alatt.

### 2. `seo-enrich-runner/index.ts`
- Episode job ágában a célmező-fetchhez hozzáveszünk egy második queryt: `episode_transcripts.transcript` (LIMIT 1, a legfrissebb) — csak akkor, ha az episode-nak van transcriptje.
- Transcript szövege átadva `episodeUserPrompt`-nak.
- Sikeres update után új mezőt írunk: `ai_summary_source = 'transcript' | 'description'` (új oszlop) — így tudjuk, melyik epizódnak van már transcript-grounded summary-ja, és nem regeneráljuk újra.
- `ai_entities_version = 3` ha transcriptből készült (2 marad descriptionből), hogy fejlesztés esetén szelektíven re-enqueue-zhassuk.

### 3. DB migráció
- `ALTER TABLE episodes ADD COLUMN ai_summary_source text` (default NULL).
- Nincs új index, nincs RLS-változás.

### 4. `seo-enrich-enqueue` kiterjesztés — új pass
- Új ENQUEUE pass a meglévő 2 mellé: **pass 3** — epizódok ahol `EXISTS(episode_transcripts)` ÉS (`ai_summary_source IS NULL` VAGY `ai_summary_source <> 'transcript'`).
- Limit pass-onként: `max_transcript_regen_per_run = 200` (külön kontrollba), hogy ne pörgesse fel a queue-t robbanásszerűen.
- Ugyanaz az `input_hash` schema (hozzávesszük a `transcript_content_hash`-t a hash bemenetébe, hogy NE conflict-eljen a régi description-alapú joboknál).

### 5. Mit NEM csinálunk most
- Nem chunkoljuk a transcriptet (külön chunk-tábla + chunk-embedding = a search v13 "chunk-aug" terv, halasztva). Most a teljes ai_summary egy regenerálódik a transcript első ~4k karaktere alapján.
- Nem nyúlunk a `embed-episode-runner`-hez — az úgyis a frissített `ai_summary` alapján fog embedelni a következő ciklusban.
- Nem indítunk azonnal ezres méretű regen-batchet. Először a default `*/5` cadence-szel a meglévő 191 transcripted epizódra fut le (1 menet), majd nézzük az eredményt minőségileg.

## Várt hatás
- A 191 transcripted epizód `ai_summary`-ja órákon belül lecserélődik tartalomalapú (nem leírás-alapú) változatra.
- Az `embed-episode-runner` 30 percen belül észleli a változást (content_hash változik) és újraembedeli őket.
- Search v13-ban ezek az epizódok jobb találatok lesznek long-tail és idézet-szerű query-kre.
- Költség: ~$0.0008/epizód × 191 ≈ $0.15 az első körre.

## Technikai részletek
- Új DB oszlop: `episodes.ai_summary_source text` NULL default.
- `seo-prompt.ts`: új paraméter + új transcript prompt-szekció.
- `seo-enrich-runner`: transcript fetch + paraméter átadás + `ai_summary_source` írás + `ai_entities_version=3`.
- `seo-enrich-enqueue`: pass 3 új SQL query (LEFT JOIN `episode_transcripts`).
- Hash sémába hozzáadva: `transcript_hash` field (csak ha van), így ugyanaz az episode kétféle hash-csel kerül queue-ba (régi description-alapú + új transcript-alapú).
