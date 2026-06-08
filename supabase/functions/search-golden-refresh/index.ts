import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Controls = {
  enabled?: boolean;
  catalog_limit_per_type?: number;
  popular_limit?: number;
  external_chart_limit?: number;
  external_seed_limit?: number;
};

const DEFAULT_CONTROLS: Required<Controls> = {
  enabled: true,
  catalog_limit_per_type: 80,
  popular_limit: 40,
  external_chart_limit: 120,
  external_seed_limit: 100,
};

const ENTITY_QUERY_TYPES = ["person", "company_brand", "company_brand_alias", "topic"];
const MIN_ENTITY_GOLDENS = 60;
const MIN_ENTITY_QUERY_TYPES = 4;

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

async function loadEntityMonitoringCoverage(supa: ReturnType<typeof createClient>) {
  const { data, error } = await supa
    .from("search_golden_queries")
    .select("query_type, expected_entity")
    .eq("active", true)
    .not("expected_entity", "is", null)
    .in("query_type", ENTITY_QUERY_TYPES);

  if (error) {
    return {
      ok: false,
      policy: "managed_entity_monitoring_v3_coverage_after_refresh",
      error: error.message,
      min_entity_goldens: MIN_ENTITY_GOLDENS,
      min_entity_query_types: MIN_ENTITY_QUERY_TYPES,
    };
  }

  const rows = data || [];
  const queryTypes = Array.from(new Set(rows.map((row: any) => String(row.query_type || "")).filter(Boolean))).sort();

  return {
    ok: rows.length >= MIN_ENTITY_GOLDENS && queryTypes.length >= MIN_ENTITY_QUERY_TYPES,
    policy: "managed_entity_monitoring_v3_coverage_after_refresh",
    active_entity_goldens: rows.length,
    active_entity_query_types: queryTypes.length,
    query_types: queryTypes,
    min_entity_goldens: MIN_ENTITY_GOLDENS,
    min_entity_query_types: MIN_ENTITY_QUERY_TYPES,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();
  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  try {
    const { data: settings } = await supa
      .from("app_settings")
      .select("value")
      .eq("key", "search_golden_refresh_controls")
      .maybeSingle();
    const controls: Required<Controls> = { ...DEFAULT_CONTROLS, ...((settings?.value as Controls | null) || {}) };

    if (controls.enabled === false) {
      const result = { ok: true, skipped: true, reason: "disabled", elapsed_ms: Date.now() - startedAt };
      await supa.from("app_settings").upsert({
        key: "search_golden_refresh_progress",
        value: { ...result, last_run_at: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" });
      return json(result);
    }

    const catalogLimit = clampInt(controls.catalog_limit_per_type, DEFAULT_CONTROLS.catalog_limit_per_type, 5, 200);
    const popularLimit = clampInt(controls.popular_limit, DEFAULT_CONTROLS.popular_limit, 0, 200);
    const chartLimit = clampInt(controls.external_chart_limit, DEFAULT_CONTROLS.external_chart_limit, 10, 300);
    const seedLimit = clampInt(controls.external_seed_limit, DEFAULT_CONTROLS.external_seed_limit, 0, 300);

    const [catalog, external] = await Promise.all([
      supa.rpc("refresh_search_golden_queries_from_catalog", {
        p_limit_per_type: catalogLimit,
        p_popular_limit: popularLimit,
      }),
      supa.rpc("refresh_search_golden_queries_from_external_demand", {
        p_chart_limit: chartLimit,
        p_seed_limit: seedLimit,
      }),
    ]);

    if (catalog.error) throw catalog.error;
    if (external.error) throw external.error;

    const entityMonitoringCoverage = await loadEntityMonitoringCoverage(supa);

    const result = {
      ok: true,
      trigger: "search_golden_refresh",
      catalog: catalog.data,
      external: external.data,
      entity_monitoring_coverage: entityMonitoringCoverage,
      elapsed_ms: Date.now() - startedAt,
      refreshed_at: new Date().toISOString(),
    };

    await supa.from("app_settings").upsert({
      key: "search_golden_refresh_progress",
      value: result,
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });

    return json(result);
  } catch (error) {
    const result = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      elapsed_ms: Date.now() - startedAt,
      failed_at: new Date().toISOString(),
    };
    await supa.from("app_settings").upsert({
      key: "search_golden_refresh_progress",
      value: result,
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });
    return json(result, 500);
  }
});
