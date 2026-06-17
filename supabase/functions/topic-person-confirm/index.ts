// topic-person-confirm: scans new episode_extracted_topics rows with kind='person_focus'
// and uses them as additional confirmation signal for person_episode_mentions.
//
// Behavior:
//   - Resolves raw_label → person via person_aliases (normalized) or people.canonical_name.
//   - If a mention already exists (person + episode): mark source_evidence.topic_extractor=true,
//     bump confidence to max(current, 0.9), bump role_confidence to max(current, 0.85).
//   - If no mention exists: insert one with source='topic_extractor_v1', mention_type='discussed',
//     confidence 0.8 (the topic extractor decided the episode is *about* this person).
//   - Cursor in app_settings.topic_person_confirm_state.last_created_at — incremental.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { canonicalizeHungarianPersonName } from "../_shared/hu-person-name.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: any, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

function normalize(s: string): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[.,;:()[\]{}"!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const guard = await checkBackgroundJobsAllowed(admin, "topic-person-confirm");
    if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });

    const body = await req.json().catch(() => ({}));
    const batchLimit = Math.max(100, Math.min(5000, Number(body.batch ?? 2000)));
    const maxRuntimeMs = Math.max(20000, Math.min(140000, Number(body.max_runtime_ms ?? 110000)));

    // Cursor
    const { data: stateRow } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "topic_person_confirm_state")
      .maybeSingle();
    const state = (stateRow?.value || {}) as any;
    let cursor: string = String(state.last_created_at || "1970-01-01T00:00:00Z");

    let totalScanned = 0;
    let totalMatched = 0;
    let totalInserted = 0;
    let totalBoosted = 0;
    let totalUnresolved = 0;
    let batches = 0;

    while (Date.now() - startedAt < maxRuntimeMs) {
      const { data: rows, error } = await admin
        .from("episode_extracted_topics")
        .select("id, episode_id, raw_label, confidence, rationale, created_at")
        .eq("kind", "person_focus")
        .gt("created_at", cursor)
        .order("created_at", { ascending: true })
        .limit(batchLimit);
      if (error) return json({ ok: false, error: error.message }, 500);
      if (!rows || rows.length === 0) break;

      batches++;
      totalScanned += rows.length;

      // Canonicalize labels + collect unique normalized aliases
      const labelMap = new Map<string, { canonical: string; rows: typeof rows }>();
      for (const r of rows) {
        const canon = canonicalizeHungarianPersonName(String(r.raw_label || "")).name;
        const key = normalize(canon || String(r.raw_label || ""));
        if (!key || key.length < 4) continue;
        const existing = labelMap.get(key);
        if (existing) existing.rows.push(r as any);
        else labelMap.set(key, { canonical: canon, rows: [r as any] });
      }

      const aliasKeys = Array.from(labelMap.keys());
      if (aliasKeys.length === 0) {
        cursor = String(rows[rows.length - 1].created_at);
        continue;
      }

      // Resolve via person_aliases (accepted only)
      const personByAlias = new Map<string, string>();
      const CHUNK = 200;
      for (let i = 0; i < aliasKeys.length; i += CHUNK) {
        const slice = aliasKeys.slice(i, i + CHUNK);
        const { data: aliases } = await admin
          .from("person_aliases")
          .select("person_id, normalized_alias, status, scope")
          .in("normalized_alias", slice)
          .in("status", ["accepted", "verified", "approved"]);
        for (const a of aliases || []) {
          // prefer global scope
          if (a.scope && a.scope !== "global") continue;
          const key = String(a.normalized_alias);
          if (!personByAlias.has(key)) personByAlias.set(key, String(a.person_id));
        }
      }

      // Fallback: people.canonical_name (lowercased) for unresolved keys
      const unresolvedKeys = aliasKeys.filter((k) => !personByAlias.has(k));
      if (unresolvedKeys.length > 0) {
        const canonicalsToCheck = unresolvedKeys.map((k) => labelMap.get(k)!.canonical).filter(Boolean);
        for (let i = 0; i < canonicalsToCheck.length; i += CHUNK) {
          const slice = canonicalsToCheck.slice(i, i + CHUNK);
          const { data: ppl } = await admin
            .from("people")
            .select("id, canonical_name, is_public")
            .in("canonical_name", slice);
          for (const p of ppl || []) {
            if (!p.is_public) continue;
            const key = normalize(String(p.canonical_name));
            if (!personByAlias.has(key)) personByAlias.set(key, String(p.id));
          }
        }
      }

      // Build (person_id, episode_id) pair list with evidence
      type Pair = { person_id: string; episode_id: string; confidence: number; rationale: string; raw_label: string };
      const pairs: Pair[] = [];
      for (const [key, entry] of labelMap.entries()) {
        const personId = personByAlias.get(key);
        if (!personId) { totalUnresolved += entry.rows.length; continue; }
        for (const r of entry.rows) {
          pairs.push({
            person_id: personId,
            episode_id: String(r.episode_id),
            confidence: Number(r.confidence || 0.8),
            rationale: String(r.rationale || "").slice(0, 400),
            raw_label: String(r.raw_label || ""),
          });
        }
      }

      totalMatched += pairs.length;

      if (pairs.length > 0) {
        // Dedupe by (person_id, episode_id), keep highest confidence
        const dedup = new Map<string, Pair>();
        for (const p of pairs) {
          const k = `${p.person_id}|${p.episode_id}`;
          const ex = dedup.get(k);
          if (!ex || p.confidence > ex.confidence) dedup.set(k, p);
        }
        const uniquePairs = Array.from(dedup.values());

        // Fetch existing mentions for these pairs
        const personIds = Array.from(new Set(uniquePairs.map((p) => p.person_id)));
        const episodeIds = Array.from(new Set(uniquePairs.map((p) => p.episode_id)));
        const existing = new Map<string, any>();
        for (let i = 0; i < personIds.length; i += 100) {
          const psl = personIds.slice(i, i + 100);
          for (let j = 0; j < episodeIds.length; j += 200) {
            const esl = episodeIds.slice(j, j + 200);
            const { data: ems } = await admin
              .from("person_episode_mentions")
              .select("id, person_id, episode_id, confidence, role_confidence, source_evidence")
              .in("person_id", psl)
              .in("episode_id", esl);
            for (const m of ems || []) existing.set(`${m.person_id}|${m.episode_id}`, m);
          }
        }

        // Split into inserts vs boosts
        const inserts: any[] = [];
        const boosts: Array<{ id: string; confidence: number; role_confidence: number; source_evidence: any }> = [];

        for (const p of uniquePairs) {
          const key = `${p.person_id}|${p.episode_id}`;
          const ex = existing.get(key);
          if (ex) {
            const newConf = Math.max(Number(ex.confidence || 0), 0.9);
            const newRole = Math.max(Number(ex.role_confidence || 0), 0.85);
            const se = (ex.source_evidence && typeof ex.source_evidence === "object") ? { ...ex.source_evidence } : {};
            se.topic_extractor = {
              confirmed: true,
              raw_label: p.raw_label,
              confidence: p.confidence,
              at: new Date().toISOString(),
            };
            // Only update if anything actually changes
            if (newConf !== Number(ex.confidence || 0) || newRole !== Number(ex.role_confidence || 0) || !ex.source_evidence?.topic_extractor) {
              boosts.push({ id: String(ex.id), confidence: newConf, role_confidence: newRole, source_evidence: se });
            }
          } else {
            inserts.push({
              person_id: p.person_id,
              episode_id: p.episode_id,
              mention_type: "discussed",
              confidence: Math.max(0.8, Math.min(1, p.confidence)),
              evidence: p.rationale || `Topic extractor: person_focus → ${p.raw_label}`,
              source: "topic_extractor_v1",
              role_type: "subject",
              role_confidence: 0.85,
              source_evidence: {
                topic_extractor: {
                  confirmed: true,
                  raw_label: p.raw_label,
                  confidence: p.confidence,
                  at: new Date().toISOString(),
                },
              },
            });
          }
        }

        // Apply inserts: need podcast_id — fetch from episodes
        if (inserts.length > 0) {
          const epIds = Array.from(new Set(inserts.map((i) => i.episode_id)));
          const podMap = new Map<string, string>();
          for (let i = 0; i < epIds.length; i += 200) {
            const { data: eps } = await admin
              .from("episodes")
              .select("id, podcast_id")
              .in("id", epIds.slice(i, i + 200));
            for (const e of eps || []) podMap.set(String(e.id), String(e.podcast_id));
          }
          const enriched = inserts
            .map((row) => ({ ...row, podcast_id: podMap.get(row.episode_id) }))
            .filter((row) => row.podcast_id);

          for (let i = 0; i < enriched.length; i += 500) {
            const { error: insErr } = await admin
              .from("person_episode_mentions")
              .insert(enriched.slice(i, i + 500));
            if (!insErr) totalInserted += enriched.slice(i, i + 500).length;
            else console.warn("insert err", insErr.message);
          }
        }

        // Apply boosts one-by-one (small set normally)
        for (const b of boosts) {
          const { error: upErr } = await admin
            .from("person_episode_mentions")
            .update({
              confidence: b.confidence,
              role_confidence: b.role_confidence,
              source_evidence: b.source_evidence,
            })
            .eq("id", b.id);
          if (!upErr) totalBoosted++;
        }
      }

      cursor = String(rows[rows.length - 1].created_at);
      // persist cursor each batch so we don't redo work on crash
      await admin
        .from("app_settings")
        .upsert({ key: "topic_person_confirm_state", value: { last_created_at: cursor, updated_at: new Date().toISOString() } });

      // PostgREST caps responses at ~1000 rows, so don't use rows.length as a "done" signal —
      // only stop on 0 rows or time budget.
      if (rows.length === 0) break;
    }

    return json({
      ok: true,
      batches,
      scanned: totalScanned,
      matched: totalMatched,
      inserted: totalInserted,
      boosted: totalBoosted,
      unresolved: totalUnresolved,
      cursor,
      runtime_ms: Date.now() - startedAt,
    });
  } catch (e) {
    console.error("topic-person-confirm err", e);
    return json({ ok: false, error: e instanceof Error ? e.message : "Unknown" }, 500);
  }
});
