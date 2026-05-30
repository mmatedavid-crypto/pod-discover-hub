// Applies no-AI data repair actions from v_data_repair_queue.
// Default is dry-run. The first supported mutation is intentionally narrow:
// neutralize frozen legacy episode rank fields that should no longer drive UI.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

type AdminClient = ReturnType<typeof createClient>;
type Body = {
  action?: string;
  limit?: number | string;
  dry_run?: boolean;
};
type RepairRow = {
  episode_id: string;
  podcast_id: string;
  podcast_title: string | null;
  podcast_display_title: string | null;
  title: string | null;
  display_title: string | null;
  repair_action: string;
  issue_codes: string[];
  priority_score: number;
};

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const SUPPORTED_ACTIONS = new Set(["neutralize_legacy_episode_rank"]);

async function isAdmin(admin: AdminClient, authHeader: string | null) {
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (token && token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return true;
  const { data: u } = await admin.auth.getUser(token);
  if (!u?.user) return false;
  const { data: r } = await admin.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin").maybeSingle();
  return !!r;
}

async function loadControls(admin: AdminClient) {
  const { data } = await admin.from("app_settings").select("value").eq("key", "data_repair_controls").maybeSingle();
  return {
    enabled: true,
    dry_run: true,
    batch_limit: DEFAULT_LIMIT,
    ...((data?.value as Record<string, unknown>) || {}),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const ok = await isAdmin(admin, req.headers.get("Authorization"));
    if (!ok) return json({ error: "forbidden" }, 403);

    const guard = await checkBackgroundJobsAllowed(admin, "data-repair-apply-runner");
    if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });

    const controls = await loadControls(admin);
    if (controls.enabled === false) return json({ ok: true, skipped: true, reason: "disabled" });

    const body = (await req.json().catch(() => ({}))) as Body;
    const action = String(body.action || "neutralize_legacy_episode_rank");
    if (!SUPPORTED_ACTIONS.has(action)) {
      return json({ ok: false, error: `unsupported action: ${action}`, supported_actions: Array.from(SUPPORTED_ACTIONS) }, 400);
    }

    const configuredLimit = Number(controls.batch_limit || DEFAULT_LIMIT);
    const limit = Math.max(1, Math.min(MAX_LIMIT, Number(body.limit || configuredLimit || DEFAULT_LIMIT)));
    const dryRun = body.dry_run !== undefined ? body.dry_run !== false : controls.dry_run !== false;

    const { data: rows, error: queueErr } = await admin
      .from("v_data_repair_queue")
      .select("episode_id,podcast_id,podcast_title,podcast_display_title,title,display_title,repair_action,issue_codes,priority_score")
      .eq("repair_action", action)
      .eq("may_require_ai", false)
      .order("priority_score", { ascending: false })
      .limit(limit);
    if (queueErr) throw queueErr;

    const candidates = ((rows || []) as RepairRow[]).filter((r) => r.episode_id);
    const episodeIds = candidates.map((r) => r.episode_id);
    let applied = 0;
    let updateError: string | null = null;

    if (!dryRun && episodeIds.length) {
      const { error } = await admin
        .from("episodes")
        .update({
          episode_rank: 1,
          episode_rank_label: null,
          episode_rank_reason: {},
          episode_rank_updated_at: null,
        })
        .in("id", episodeIds);
      if (error) {
        updateError = error.message;
      } else {
        applied = episodeIds.length;
      }
    }

    const result = {
      ok: !updateError,
      dry_run: dryRun,
      action,
      scanned: candidates.length,
      planned: episodeIds.length,
      applied,
      skipped: dryRun ? episodeIds.length : 0,
      runtime_ms: Date.now() - startedAt,
      error: updateError,
      sample: candidates.slice(0, 25).map((r) => ({
        episode_id: r.episode_id,
        podcast: r.podcast_display_title || r.podcast_title,
        title: r.display_title || r.title,
        issue_codes: r.issue_codes,
        priority_score: r.priority_score,
      })),
    };

    const { data: prev } = await admin.from("app_settings").select("value").eq("key", "data_repair_controls").maybeSingle();
    await admin.from("app_settings").upsert({
      key: "data_repair_controls",
      value: {
        ...((prev?.value as Record<string, unknown>) || {}),
        last_apply_run: result,
        last_apply_run_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });

    return json(result, updateError ? 500 : 200);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "error" }, 500);
  }
});
