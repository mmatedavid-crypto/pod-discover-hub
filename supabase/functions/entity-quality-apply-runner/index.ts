// Applies no-AI entity quality repairs from v_entity_quality_issues.
// Default is dry-run. The first supported mutation only hides reviewed,
// low-confidence organizations from public index/hub surfaces.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type AdminClient = ReturnType<typeof createClient>;
type Body = {
  action?: string;
  limit?: number | string;
  dry_run?: boolean;
};
type EntityIssueRow = {
  entity_kind: "organization" | "person";
  entity_id: string;
  name: string;
  entity_type: string | null;
  episode_count: number | null;
  mention_count: number | null;
  distinct_podcast_count: number | null;
  issue_codes: string[];
  repair_action: string;
  priority_score: number;
};

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const SUPPORTED_ACTIONS = new Set(["hide_low_confidence_organization"]);

async function isAdmin(admin: AdminClient, authHeader: string | null) {
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (token && token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return true;
  const { data: userResult } = await admin.auth.getUser(token);
  if (!userResult?.user) return false;
  const { data: role } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userResult.user.id)
    .eq("role", "admin")
    .maybeSingle();
  return !!role;
}

async function loadControls(admin: AdminClient) {
  const { data } = await admin.from("app_settings").select("value").eq("key", "entity_quality_controls").maybeSingle();
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

    const guard = await checkBackgroundJobsAllowed(admin, "entity-quality-apply-runner");
    if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });

    const controls = await loadControls(admin);
    if (controls.enabled === false) return json({ ok: true, skipped: true, reason: "disabled" });

    const body = (await req.json().catch(() => ({}))) as Body;
    const action = String(body.action || "hide_low_confidence_organization");
    if (!SUPPORTED_ACTIONS.has(action)) {
      return json({ ok: false, error: `unsupported action: ${action}`, supported_actions: Array.from(SUPPORTED_ACTIONS) }, 400);
    }

    const configuredLimit = Number(controls.batch_limit || DEFAULT_LIMIT);
    const limit = Math.max(1, Math.min(MAX_LIMIT, Number(body.limit || configuredLimit || DEFAULT_LIMIT)));
    const dryRun = body.dry_run !== undefined ? body.dry_run !== false : controls.dry_run !== false;

    const { data: rows, error: queueErr } = await admin
      .from("v_entity_quality_issues")
      .select("entity_kind,entity_id,name,entity_type,episode_count,mention_count,distinct_podcast_count,issue_codes,repair_action,priority_score")
      .eq("repair_action", action)
      .eq("may_require_ai", false)
      .order("priority_score", { ascending: false })
      .limit(limit);
    if (queueErr) throw queueErr;

    const candidates = ((rows || []) as EntityIssueRow[]).filter((r) =>
      r.entity_kind === "organization" &&
      r.repair_action === "hide_low_confidence_organization" &&
      r.entity_id
    );
    const ids = candidates.map((r) => r.entity_id);

    let applied = 0;
    let updateError: string | null = null;

    if (!dryRun && ids.length) {
      const { error } = await admin
        .from("organizations")
        .update({
          is_indexable: false,
          is_browsable_in_hub: false,
          browsable_reason: "hidden_by_no_ai_quality_repair_low_confidence",
          updated_at: new Date().toISOString(),
        })
        .in("id", ids);
      if (error) updateError = error.message;
      else applied = ids.length;
    }

    const result = {
      ok: !updateError,
      dry_run: dryRun,
      action,
      scanned: candidates.length,
      planned: ids.length,
      applied,
      skipped: dryRun ? ids.length : 0,
      runtime_ms: Date.now() - startedAt,
      error: updateError,
      sample: candidates.slice(0, 25).map((r) => ({
        entity_id: r.entity_id,
        name: r.name,
        entity_type: r.entity_type,
        episode_count: r.episode_count,
        mention_count: r.mention_count,
        distinct_podcast_count: r.distinct_podcast_count,
        issue_codes: r.issue_codes,
        priority_score: r.priority_score,
      })),
    };

    const { data: prev } = await admin.from("app_settings").select("value").eq("key", "entity_quality_controls").maybeSingle();
    await admin.from("app_settings").upsert({
      key: "entity_quality_controls",
      value: {
        ...((prev?.value as Record<string, unknown>) || {}),
        last_apply_run: result,
        last_apply_run_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });

    return json(result, updateError ? 500 : 200);
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "error" }, 500);
  }
});
