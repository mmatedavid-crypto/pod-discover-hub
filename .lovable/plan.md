# Smart Player v2 — "pillanat-matching"

A jelenlegi panel egy unalmas similarity-listát ad ugyanazon RPC-ből. Van 134k chunk-embeddingünk (768d), amit eddig csak a kereső használ. Erre építünk.

## Mit fog érezni a user

A lejátszó kinyitásakor 3 jól elkülönülő sáv jelenik meg, mindegyik mellett konkrét WHY-jal:

1. **„Más műsorban erről beszélnek"** — chunk-szintű pillanat-match
   Pl. *Friderikusz Podcast · 23:14 — „…a Tisza párt választási stratégiája…" · 94% egyezés*
   Kattintásra a Smart Player átvált arra az epizódra ÉS a matching időbélyegen indítja.

2. **„Közös szereplők és témák"** — entity-overlap rail
   Pl. *Partizán epizód · közös: Magyar Péter, Tisza párt, választás 2026*
   Magyarázható, „miért látom ezt" típusú ajánlás.

3. **„Hasonló hangulat"** — meglévő vektor-similarity, de diverzifikálva
   Per-podcast max 1 epizód, hogy ne egy műsor uralja.

Minden kártya WHY-chipet kap (nem egy puszta % szám). Ez teszi „smart"-tá, nem a darabszám.

## Hogyan épül

### Backend — 1 új RPC

`smart_player_discover(p_episode_id uuid, p_limit int)` SECURITY DEFINER, visszaad:
- `episode_id, podcast_id, slug, podcast_slug, title, image_url, audio_url`
- `match_kind` enum: `chunk_moment` | `entity_overlap` | `vector_neighbor`
- `best_chunk_idx, best_char_start, best_char_end, snippet` (chunk-rail-nek)
- `seek_seconds` (becsült: `char_start / chars_per_second`, klipikből kalibrálva ~15)
- `similarity` (0..1)
- `shared_persons text[], shared_orgs text[], shared_topics text[]`
- `why_label text` (előre összerakott magyar címke a frontnak)

Logika:
1. Source-epizód top-8 leghosszabb chunkja
2. Mindegyikre HNSW kNN a `chunk_embeddings`-ben, **más podcastra szűrve**, limit 20
3. Aggregáció episode_id-ra: legjobb chunk-match marad
4. Párhuzamosan: shared persons/orgs/topics lekérése (overlaps), score-olás (közös elemek száma)
5. Vector-neighbor rail a meglévő `similar_episodes`-ből, cross-podcast szűrve
6. Diverzifikáció: per-podcast max 1 / rail
7. Egyik rail sem üres? → vegyes top-12

### Frontend

`RelatedEpisodes.tsx` lecserélve `SmartDiscoveryPanel.tsx`-re:
- 3 horizontális rail (header + scrollable cards)
- Card: image · cím · podcast · WHY-chip · play-gomb
- Chunk-rail kártyán „▶ 23:14-től" gomb — `play(ep, { startAt: seek_seconds })`
- `SmartPlayerProvider.play()` kap egy opcionális `startAt` paramétert, ami az audio `currentTime`-ot beállítja onLoad

`SmartPlayerBar` expanded view: a panel fölé egy mikro-statisztika: *„12 kapcsolódó pillanat 8 másik műsorban"* — ez ad valódi „smart" érzést.

### Mit NEM csinálunk most

- Personal taste-vector (nincs `taste_interactions` tábla, csak `taste_cards`; külön kör)
- Re-rank Cohere-rel (a chunk-similarity már elég erős, és latency-kritikus a sáv)
- Új embedding modell

## Mit kérek

Mehet így? Ha igen, megírom a migrációt + frontend cserét egyben.
