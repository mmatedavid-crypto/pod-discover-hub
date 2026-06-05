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
    ],
    functions: [],
    why: "Smart player / hasonló epizód ne ajánljon más szerkesztési világot puszta vektor alapján; explicit téma/személy/cég híd kell.",
  },
  search_quality_benchmark: {
    label: "Weekly search quality benchmark",
    migrations: ["supabase/migrations/20260605001000_search_quality_weekly_automation.sql"],
    functions: ["search-golden-refresh", "search-benchmark-runner"],
    why: "Golden lista hetente frissül katalógus/demand/toplista jelekből, majd batchelt benchmark méri a kereső minőségét.",
  },
  people_hub_identity_safety: {
    label: "People hub identity safety",
    migrations: [
      "supabase/migrations/20260603170000_people_identity_safety_consolidated.sql",
      "supabase/migrations/20260605200000_reassert_temporal_person_public_guard.sql",
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

for (const failure of failures) {
  const group = String(failure).split(".")[0];
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
