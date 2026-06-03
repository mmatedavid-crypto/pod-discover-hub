const REPO = process.env.GITHUB_REPOSITORY || "mmatedavid-crypto/pod-discover-hub";
const WORKFLOW_NAME = "Deploy Supabase backend";
const API = `https://api.github.com/repos/${REPO}`;

async function githubJson(url) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "podiverzum-backend-workflow-reporter",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

const runs = await githubJson(`${API}/actions/runs?per_page=20`);
const run = (runs.workflow_runs || []).find((item) => item.name === WORKFLOW_NAME);

if (!run) {
  console.log(JSON.stringify({ ok: false, error: "no_backend_workflow_run_found", repo: REPO }, null, 2));
  process.exit(1);
}

const jobs = await githubJson(`${API}/actions/runs/${run.id}/jobs?per_page=50`);
const jobSummaries = (jobs.jobs || []).map((job) => ({
  id: job.id,
  name: job.name,
  status: job.status,
  conclusion: job.conclusion,
  html_url: job.html_url,
  failed_steps: (job.steps || [])
    .filter((step) => step.conclusion === "failure")
    .map((step) => ({
      number: step.number,
      name: step.name,
      started_at: step.started_at,
      completed_at: step.completed_at,
    })),
}));

const failedJobs = jobSummaries.filter((job) => job.conclusion === "failure" || job.failed_steps.length > 0);
const report = {
  ok: run.conclusion === "success",
  workflow: WORKFLOW_NAME,
  repo: REPO,
  run: {
    id: run.id,
    number: run.run_number,
    status: run.status,
    conclusion: run.conclusion,
    event: run.event,
    head_sha: run.head_sha,
    display_title: run.display_title,
    created_at: run.created_at,
    updated_at: run.updated_at,
    html_url: run.html_url,
  },
  failed_jobs: failedJobs,
  jobs: jobSummaries,
};

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
