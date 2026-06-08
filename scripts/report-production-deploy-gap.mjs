import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const promptOnly = process.argv.includes("--lovable-prompt") || process.argv.includes("--prompt");

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
      "supabase/migrations/20260606013000_reassert_article_pairer_brand_anchor_patterns_v2.sql",
      "supabase/migrations/20260607093000_best_text_source_transcript_first.sql",
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
      "supabase/migrations/20260606021000_guard_news_sitemap_connector_404_state.sql",
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
      "supabase/migrations/20260606005000_personalized_home_rails_reason_policy.sql",
      "supabase/migrations/20260606011000_personalized_home_main_rail_reason_policy.sql",
      "supabase/migrations/20260606020000_reassert_recommendation_diagnostics_policy_v4.sql",
    ],
    functions: ["personalized-home-rails"],
    why: "Smart player / hasonló epizód ne ajánljon más szerkesztési világot puszta vektor alapján; explicit téma/személy/cég híd kell.",
  },
  taste_card_embedding_privacy: {
    label: "Taste card embedding prompt privacy",
    migrations: ["supabase/migrations/20260607090056_54bd094a-baa5-4ea8-9f43-912e549b12ac.sql"],
    functions: [],
    why: "A taste card embeddinghez használt rejtett prompt soha ne legyen olvasható anon/authenticated szerepkörből.",
  },
  downstream_embedding_quality: {
    label: "Clean-text-first downstream embeddings",
    migrations: [
      "supabase/migrations/20260531200000_pipeline_health_snapshot_v1.sql",
      "supabase/migrations/20260531220000_v4_clean_text_family_downstream_gates.sql",
      "supabase/migrations/20260605231000_reassert_downstream_embedding_clean_text_family.sql",
      "supabase/migrations/20260606014000_reassert_downstream_embedding_clean_text_family_v3.sql",
      "supabase/migrations/20260606174000_timestamp_aware_episode_chunks.sql",
      "supabase/migrations/20260606183000_reassert_timestamp_aware_chunk_search_v2.sql",
      "supabase/migrations/20260607093000_best_text_source_transcript_first.sql",
      "supabase/migrations/20260608002000_reassert_chunk_search_content_snippet.sql",
      "supabase/migrations/20260608005000_reassert_text_processing_transcript_hash_guards.sql",
      "supabase/migrations/20260608006000_reassert_clean_text_backfill_freeze_status.sql",
    ],
    functions: ["episode-best-text-source-runner", "episode-clean-text-runner", "embed-episode-runner", "embed-episode-chunks-runner"],
    why: "A kereső, ajánló és B2B monitoring vektorai csak promoválható deterministic_v4-family clean textből épüljenek, ne nyers RSS/YouTube leírásból.",
  },
  spotify_transcript_pipeline: {
    label: "Spotify native transcript drain",
    migrations: ["supabase/migrations/20260607094500_spotify_transcript_runner_controls.sql"],
    functions: ["spotify-transcript-runner"],
    why: "A meglévő Spotify episode id-kből kézzel kapcsolható, daily cap-es native transcript drain adjon időbélyeges bemenetet a clean-text és chunk search láncnak.",
  },
  smart_player_recommendation_surface: {
    label: "Smart-player recommendation surface enable",
    migrations: [
      "supabase/migrations/20260606182358_4bcdca78-0c45-4572-85bc-cf911726cf14.sql",
      "supabase/migrations/20260606184000_reassert_smart_player_recommendation_surface_enabled_v2.sql",
    ],
    functions: [],
    why: "A cross-podcast smart-player ajánlások már publikusak; az anon/authenticated RPC execute jog és a v2 policy legyen explicit, miközben az accepted-HU és publikus szöveg guardok maradnak.",
  },
  search_quality_benchmark: {
    label: "Weekly search quality benchmark",
    migrations: [
      "supabase/migrations/20260605001000_search_quality_weekly_automation.sql",
      "supabase/migrations/20260608001000_search_timestamp_match_telemetry.sql",
      "supabase/migrations/20260608003000_reassert_search_engine_chunk_aug_policy.sql",
      "supabase/migrations/20260608004000_reassert_search_engine_ranking_version_v5.sql",
    ],
    functions: ["search-golden-refresh", "search-benchmark-runner", "search-hybrid"],
    why: "Golden lista hetente frissül katalógus/demand/toplista jelekből, majd batchelt benchmark és timestampes chunk telemetry méri a kereső minőségét.",
  },
  entity_monitoring_benchmark: {
    label: "Entity monitoring benchmark",
    migrations: [
      "supabase/migrations/20260605220000_entity_monitoring_search_benchmark_policy.sql",
      "supabase/migrations/20260605223000_reassert_entity_monitoring_benchmark_goldens.sql",
      "supabase/migrations/20260606010000_expand_entity_monitoring_goldens_v2.sql",
      "supabase/migrations/20260606012000_reassert_entity_monitoring_goldens_v3.sql",
    ],
    functions: ["search-golden-refresh", "search-benchmark-runner", "search-hybrid"],
    why: "B2B személy/cég/téma monitoring csak entitás-címkézett golden lekérdezéseken mérve legyen megbízható; elhunyt/történelmi személy ne maradjon podcast-person monitoring target.",
  },
  canonical_alias_backfill: {
    label: "Canonical alias backfill and reviewed organization merges",
    migrations: ["supabase/migrations/20260606001000_reassert_safe_organization_merge_rpc.sql"],
    functions: [],
    why: "A canonical alias registry csak akkor javít meglévő szervezeti duplikátumokat, ha a review-zott ütközések biztonságos merge RPC-n mennek át.",
  },
  people_hub_identity_safety: {
    label: "People hub identity safety",
    migrations: [
      "supabase/migrations/20260603170000_people_identity_safety_consolidated.sql",
      "supabase/migrations/20260605200000_reassert_temporal_person_public_guard.sql",
      "supabase/migrations/20260605213000_reassert_strict_temporal_person_guard_v6.sql",
      "supabase/migrations/20260606003000_person_bio_temporal_policy_v2.sql",
      "supabase/migrations/20260606004000_person_bio_input_hash_policy_v3.sql",
      "supabase/migrations/20260606015000_person_bio_topic_only_no_job_policy_v4.sql",
    ],
    functions: ["prerender", "person-entity-extractor", "person-bio-generator"],
    why: "Névazonosságoknál és halott/történelmi személyeknél ne kerüljenek hamis életrajzok vagy nem létező podcast-szereplő profilok SEO/prerender oldalra.",
  },
  edge_worker_seo: {
    label: "Cloudflare edge SEO policy",
    migrations: [],
    functions: ["weekly-editorial-post"],
    worker: ["infra/cloudflare-worker/worker.js", ".lovable/cloudflare-worker.js"],
    why: "Robots.txt, AI crawler hozzáférés, canonical alias 301-ek, IndexNow Heti ping és friss news-sitemap cache a Google/AI ügynököknek.",
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

function runGit(args) {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function getSourceRevision() {
  const commit = runGit(["rev-parse", "HEAD"]);
  const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  const status = runGit(["status", "--porcelain"]);
  return {
    branch,
    commit,
    short_commit: commit ? commit.slice(0, 7) : null,
    dirty: status === null ? null : status.length > 0,
  };
}

const result = runPipelineVerifier();
const edgeResult = runEdgeVerifier();
const failures = [
  ...(Array.isArray(result.failures) ? result.failures : []),
  ...(Array.isArray(edgeResult.failures) ? edgeResult.failures.map((failure) => `edge_worker_seo.${failure}`) : []),
];
const failedGroups = new Map();
const unmappedFailures = [];

function groupKeyForFailure(failure) {
  const key = String(failure).split(".")[0];
  if (key === "migration_gates" && String(failure).includes("canonical_org_merge")) {
    return "canonical_alias_backfill";
  }
  if (key === "migration_gates" && String(failure).includes("temporal_person")) {
    return "people_hub_identity_safety";
  }
  if (key === "migration_gates" && String(failure).includes("dead_or_historical_people")) {
    return "people_hub_identity_safety";
  }
  if (key === "migration_gates" && String(failure).includes("suspicious_temporal_participants")) {
    return "people_hub_identity_safety";
  }
  if (key === "migration_gates" && String(failure).includes("person_bio")) {
    return "people_hub_identity_safety";
  }
  if (key === "migration_gates" && String(failure).includes("embed_chunks")) {
    return "downstream_embedding_quality";
  }
  return key;
}

for (const failure of failures) {
  const group = groupKeyForFailure(failure);
  if (!GROUPS[group]) {
    unmappedFailures.push(failure);
    continue;
  }
  if (!failedGroups.has(group)) failedGroups.set(group, []);
  failedGroups.get(group).push(failure);
}

const groups = Array.from(failedGroups.entries()).map(([key, groupFailures]) => ({
  key,
  ...GROUPS[key],
  failures: groupFailures,
}));

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function makeDeployPlan(groups) {
  const migrations = unique(groups.flatMap((group) => group.migrations || []));
  const functions = unique(groups.flatMap((group) => group.functions || []));
  const workers = unique(groups.flatMap((group) => group.worker || []));
  const localChecks = ["node scripts/run-vitest.mjs", "node scripts/run-vite.mjs build"];
  const preflight = migrations.length
    ? [`node scripts/preflight-migrations.mjs ${migrations.join(" ")}`]
    : [];
  const verification = [
    "node scripts/report-production-deploy-gap.mjs",
    "node scripts/verify-production-pipeline.mjs",
    "node scripts/verify-production-edge-seo.mjs",
  ];
  return { migrations, functions, workers, local_checks: localChecks, preflight, verification };
}

function artifactExists(relPath) {
  return fs.existsSync(path.join(repoRoot, relPath));
}

function normalizeWhitespace(input) {
  return String(input || "").replace(/\s+/g, " ").trim();
}

function parseCreateFunctions(sql) {
  const out = [];
  const rx = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\)\s*(?:RETURNS\s+TABLE\s*\(([\s\S]*?)\)|RETURNS\s+([a-zA-Z0-9_.\s\[\]]+))/gi;
  let match;
  while ((match = rx.exec(sql))) {
    const [, name, rawArgs, tableResult, scalarResult] = match;
    out.push({
      name,
      args: normalizeWhitespace(rawArgs),
      result: tableResult ? `TABLE(${normalizeWhitespace(tableResult)})` : normalizeWhitespace(scalarResult || ""),
    });
  }
  return out;
}

function countPreflightChecksForMigration(relPath) {
  const file = path.join(repoRoot, relPath);
  if (!fs.existsSync(file)) return 0;
  const sql = fs.readFileSync(file, "utf8");
  const returnsTableMatches = parseCreateFunctions(sql).filter((fn) => fn.result.toUpperCase().startsWith("TABLE("));
  const insertColumnMatches = sql.match(/INSERT\s+INTO\s+public\.[a-zA-Z0-9_]+\s*\([\s\S]*?\)\s*(?:VALUES|SELECT|WITH)/gi) || [];
  const customChecks = relPath.endsWith("20260608001000_search_timestamp_match_telemetry.sql") ? 1 : 0;
  return returnsTableMatches.length + insertColumnMatches.length + customChecks;
}

function makePreflightEvidence(plan) {
  const expectedCheckedCount = plan.migrations.reduce(
    (sum, migration) => sum + countPreflightChecksForMigration(migration),
    0,
  );
  return {
    expected_ok: true,
    min_checked_count: expectedCheckedCount,
    expected_findings: [],
  };
}

function checkDeployArtifacts(plan) {
  const migrations = plan.migrations.map((file) => ({ file, exists: artifactExists(file) }));
  const functions = plan.functions.map((name) => {
    const file = `supabase/functions/${name}/index.ts`;
    return { name, file, exists: artifactExists(file) };
  });
  const workers = plan.workers.map((file) => ({ file, exists: artifactExists(file) }));
  const missing = [
    ...migrations.filter((item) => !item.exists).map((item) => item.file),
    ...functions.filter((item) => !item.exists).map((item) => item.file),
    ...workers.filter((item) => !item.exists).map((item) => item.file),
  ];
  return { ok: missing.length === 0, migrations, functions, workers, missing };
}

function makeLovablePrompt(plan, groups, unmappedFailures) {
  if (!groups.length && !unmappedFailures.length) {
    return [
      "Please pull latest main.",
      "",
      "Production backend, pipeline, and edge SEO gates are green. No Supabase migration or function redeploy is required from the deploy-gap report.",
    ].join("\n");
  }

  const lines = [
    "Please pull latest main and close the current Podiverzum production deploy gap.",
    plan.source_revision?.short_commit
      ? `After pulling, confirm the repo is at commit ${plan.source_revision.short_commit} (${plan.source_revision.commit}) before deploy.`
      : "After pulling, confirm the repo is on the latest main commit before deploy.",
    "",
    "Failed deploy areas:",
  ];

  if (groups.length) {
    lines.push(...groups.map((group) => `- ${group.key}: ${group.failures.join(", ")}`));
  } else {
    lines.push("- none mapped to a known deploy area");
  }

  if (unmappedFailures.length) {
    lines.push("", "Unmapped verifier failures; stop and add/repair deploy-gap grouping before deploy:");
    lines.push(...unmappedFailures.map((failure) => `- ${failure}`));
  }

  if (plan.source_revision?.dirty === true) {
    lines.push("", "Local source tree is dirty; commit and push the local changes before asking Lovable to deploy:");
    lines.push("- git status --short");
  }

  if (!plan.artifacts.ok) {
    lines.push("", "Missing deploy artifacts; stop and fix these repo references before deploy:");
    lines.push(...plan.artifacts.missing.map((item) => `- ${item}`));
  }

  lines.push("", "Before deploy, run local verification:");
  lines.push(...plan.local_checks.map((cmd) => `- ${cmd}`));

  if (plan.migrations.length) {
    lines.push("", "Before applying migrations, run preflight:");
    lines.push(...plan.preflight.map((cmd) => `- ${cmd}`));
    lines.push(
      `Preflight must report ok=true, checked_count>=${plan.preflight_evidence.min_checked_count}, findings=[]. Stop if it reports fewer checks or any finding.`,
    );
    lines.push("", "Apply these Supabase migrations in order:");
    lines.push(...plan.migrations.map((migration) => `- ${migration}`));
  }

  if (plan.functions.length) {
    lines.push("", "Redeploy these Supabase Edge Functions:");
    lines.push(...plan.functions.map((fn) => `- ${fn}`));
  }

  if (plan.workers.length) {
    lines.push("", "Sync/deploy these Cloudflare worker files:");
    lines.push(...plan.workers.map((worker) => `- ${worker}`));
    lines.push(
      "",
      "Cloudflare edge SEO acceptance criteria after worker deploy:",
      "- www.podiverzum.hu/* returns 301 to apex with Cache-Control including max-age=31536000",
      "- /robots.txt is served by worker-robots-policy and contains Host: podiverzum.hu",
      "- /llms.txt returns the short Podiverzum.hu AI-agent guidance and includes the Heti RSS, news sitemap and full sitemap URLs",
      "- /cd4aa0ff3daa6bff678ed60d1431affc45fcf9ef72ff14c90613492dc7c32f6a.txt returns only the IndexNow key with worker-indexnow-key",
    );
  }

  lines.push("", "After deploy, run verification:");
  lines.push(...plan.verification.map((cmd) => `- ${cmd}`));

  return lines.join("\n");
}

const deployPlan = makeDeployPlan(groups);
deployPlan.source_revision = getSourceRevision();
deployPlan.artifacts = checkDeployArtifacts(deployPlan);
deployPlan.preflight_evidence = makePreflightEvidence(deployPlan);
const report = {
  ok: failures.length === 0,
  generated_at: new Date().toISOString(),
  failure_count: failures.length,
  deploy_gap_group_count: groups.length,
  groups,
  unmapped_failures: unmappedFailures,
  deploy_plan: deployPlan,
  lovable_prompt: makeLovablePrompt(deployPlan, groups, unmappedFailures),
  raw_failures: failures,
  edge: {
    ok: Boolean(edgeResult.ok),
    failure_count: Array.isArray(edgeResult.failures) ? edgeResult.failures.length : 0,
  },
};

if (promptOnly) {
  console.log(report.lovable_prompt);
  process.exit(0);
}

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
