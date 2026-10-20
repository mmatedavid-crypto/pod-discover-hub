# Személyelsődleges névkeresés – 2026-10-20

Érintett projekt: Podiverzum HU (`yoxewklaybougzpmzvkg`). A `.com` projekt nem változott.

## Probléma

A `Hajós András` keresés 2026-10-20-án 14,5 mp után a böngészős tartalék keresőre esett. A szigorú névág
kapcsolatot nem használt (a katalógussor `identity_ambiguous=true`), és szinkron `ILIKE '%név%'` keresést
futtatott az `episodes.description` és az `episode_clean_text.cleaned_text` mezőkön (szekvenciális olvasás,
átlag ~2,1 mp, max ~7,8 mp), majd mindegyikre várt.

## Változás

- `supabase/functions/_shared/search-person-evidence.ts`: determinisztikus bizonyítéksorrend.
  1. elfogadott szereplő (vendég/műsorvezető) → 2. elfogadott „róla szól” → 3. elfogadott említés →
  4. függő/ellenőrzés alatti kapcsolat, **csak ha a teljes név szövegesen is igazolt** → 5. csak szöveges találat
  (cím → szereplőlista → leírás/tisztított szöveg).
  Elutasított kapcsolat soha nem bizonyíték; ilyen epizód legfeljebb „Szöveges találat”. A judge által adott
  `role_type` erősebb a nyers `mention_type`-nál. Stabil rendezés, azonos cím + nap duplikátum kiszűrve.
- `search-hybrid`: indexelt, korlátos lekérdezések (pontos `normalized_name`, elfogadott globális alias,
  kapcsolatok `person_id` szerint, `search_tsv` kifejezés, tisztított szöveg FTS, egy hidratálás id szerint),
  lekérdezésenként 2,5 mp korlát; a lassú forrás kiesik, a többi találat megmarad.
  Időzítés és lekérdezésszám a `timing.person_strict` mezőben (személyes adat nélkül).
- Identitás: csak egyetlen, biztonságos katalógusszemély kap kiemelést (`person_identity=verified`).
  Kétértelmű személy: `unconfirmed`, azonos nevű több személy: `multiple` – ilyenkor nincs kiemelés, nincs
  összevonás, a kapcsolat címkéje „· azonosság nem igazolt”, és a kereső „Azonos nevű személyek” /
  „Lehetséges személy” dobozt mutat.
- Az Oct19 teljesnév-illesztő változatlan: „Hajós Szilárd és S. Miller András” nem illeszkedik „Hajós András”-ra.
- Migráció (`drizzle/migrations/0062_person_search_clean_text_fts.sql`): GIN index
  `to_tsvector('simple', cleaned_text)` és `search_clean_text_name_candidates` (csak `service_role`).
  Az eredményt a teljesnév-illesztő ellenőrzi; nem identitásbizonyíték.
- Frontend (`SearchPage.tsx`): bizonyítékcímke a kártyán, azonos nevű személyek doboza, a böngészős
  személykiemelés nem választ, ha a pontos név több vagy nem igazolt személyhez tartozik. Közzététel szükséges.

## Mérés (élő, bot/lexikális út, AI-hívás nélkül)

| Keresés | Előtte | Utána | Megjegyzés |
|---|---|---|---|
| Hajós András | 5,6 mp (szerver), kliensen 14,5 mp időtúllépés | 0,7–1,0 mp, 8 lekérdezés | 17 találat; 11 vendég, 1 róla szól, 2 említés, 3 szöveges |
| hajos andras | 8,2 mp | 1,0 mp | azonos sorrend |
| Horváth Oszkár | – | 1,0 mp | `multiple`, 3 jelölt, nincs kiemelés |
| Orbán Viktor | – | 1,4 mp | kiemelés megmarad |
| Hajós Szilárd | – | 0,8 mp | a vitatott epizód a saját nevére jön |

Tisztított szöveg névkeresés: 2–7,8 mp szekvenciális olvasás → 5,6 ms indexes keresés.
Visszahívás: a korábbi 18 találatból 17 megmaradt; kiesett az „NZP – System down”, amelynek kapcsolatát
elutasították, és a név csak a nyers leírásban szerepel. A „Watches and Wonders” elutasított kapcsolata
miatt a lista végére, „Szöveges találat” címkével került.

Orbán Viktor 185 elfogadott szereplői kapcsolata egy `rss_status=failed` műsorhoz tartozik, ezért a meglévő
láthatósági szabály szerint nem jelenik meg; ezt a változás nem érinti.

## Kapcsolat-backlog (csak olvasás, 2026-10-20)

- 47 099 személy; 26 966 nyilvános+indexelhető; ebből 483 kétértelmű.
- 911 azonos normalizált nevű csoport (277 nyilvános+indexelhető csoportban 675 személy). Nem vonható össze automatikusan.
- Függő kapcsolatok nyilvános személyeknél: 156 374 szereplő, 30 858 említés, 607 „róla szól”; ellenőrzés alatt 4 065.
- Az elmúlt 90 nap látható magyar epizódjain, nyilvános személyeknél: 2 532 függő szereplői kapcsolat (817 személy),
  548 említés, 39 „róla szól”.
- `person_relevance_judge_controls.enabled=false`, `manually_paused_reason=chatgpt_direct_review_requested` – nem módosult.

## Javasolt ellenőrzési sorrend (emberi döntés, nem automatikus)

1. Friss (90 napos) látható epizódok függő szereplői kapcsolatai (2 532), személyenként csoportosítva.
2. A 483 kétértelmű, nyilvános személy közül a legtöbb keresést kapók: egyértelműsítő címke vagy szétválasztás.
3. A 277 nyilvános azonos nevű csoport: egyértelműsítő címkék; összevonás csak független emberi ellenőrzéssel.
4. A régi tömeges függő sor csak a fenti után, a feldolgozási prioritáskapu és a kreditfék betartásával.

Nem történt tömeges jóváhagyás, összevonás, törlés vagy AI-feldolgozás.
