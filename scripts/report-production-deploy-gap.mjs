import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const GROUPS = {
  clean_text_backfill_gates: {
    label: "Clean text backfill gates",
    migrations: ["supabase/migrations/20260603171000_clean_text_backfill_quality_gate_consolidated.sql"],
    functions: ["episode-clean-text-runner"],
    why: "V3/V4 clean text backfill csak bizonyított minőségjavulás után indulhat, best-text-source alapon.",
  },
  article_pipeline: {
    label: "Publisher article text pipeline",
    migrations: [
      "supabase/migrations/20260603164000_article_pipeline_consolidated.sql",
      "supabase/migrations/20260605210000_reassert_article_pairer_sources_v4.sql",
      "supabase/migrations/20260605211000_episode_article_candidates_readonly_policy.sql",
      "supabase/migrations/20260605225000_reassert_article_pairer_brand_anchor_patterns.sql",
    ],
    functions: ["episode-article-pairer", "episode-best-text-source-runner", "database-quality-fast-lane"],
    why: "Telex/444/Hold/Partizán/HVG/Portfolio cikkekből jobb epizódleírás kerülhet a láncba.",
  },
  seo_news_sitemap: {
    label: "Fast news sitemap + Google submit",
    migrations: [
      "supabase/migrations/20260603111500_news_sitemap_fast_refresh_cron.sql",
      "supabase/migrations/20260603221000_news_sitemap_gsc_connector_gateway.sql",
      "supabase/migrations/20260604094229_reassert_news_sitemap_gsc_connector.sql",
      "supabase/migrations/20260605212000_reassert_news_sitemap_gsc_put_submit.sql",
      "supabase/migrations/20260605214500_clear_news_sitemap_connector_404_state.sql",
    ],
    functions: ["refresh-sitemap"],
    why: "15 percenként friss news sitemap, Google submit csak új news URL esetén.",
  },
  public_ai_language_guard: {
    label: "Hungarian-only public AI text guard",
    migrations: ["supabase/migrations/20260603162000_public_ai_language_guard_consolidated.sql"],
    functions: ["ai-enrich", "seo-enrich-runner"],
    why: "Publikus összefoglaló és SEO szöveg csak magyarul kerülhet ki.",
  },
  related_episode_quality: {
    label: "Related episode quality guard",
    migrations: [
      "supabase/migrations/20260603165000_related_episode_quality_consolidated.sql",
      "supabase/migrations/20260604001000_recommendation_compatibility_v4.sql",
      "supabase/migrations/20260604091642_reassert_recommendation_compatibility_v4.sql",
      "supabase/migrations/20260605003000_recommendation_compatibility_v5_entity_bridge.sql",
      "supabase/migrations/20260605203000_reassert_recommendation_compatibility_v5_content_bridge.sql",
      "supabase/migrations/20260605214000_reassert_related_quality_policy_v5_settings.sql",
      "supabase/migrations/20260605215000_reassert_related_public_affairs_override_terms.sql",
      "supabase/migrations/20260605232000_reassert_similar_episode_diagnostics.sql",
    ],
    functions: [],
    why: "Smart player / hasonló epizód ne ajánljon más szerkesztési világot puszta vektor alapján; explicit téma/személy/cég híd kell.",
  },
  downstream_embedding_quality: {
    label: "Clean-text-first downstream embeddings",
    migrations: [
      "supabase/migrations/20260531200000_pipeline_health_snapshot_v1.sql",
      "supabase/migrations/20260531220000_v4_clean_text_family_downstream_gates.sql",
      "supabase/migrations/20260605231000_reassert_downstream_embedding_clean_text_family.sql",
    ],
    functions: ["embed-episode-runner", "embed-episode-chunks-runner"],
    why: "A kereső, ajánló és B2B monitoring vektorai csak promoválható deterministic_v4-family clean textből épüljenek, ne nyers RSS/YouTube leírásból.",
  },
  smart_player_recommendation_surface: {
    label: "Smart-player recommendation surface lock",
    migrations: ["supabase/migrations/20260605224000_lock_smart_player_recommendation_surface.sql"],
    functions: [],
    why: "A cross-podcast smart-player ajánlások UI-ban le vannak tiltva; az anon/authenticated RPC execute jog is legyen visszavonva, amíg a minőségkapuk nem bizonyítottan zöldek.",
  },
  search_quality_benchmark: {
    label: "Weekly search quality benchmark",
    migrations: ["supabase/migrations/20260605001000_search_quality_weekly_automation.sql"],
    functions: ["search-golden-refresh", "search-benchmark-runner"],
    why: "Golden lista hetente frissül katalógus/demand/toplista jelekből, majd batchelt benchmark méri a kereső minőségét.",
  },
  entity_monitoring_benchmark: {
    label: "Entity monitoring benchmark",
    migrations: [
      "supabase/migrations/20260605220000_entity_monitoring_search_benchmark_policy.sql",
      "supabase/migrations/20260605223000_reassert_entity_monitoring_benchmark_goldens.sql",
    ],
    functions: ["search-golden-refresh", "search-benchmark-runner", "search-hybrid"],
    why: "B2B személy/cég/téma monitoring csak entitás-címkézett golden lekérdezéseken mérve legyen megbízható; elhunyt/történelmi személy ne maradjon podcast-person monitoring target.",
  },
  people_hub_identity_safety: {
    label: "People hub identity safety",
    migrations: [
      "supabase/migrations/20260603170000_people_identity_safety_consolidated.sql",
      "supabase/migrations/20260605200000_reassert_temporal_person_public_guard.sql",
      "supabase/migrations/20260605213000_reassert_strict_temporal_person_guard_v6.sql",
    ],
    functions: ["prerender", "person-entity-extractor"],
    why: "Névazonosságoknál és halott/történelmi személyeknél ne kerüljenek hamis életrajzok vagy nem létező podcast-szereplő profilok SEO/prerender oldalra.",
  },
  edge_worker_seo: {
    label: "Cloudflare edge SEO policy",
    migrations: [],
    functions: [],
    worker: ["infra/cloudflare-worker/worker.js", ".lovable/cloudflare-worker.js"],
    why: "Robots.txt, AI crawler hozzáférés, canonical alias 301-ek és friss news-sitemap cache a Google/AI ügynököknek.",
  },
};

function runPipelineVerifier() {
  try {
    const stdout = execFileSync(process.execPath, ["scripts/verify-production-pipeline.mjs"], {
      cwd: repoRoot,
      env: process.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(stdout);
  } catch (error) {
    const stdout = String(error.stdout || "").trim();
    if (!stdout) {
      console.error(String(error.stderr || error.message || error));
      process.exit(error.status || 1);
    }
    return JSON.parse(stdout);
  }
}

function runEdgeVerifier() {
  try {
    const stdout = execFileSync(process.execPath, ["scripts/verify-production-edge-seo.mjs"], {
      cwd: repoRoot,
      env: process.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(stdout);
  } catch (error) {
    const stdout = String(error.stdout || "").trim();
    if (!stdout) {
      return {
        ok: false,
        failures: [`edge verifier failed without JSON: ${String(error.stderr || error.message || error)}`],
      };
    }
    return JSON.parse(stdout);
  }
}

const result = runPipelineVerifier();
const edgeResult = runEdgeVerifier();
const failures = [
  ...(Array.isArray(result.failures) ? result.failures : []),
  ...(Array.isArray(edgeResult.failures) ? edgeResult.failures.map((failure) => `edge_worker_seo.${failure}`) : []),
];
const failedGroups = new Map();

function groupKeyForFailure(failure) {
  const key = String(failure).split(".")[0];
  if (key === "migration_gates" && String(failure).includes("temporal_person")) {
    return "people_hub_identity_safety";
  }
  if (key === "migration_gates" && String(failure).includes("dead_or_historical_people")) {
    return "people_hub_identity_safety";
  }
  if (key === "migration_gates" && String(failure).includes("suspicious_temporal_participants")) {
    return "people_hub_identity_safety";
  }
  return key;
}

for (const failure of failures) {
  const group = groupKeyForFailure(failure);
  if (!GROUPS[group]) continue;
  if (!failedGroups.has(group)) failedGroups.set(group, []);
  failedGroups.get(group).push(failure);
}

const groups = Array.from(failedGroups.entries()).map(([key, groupFailures]) => ({
  key,
  ...GROUPS[key],
  failures: groupFailures,
}));

const report = {
  ok: failures.length === 0,
  generated_at: new Date().toISOString(),
  failure_count: failures.length,
  deploy_gap_group_count: groups.length,
  groups,
  raw_failures: failures,
  edge: {
    ok: Boolean(edgeResult.ok),
    failure_count: Array.isArray(edgeResult.failures) ? edgeResult.failures.length : 0,
  },
};

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
