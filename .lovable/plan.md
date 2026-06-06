## Cél
3 dolgot rendbe teszünk egy menetben:
- **(2+3)** A Codex által épített canonical-alias registry-t és az `organizations` táblát összerakjuk: 17 ismert duplikátumot biztonságosan összevonunk + a sérült variánsokat alias-ként eltesszük, hogy a jövőbeli AI-extraction is normalizáljon.
- **(4)** YouTube transcript drain rövid bump: 4592 `confirmed` pár még nincs lefuttatva.

---

## 1. Org-merge SQL függvény (migráció)

Új `public.merge_organizations(src_id uuid, dst_id uuid)` — SECURITY DEFINER, admin-only, tranzakcióban:

```text
1. UPDATE episode_organization_map SET organization_id = dst WHERE organization_id = src
   ON CONFLICT (episode_id, organization_id) DO NOTHING
2. DELETE duplikátumokat az ütközések után
3. UPDATE minden FK-tábla (ha van további reference) → dst
4. DELETE FROM organizations WHERE id = src
5. Audit log app_settings.org_merge_log JSON tömbbe (timestamp, src_slug, dst_slug, episode_count_moved)
RETURNS jsonb: { moved, deleted_dupes, deleted_org }
```

Mellé `audit_org_merge_candidates()` RPC, ami visszadobja a táblát (pl. többszörös név-variánsok normalizált alak alapján), hogy jövőre dry-runolni lehessen mielőtt mergelnénk.

## 2. 17 duplikátum összevonása (insert tool)

A `/mnt/documents/canonical_alias_org_merge_candidates.csv` 17 sora alapján:

```text
BCE                          → Budapesti Corvinus Egyetem
Corvinus Egyetem             → Budapesti Corvinus Egyetem
Budapesti Közlekedési Központ → BKK
Ferencváros, FTC-Telekom, Ferencvárosi TC, Ferencvárosi Torna Club, fradi.hu → Ferencvárosi Torna Klub
MÁV, MÁV-csoport, MÁV-START  → Magyar Államvasutak (MÁV)
MVM Csoport                  → MVM
OTP                          → OTP Bank
Richter                      → Richter Gedeon Nyrt.
Telekom, Telekom HU, Telekom Hungary → Magyar Telekom
```

Mindegyik `SELECT merge_organizations(src.id, dst.id)` hívás. Tranzakcióban, hogy bármelyik hiba esetén rollback.

## 3. Alias-seed (insert tool)

A 17 sérült variáns mind alias-ként felkerül a `canonical_entity_aliases`-be (`source='manual_merge_20260606'`, `weight=20`), hogy a future AI extraction is normalizálja:

```text
('BCE', 'budapesti-corvinus-egyetem', 'Budapesti Corvinus Egyetem')
('FTC', 'ferencvarosi-torna-klub', 'Ferencvárosi Torna Klub')
('Fradi', 'ferencvarosi-torna-klub', 'Ferencvárosi Torna Klub')
('fradi.hu', 'ferencvarosi-torna-klub', 'Ferencvárosi Torna Klub')
('Telekom', 'magyar-telekom', 'Magyar Telekom')
...
```

## 4. Post-merge ellenőrzés
- `recompute_org_gated_counts()` futtatása (gating újraszámol a megnövelt epizód-count miatt).
- Riport: hány epizód-org kapcsolat mozdult, mely org-ok mozdultak indexable-ba.

## 5. YouTube cron drain bump (insert tool, cron schema)

- Cron 64 (`youtube-transcript-fetch`): `*/30` → **`*/5`** 48 óra erejéig (4592 confirmed unattempted pair feldolgozása).
- Budget már védve: `monthly_credit_limit=30000`, watchdog `$25/nap × 1.1`.
- 48h múlva auto-revert nincs — manuálisan kell visszacsavarni `*/30`-ra (memory note frissítve).

## Technikai részletek (fejlesztőknek)

- Migráció: `merge_organizations` fn + `audit_org_merge_candidates` view.
- Insert ops: merge-hívások, alias-INSERT (ON CONFLICT DO NOTHING), cron UPDATE.
- Nincs frontend változás.
- Memory update a merge után: org count, indexable count, plus 2026-06-06 alias-backfill bejegyzés.

## Mit NEM csinálunk most
- Nem bővítjük a registry-t széles körben (csak ez a 17 + a hozzájuk tartozó aliasok). A nagyobb seed-bővítés (pl. `BKV`, `MTI`, `MTVA` rövidítések) külön kör — előbb mérjük, hogy ez a 17 mennyit javít.
- Nem nyúlunk a `people` táblához (a person-duplikátumok külön audit-ot kapnak).
- Nem futtatjuk a YT cron-t `*/2`-re vagy alá (cost védelem).
