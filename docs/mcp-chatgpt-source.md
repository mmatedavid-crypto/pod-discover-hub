# Podiverzum MCP – ChatGPT / MCP-kliens forráslayer (fázis 2)

## Endpoint

- Publikus, read-only MCP endpoint: `https://<project>.supabase.co/functions/v1/mcp`
- Auth: nincs (anonim, csak publikus katalógus-adat)
- Definíció: `src/lib/mcp/index.ts`, tool-ok: `src/lib/mcp/tools/*`
- Verzió: `0.2.0`

## Tool-ok

| Tool | Cél |
| --- | --- |
| `search_podcasts` | Magyar podcastok keresése név/leírás alapján |
| `get_podcast` | Egy műsor adatai + legutóbbi 10 epizód |
| `search_episodes` | Hibrid (lexikai + szemantikus) epizódkeresés |
| `get_toplist` | Aktuális magyar toplista |
| `find_mentions` | Kanonikus, publikus **személy/szervezet** említései epizódokban |
| `get_episode_context` | Egy epizód biztonságos, publikus kontextusa groundinghoz |

## Szándékolt ChatGPT / Apps SDK folyamat

1. `search_episodes(query)` → releváns epizódok + `source_url`
2. `get_episode_context(episode)` → összefoglaló, személyek, szervezetek, témák
3. Megnevezett entitásra: `find_mentions(entity, entity_type?)` → kanonikus entitás + említő epizódok
4. Válaszban mindig a visszaadott publikus Podiverzum URL-re hivatkozzunk.

## Jogi határ (rights boundary)

A jelenlegi korpuszban az `episode_transcripts.public_display = false`, illetve
`rights_status = rss_public_index_only`. Ezért ebben a fázisban:

- **Semmilyen tool nem ad vissza átiratot, átirat-részletet, `episode_chunks` tartalmat vagy időbélyeges idézetet.**
- Az `evidence_phrase` mezők kizárólag az entitás-kinyerés (`person_episode_mentions.evidence`,
  `episode_organization_map.source_evidence.evidence`) rövid, már publikus metaadat-kivonatai:
  `evidence_kind: "extracted_metadata"`, max. 240 (find_mentions) / 160 (get_episode_context) karakter.
- `get_episode_context` visszaadja a `transcript_available_for_public_display` flaget, de a tartalmat
  akkor sem adja vissza, ha az `true`.
- Nem kerülnek ki belső AI-indoklások (`ai_reason`, `role_reason`), review-jegyzetek, nyers
  `source_evidence` JSON, cache/debug/understanding belsők (`stripForbidden` védőréteg,
  `src/lib/mcp/entityResolve.ts`).

## Entitásfeloldás

- Ékezet- és kisbetű-tűrő normalizálás (`normalizeEntityText`).
- Személy: `people.normalized_name`, majd `person_aliases` (`status='accepted'`).
- Szervezet: `organizations.normalized_name`, majd `organization_aliases` (`status='accepted'`).
- Csak publikus/indexelhető entitások; személyekre a prerender/JSON-LD-vel közös biztonsági kapu
  (`isSafeIndexablePerson`, `src/lib/personSchema.ts`).
- `entity_type: auto` a legerősebb biztonságos találatot választja (nagyobb gated epizódszám),
  így egy kétértelmű névre nem ad vissza két, egymással nem összefüggő entitást.
- `rejected` személy-említések és 0.6 alatti confidence-ű szervezet-említések kiesnek.

## Biztonsági megjegyzés – `search_episode_chunks`

A `public.search_episode_chunks(vector, integer, integer)` SECURITY DEFINER függvény korábban
`anon` és `authenticated` számára is futtatható volt, és `content_snippet`-et adhatott vissza a
transcript rights/`public_display` szűrés nélkül. Migrációval elvéve:

```sql
REVOKE EXECUTE ON FUNCTION public.search_episode_chunks(vector, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.search_episode_chunks(vector, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.search_episode_chunks(vector, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.search_episode_chunks(vector, integer, integer) TO service_role;
```

Ellenőrzött állapot (`pg_proc.proacl`): `postgres=X, service_role=X, readonly_codex=X` — anon és
authenticated nem futtathatja. A `search-hybrid` edge function service-role klienssel hívja, ezért a
keresés viselkedése változatlan.

## Jövőbeli út: licencelt, időbélyeges bizonyíték

Ha egy műsorra licenc/engedély rendelkezésre áll (`episode_transcripts.public_display = true` +
explicit `rights_status`), külön tool vezethető be (pl. `get_licensed_quotes`), amely csak az adott,
engedélyezett műsorokra ad szó szerinti, időbélyeges idézetet, világosan jelölt
`evidence_kind: "verbatim_transcript"` mezővel. A mostani tool-ok szerződése változatlan marad.
