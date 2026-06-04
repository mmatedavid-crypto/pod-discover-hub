// Backfills the canonical `organizations` table + `episode_organization_map`
// from the already-extracted `episodes.organizations` jsonb (populated by
// entity-backfill-runner v3). Pure data-shuffling, no LLM calls.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const ORG_TYPES = new Set([
  "company","party","institution","media","ngo","sport_team","sport_league",
  "church","university","research","radio_station","other",
]);

// Whitelist: known Hungarian political parties — always classify as 'party'
// regardless of what the AI returned, plus seed canonical names.
const PARTY_WHITELIST: { name: string; aliases: string[]; color?: string; priority?: number }[] = [
  { name: "Fidesz", aliases: ["fidesz", "fidesz-kdnp", "fidesz - magyar polgári szövetség", "fidesz magyar polgári szövetség"], color: "#fd8100", priority: 100 },
  { name: "KDNP", aliases: ["kdnp", "kereszténydemokrata néppárt"], color: "#fd8100", priority: 90 },
  { name: "Tisza Párt", aliases: ["tisza", "tisza párt", "tisza part", "tisztelet és szabadság párt"], color: "#0a84ff", priority: 100 },
  { name: "DK", aliases: ["dk", "demokratikus koalíció", "demokratikus koalicio"], color: "#0066cc", priority: 80 },
  { name: "MSZP", aliases: ["mszp", "magyar szocialista párt"], color: "#cf2027", priority: 70 },
  { name: "Momentum", aliases: ["momentum", "momentum mozgalom"], color: "#8a2be2", priority: 80 },
  { name: "Jobbik", aliases: ["jobbik", "jobbik magyarországért mozgalom", "jobbik - konzervatívok"], color: "#1a4d2e", priority: 70 },
  { name: "Mi Hazánk", aliases: ["mi hazánk", "mi hazank", "mi hazánk mozgalom"], color: "#7b3f00", priority: 80 },
  { name: "LMP", aliases: ["lmp", "lehet más a politika"], color: "#80c342", priority: 60 },
  { name: "Párbeszéd", aliases: ["párbeszéd", "parbeszed", "párbeszéd magyarországért"], color: "#22a884", priority: 60 },
  { name: "Kutyapárt", aliases: ["kutyapárt", "kutyapart", "magyar kétfarkú kutya párt", "mkkp"], color: "#ff69b4", priority: 60 },
  { name: "Mü", aliases: ["mü", "munkáspárt", "magyar munkáspárt"], color: "#990000", priority: 50 },
];

const HIGH_VALUE_ORG_ALIASES: { name: string; aliases: string[]; type: string; priority?: number }[] = [
  { name: "Magyar Telekom", type: "company", priority: 95, aliases: ["telekom", "magyar telekom", "mtelekom", "mtel", "magyar telekom nyrt", "magyar telekom nyrt.", "telekom hu", "telekom hungary", "t-mobile hungary"] },
  { name: "Ferencvárosi Torna Club", type: "sport_team", priority: 95, aliases: ["ftc", "fradi", "ferencváros", "ferencvaros", "ferencvárosi torna club", "ferencvarosi torna club", "ferencvárosi tc", "ferencvarosi tc", "ferencvárosi torna klub", "ftc-telekom", "fradi.hu"] },
  { name: "OTP Bank", type: "company", priority: 90, aliases: ["otp", "otp bank", "otp nyrt", "otp bank nyrt", "otp bank nyrt."] },
  { name: "MOL", type: "company", priority: 90, aliases: ["mol", "mol nyrt", "mol nyrt.", "mol magyar olaj"] },
  { name: "Richter Gedeon Nyrt.", type: "company", priority: 88, aliases: ["richter", "richter gedeon", "gedeon richter", "richter gedeon nyrt", "richter gedeon nyrt."] },
  { name: "4iG", type: "company", priority: 86, aliases: ["4ig", "4ig nyrt", "4ig nyrt."] },
  { name: "MÁV", type: "institution", priority: 84, aliases: ["mav", "máv", "mav csoport", "máv csoport", "mav-start", "máv-start", "mav start"] },
  { name: "BKK", type: "institution", priority: 84, aliases: ["bkk", "budapesti közlekedési központ", "budapesti kozlekedesi kozpont"] },
  { name: "MVM", type: "company", priority: 84, aliases: ["mvm", "mvm csoport", "magyar villamos művek", "magyar villamos muvek"] },
];

function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    // strip common Hungarian legal forms
    .replace(/\b(nyrt|zrt|kft|bt|kkt|rt|gmbh|inc|llc|ltd|plc|co|corp|s\.?a\.?)\.?\b/gi, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ő/g, "o").replace(/ű/g, "u")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

function detectPartyOverride(name: string): { name: string; color?: string; priority?: number } | null {
  const norm = normalize(name);
  for (const p of PARTY_WHITELIST) {
    if (p.aliases.includes(norm)) return p;
  }
  return null;
}

function detectHighValueOrgOverride(name: string): { name: string; type: string; priority?: number } | null {
  const norm = normalize(name);
  for (const org of HIGH_VALUE_ORG_ALIASES) {
    if (org.aliases.map(normalize).includes(norm)) return org;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();
  const TIME_BUDGET_MS = 110_000;

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const guard = await checkBackgroundJobsAllowed(admin, "organizations-backfill-runner");
    if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });

    const body = await req.json().catch(() => ({}));
    const batch = Math.max(50, Math.min(2000, Number(body.batch) || 500));
    const seedOnly = body.seed_only === true;

    // Seed party whitelist (idempotent)
    let seeded = 0;
    for (const p of PARTY_WHITELIST) {
      const slug = slugify(p.name);
      const { data: existing } = await admin
        .from("organizations")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      if (!existing) {
        await admin.from("organizations").insert({
          slug,
          name: p.name,
          normalized_name: normalize(p.name),
          org_type: "party",
          political_color: p.color || null,
          manually_seeded: true,
          editorial_priority: true,
          editorial_priority_level: p.priority || 50,
        });
        seeded++;
      }
      // Insert aliases
      for (const a of p.aliases) {
        const { data: o } = await admin.from("organizations").select("id").eq("slug", slug).maybeSingle();
        if (o?.id) {
          await admin.from("organization_aliases").upsert(
            { organization_id: o.id, alias: a, normalized_alias: a, source: "whitelist", status: "accepted", confidence: 1 },
            { onConflict: "organization_id,normalized_alias", ignoreDuplicates: true } as any,
          );
        }
      }
    }

    // Seed high-value Hungarian organization aliases used by search/SEO/entity pages.
    // This prevents common names such as "Telekom", "MTEL", "Fradi" or "FTC"
    // from creating separate organization rows during the backfill.
    for (const org of HIGH_VALUE_ORG_ALIASES) {
      const slug = slugify(org.name);
      const { data: existing } = await admin
        .from("organizations")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      let orgId = existing?.id;
      if (!orgId) {
        const { data: created } = await admin.from("organizations").insert({
          slug,
          name: org.name,
          normalized_name: normalize(org.name),
          org_type: org.type,
          manually_seeded: true,
          editorial_priority: true,
          editorial_priority_level: org.priority || 80,
        }).select("id").single();
        orgId = created?.id;
        if (orgId) seeded++;
      }
      if (orgId) {
        for (const a of org.aliases) {
          await admin.from("organization_aliases").upsert(
            { organization_id: orgId, alias: a, normalized_alias: normalize(a), source: "high_value_alias_seed", status: "accepted", confidence: 0.98 },
            { onConflict: "normalized_alias", ignoreDuplicates: false } as any,
          );
        }
      }
    }

    if (seedOnly) {
      return json({ ok: true, seeded });
    }

    // Process episodes that have organizations jsonb but no map rows yet.
    // We track progress via app_settings.org_backfill_state cursor.
    const { data: stateRow } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "org_backfill_state")
      .maybeSingle();
    const cursor = stateRow?.value?.cursor || "1970-01-01T00:00:00Z";

    const { data: eps, error: epsErr } = await admin
      .from("episodes")
      .select("id, podcast_id, organizations, updated_at")
      .gte("ai_entities_version", 3)
      .not("organizations", "is", null)
      .gt("updated_at", cursor)
      .order("updated_at", { ascending: true })
      .limit(batch);
    if (epsErr) throw epsErr;
    const list = (eps || []) as any[];

    let episodes_seen = 0;
    let orgs_created = 0;
    let map_inserted = 0;
    let last_cursor = cursor;

    // Cache org lookups within this run
    const orgCache = new Map<string, string>(); // normalized_name -> org_id

    for (const ep of list) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) break;
      episodes_seen++;
      last_cursor = ep.updated_at;
      const raw = Array.isArray(ep.organizations) ? ep.organizations : [];
      if (!raw.length) continue;

      const mapRows: any[] = [];
      for (const item of raw) {
        if (!item || typeof item !== "object") continue;
        const rawName = String(item.name || "").trim();
        if (!rawName) continue;
        let type = ORG_TYPES.has(item.type) ? item.type : "other";
        const partyOverride = detectPartyOverride(rawName);
        const orgOverride = partyOverride ? null : detectHighValueOrgOverride(rawName);
        const canonicalName = partyOverride?.name || orgOverride?.name || rawName;
        const normalized = normalize(canonicalName);
        if (!normalized) continue;
        if (partyOverride) type = "party";
        else if (orgOverride && ORG_TYPES.has(orgOverride.type)) type = orgOverride.type;

        let orgId = orgCache.get(normalized);
        if (!orgId) {
          // Try by normalized_name OR alias
          const { data: byName } = await admin
            .from("organizations")
            .select("id")
            .eq("normalized_name", normalized)
            .maybeSingle();
          if (byName?.id) {
            orgId = byName.id;
          } else {
            const { data: byAlias } = await admin
              .from("organization_aliases")
              .select("organization_id")
              .eq("normalized_alias", normalized)
              .maybeSingle();
            if (byAlias?.organization_id) {
              orgId = byAlias.organization_id;
            } else {
              const slug = slugify(canonicalName) || `org-${Math.random().toString(36).slice(2, 8)}`;
              const { data: created, error: cErr } = await admin
                .from("organizations")
                .insert({
                  slug,
                  name: canonicalName,
                  normalized_name: normalized,
                  org_type: type,
                  political_color: partyOverride?.color || null,
                  editorial_priority_level: partyOverride?.priority || 0,
                })
                .select("id")
                .single();
              if (cErr) {
                // Likely slug collision — append suffix and retry once
                const altSlug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
                const { data: retry } = await admin
                  .from("organizations")
                  .insert({
                    slug: altSlug,
                    name: canonicalName,
                    normalized_name: normalized,
                    org_type: type,
                  })
                  .select("id")
                  .single();
                if (retry?.id) {
                  orgId = retry.id;
                  orgs_created++;
                }
              } else if (created?.id) {
                orgId = created.id;
                orgs_created++;
              }
            }
          }
          if (orgId) orgCache.set(normalized, orgId);
        }

        if (orgId) {
          const confidence = Math.max(0, Math.min(1, Number(item.confidence || 0.7)));
          mapRows.push({
            episode_id: ep.id,
            organization_id: orgId,
            podcast_id: ep.podcast_id,
            role: "mentioned",
            confidence,
            source: item.source || "ai",
            source_evidence: {
              extraction_version: item.evidence ? 5 : 4,
              evidence: item.evidence || null,
              raw_name: rawName,
              raw_type: item.type || null,
            },
          });
        }
      }

      if (mapRows.length) {
        const { error: mErr } = await admin
          .from("episode_organization_map")
          .upsert(mapRows, { onConflict: "episode_id,organization_id", ignoreDuplicates: true } as any);
        if (!mErr) map_inserted += mapRows.length;
      }
    }

    // Persist cursor
    if (episodes_seen > 0) {
      await admin.from("app_settings").upsert({
        key: "org_backfill_state",
        value: { cursor: last_cursor, updated_at: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      });
    }

    // Recompute gated counts (cheap RPC; runs across all orgs)
    if (episodes_seen > 0) {
      await admin.rpc("recompute_org_gated_counts").catch(() => {});
    }

    return json({
      ok: true,
      seeded,
      episodes_seen,
      orgs_created,
      map_inserted,
      cursor: last_cursor,
      elapsed_ms: Date.now() - startedAt,
      done: list.length === 0,
    });
  } catch (e: any) {
    return json({ error: e?.message || "error" }, 500);
  }
});
