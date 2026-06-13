// topic-cluster-runner: deterministic clustering of episode_extracted_topics
// into canonical Hungarian topic_clusters. NO AI calls. Idempotent.
//
// Usage: POST {} — clears existing clusters/map and rebuilds from scratch.
// Optional body: { dry_run: true } to only return stats without writing.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: any, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// Hungarian suffixes (longest first). Conservative.
const SUFFIXES = [
  "akkal","ekkel","aknak","eknek","aiban","eiben","ainak","einek","aival","eivel",
  "jának","jének","jaiban","jeiben","jaival","jeivel","jaitól","jeitől",
  "ban","ben","ról","ről","tól","től","nál","nél","val","vel","ról","ről",
  "kal","kel","kor","ra","re","ba","be","hoz","hez","höz",
  "nak","nek","ot","et","öt","at","ról","ről",
  "ja","je","juk","jük","ai","ei","ja","je","unk","ünk","atok","etek","ötök",
  "uk","ük","om","em","öm","od","ed","öd","ja","je","jük","juk",
  "od","ed","ja","je","k","i","a","e","t","s",
];

const STOP = new Set([
  "a","az","és","is","de","vagy","hogy","mert","csak","már","nem","igen","egy","ez","az","ott","itt",
  "podcast","epizod","epizód","adás","műsor","show","s01","s02","ep1","ep2",
]);

function stripAccents(s: string): string {
  return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

function tokenize(label: string): string[] {
  return label.toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/[\s-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

function stem(token: string): string {
  let t = token;
  // strip longest matching suffix once
  for (const sfx of SUFFIXES) {
    if (t.length > sfx.length + 2 && t.endsWith(sfx)) {
      t = t.slice(0, -sfx.length);
      break;
    }
  }
  // double-consonant collapse at end: "ban" → leave; "ssz" stays
  return stripAccents(t);
}

function clusterKey(label: string): string {
  const toks = tokenize(label).map(stem).filter((t) => t.length >= 2);
  if (toks.length === 0) return "";
  // sort tokens so "magyar péter" and "péter magyar" land together
  toks.sort();
  return toks.join(" ");
}

function slugify(s: string): string {
  return stripAccents(s.toLowerCase())
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// Manual alias map for the most common high-signal merges
const ALIASES: Record<string, string> = {
  "ai": "mesterséges intelligencia",
  "mi": "mesterséges intelligencia",
  "artificial intelligence": "mesterséges intelligencia",
  "gpt": "mesterséges intelligencia",
  "chatgpt": "mesterséges intelligencia",
  "llm": "mesterséges intelligencia",
  "openai": "mesterséges intelligencia",
  "gemini": "mesterséges intelligencia",
  "claude": "mesterséges intelligencia",
  "orbán": "orbán viktor",
  "orban": "orbán viktor",
  "magyar péter": "magyar péter",
  "péter magyar": "magyar péter",
  "tisza párt": "tisza párt",
  "tisza": "tisza párt",
  "fidesz": "fidesz",
  "putyin": "vlagyimir putyin",
  "vladimir putin": "vlagyimir putyin",
  "trump": "donald trump",
  "donald trump": "donald trump",
  "ukrajna háború": "orosz-ukrán háború",
  "ukrajnai háború": "orosz-ukrán háború",
  "orosz ukrán háború": "orosz-ukrán háború",
  "orosz-ukrán háború": "orosz-ukrán háború",
  "izrael hamász": "izrael-hamász háború",
  "izrael-hamász háború": "izrael-hamász háború",
  "gáza": "izrael-hamász háború",
  "klímaváltozás": "klímaváltozás",
  "klíma": "klímaváltozás",
  "fenntarthatóság": "fenntarthatóság",
  "önismeret": "önismeret",
  "pszichológia": "pszichológia",
  "mentális egészség": "mentális egészség",
  "meditáció": "meditáció",
  "alvás": "alvás",
  "vállalkozás": "vállalkozás",
  "startup": "startup",
  "gazdaság": "gazdaság",
  "tőzsde": "tőzsde",
  "kriptovaluta": "kriptovaluta",
  "krypto": "kriptovaluta",
  "bitcoin": "kriptovaluta",
  "labdarúgás": "labdarúgás",
  "foci": "labdarúgás",
  "futball": "labdarúgás",
  "társasjáték": "társasjátékok",
  "társasjátékok": "társasjátékok",
  "társasjáték ajánló": "társasjátékok",
  "tibor társasjáték klub": "társasjátékok",
  "jazz": "jazz",
  "elektronikus zene": "elektronikus zene",
  "imakérés": "imakérés",
  "kereszténység": "kereszténység",
  "biblia": "kereszténység",
  "evangélium": "kereszténység",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const dryRun = !!body.dry_run;
    const minEpisodesPerCluster = Number(body.min_episodes ?? 2);

    // 1) Load all extracted topics (paginated; Supabase caps at 1000 per request)
    const all: { episode_id: string; normalized_label: string; raw_label: string; confidence: number }[] = [];
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data, error } = await admin
        .from("episode_extracted_topics")
        .select("episode_id, normalized_label, raw_label, confidence")
        .order("episode_id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) return json({ ok: false, error: error.message, stage: "load" }, 500);
      if (!data || data.length === 0) break;
      for (const r of data) all.push(r as any);
      if (data.length < PAGE) break;
      from += PAGE;
      if (from > 400000) break; // safety
    }

    // 2) Cluster: label → key
    // Build label→canonical via alias overrides + key collapse
    type Bucket = { canonical: string; key: string; episodes: Set<string>; members: Set<string>; confSum: number; n: number };
    const byKey = new Map<string, Bucket>();
    for (const row of all) {
      const lbl = row.normalized_label.trim();
      if (!lbl) continue;
      const aliasHit = ALIASES[lbl] || ALIASES[stripAccents(lbl)];
      const canonical = aliasHit || lbl;
      const key = aliasHit ? slugify(aliasHit) : clusterKey(canonical);
      if (!key) continue;
      let b = byKey.get(key);
      if (!b) {
        b = { canonical, key, episodes: new Set(), members: new Set(), confSum: 0, n: 0 };
        byKey.set(key, b);
      }
      b.episodes.add(row.episode_id);
      b.members.add(lbl);
      b.confSum += Number(row.confidence || 0);
      b.n += 1;
      // Prefer the most common label within the bucket as canonical
      if (lbl.length < b.canonical.length || (aliasHit && lbl === aliasHit)) {
        // keep alias-driven canonical
        if (aliasHit) b.canonical = aliasHit;
      }
    }

    // For each bucket, choose canonical as the most frequent member label
    const memberCount = new Map<string, Map<string, number>>();
    for (const row of all) {
      const lbl = row.normalized_label.trim();
      if (!lbl) continue;
      const aliasHit = ALIASES[lbl] || ALIASES[stripAccents(lbl)];
      const canonical = aliasHit || lbl;
      const key = aliasHit ? slugify(aliasHit) : clusterKey(canonical);
      if (!key) continue;
      let m = memberCount.get(key);
      if (!m) { m = new Map(); memberCount.set(key, m); }
      m.set(lbl, (m.get(lbl) || 0) + 1);
    }
    for (const [key, b] of byKey) {
      const m = memberCount.get(key);
      if (!m) continue;
      // alias overrides take priority — only auto-pick if not aliased
      const aliasedTo = Array.from(b.members).find((l) => ALIASES[l]);
      if (aliasedTo) { b.canonical = ALIASES[aliasedTo]; continue; }
      let best = b.canonical; let bestN = 0;
      for (const [lbl, n] of m) { if (n > bestN) { best = lbl; bestN = n; } }
      b.canonical = best;
    }

    // 3) Filter clusters
    const eligible = Array.from(byKey.values()).filter((b) => b.episodes.size >= minEpisodesPerCluster);
    const stats = {
      total_rows: all.length,
      raw_keys: byKey.size,
      eligible_clusters: eligible.length,
      total_episode_assignments: eligible.reduce((a, b) => a + b.episodes.size, 0),
      distinct_episodes_covered: new Set(eligible.flatMap((b) => Array.from(b.episodes))).size,
    };

    if (dryRun) {
      const top = eligible
        .sort((a, b) => b.episodes.size - a.episodes.size)
        .slice(0, 50)
        .map((b) => ({ canonical: b.canonical, key: b.key, episodes: b.episodes.size, members: b.members.size }));
      return json({ ok: true, dry_run: true, stats, top_50: top, runtime_ms: Date.now() - startedAt });
    }

    // 4) Wipe old clusters (idempotent rebuild)
    await admin.from("episode_topic_cluster_map").delete().neq("episode_id", "00000000-0000-0000-0000-000000000000");
    await admin.from("topic_clusters").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    // 5) Insert clusters + capture id mapping
    const clusterRows = eligible.map((b) => ({
      slug: slugify(b.canonical) || slugify(b.key),
      canonical_label_hu: b.canonical,
      member_labels: Array.from(b.members).slice(0, 50),
      cluster_method: "deterministic_v1",
    }));
    // Dedup slugs
    const seen = new Map<string, number>();
    for (const r of clusterRows) {
      const base = r.slug || "klaszter";
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      if (n > 1) r.slug = `${base}-${n}`;
    }

    const idBySlug = new Map<string, string>();
    for (let i = 0; i < clusterRows.length; i += 500) {
      const slice = clusterRows.slice(i, i + 500);
      const { data, error } = await admin.from("topic_clusters").insert(slice).select("id, slug");
      if (error) return json({ ok: false, error: error.message, stage: "insert_clusters" }, 500);
      for (const r of data || []) idBySlug.set(r.slug, r.id);
    }

    // 6) Build map rows. Need slug per cluster — recompute.
    const mapRows: any[] = [];
    for (let i = 0; i < eligible.length; i++) {
      const b = eligible[i];
      const slug = clusterRows[i].slug;
      const id = idBySlug.get(slug);
      if (!id) continue;
      const avgConf = b.n > 0 ? Math.max(0, Math.min(1, b.confSum / b.n)) : 0.8;
      for (const epId of b.episodes) {
        mapRows.push({
          episode_id: epId,
          cluster_id: id,
          source_label: b.canonical,
          confidence: Number(avgConf.toFixed(3)),
        });
      }
    }

    let inserted = 0;
    for (let i = 0; i < mapRows.length; i += 1000) {
      const slice = mapRows.slice(i, i + 1000);
      const { error } = await admin.from("episode_topic_cluster_map").insert(slice);
      if (error) return json({ ok: false, error: error.message, stage: "insert_map", at: i }, 500);
      inserted += slice.length;
    }

    // 7) Recompute counts/indexable
    await admin.rpc("recompute_topic_cluster_counts");

    return json({
      ok: true,
      stats,
      inserted_clusters: clusterRows.length,
      inserted_map_rows: inserted,
      runtime_ms: Date.now() - startedAt,
    });
  } catch (e) {
    console.error("topic-cluster-runner err", e);
    return json({ ok: false, error: e instanceof Error ? e.message : "Unknown" }, 500);
  }
});
