// Builds replacement clean-text candidates without touching the live
// episode_clean_text row. Promotion is a separate, explicit step after audit.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { heuristicClean } from "../_shared/episode-text-cleaner.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

type StagedPlan = {
  cleaner_method?: string;
  candidates?: Array<{ id?: string; reasons?: string[] }>;
};

type EpisodeRow = {
  id: string;
  description: string | null;
  summary?: string | null;
};

type AdminClient = ReturnType<typeof createClient>;

async function isAdmin(admin: AdminClient, authHeader: string | null) {
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const { data: u } = await admin.auth.getUser(token);
  if (!u?.user) return false;
  const { data: r } = await admin.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin").maybeSingle();
  return !!r;
}

async function sha256Hex(s: string): Promise<string> {
  const enc = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function dirtySignals(text: string): string[] {
  const signals: string[] = [];
  if (/https?:\/\/|www\./i.test(text)) signals.push("url");
  if (/@[A-Za-z0-9_.-]+/.test(text)) signals.push("social_handle");
  if (/\b(instagram|facebook|youtube|tiktok|spotify|patreon)\b/i.test(text)) signals.push("platform_link");
  if (/\b(undefined|null|\[object Object\])\b/i.test(text)) signals.push("placeholder");
  return signals;
}

function qualityGate(raw: string, cleaned: string): { status: "passed" | "rejected"; reasons: string[]; score: number } {
  const reasons: string[] = [];
  const rawLen = raw.trim().length;
  const cleanLen = cleaned.trim().length;
  const dirty = dirtySignals(cleaned);

  if (rawLen >= 80 && cleanLen < 40) reasons.push("candidate_empty_or_too_short");
  if (rawLen > 500 && cleanLen < 80) reasons.push("candidate_overcleaned");
  if (rawLen > 500 && cleanLen > rawLen * 0.95 && dirtySignals(raw).length > 0) reasons.push("candidate_undercleaned");
  if (dirty.length > 0) reasons.push(...dirty.map((s) => `candidate_dirty_${s}`));

  const retention = rawLen ? Math.min(1, cleanLen / rawLen) : 0;
  const score = Math.max(0, Math.min(1, retention - reasons.length * 0.15));
  return { status: reasons.length ? "rejected" : "passed", reasons, score };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const ok = await isAdmin(admin, req.headers.get("Authorization"));
    if (!ok) return json({ error: "forbidden" }, 403);

    const guard = await checkBackgroundJobsAllowed(admin, "episode-clean-text-candidate-runner");
    if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });

    const body = await req.json().catch(() => ({}));
    const batch = Math.max(1, Math.min(500, Number(body.batch || 100)));
    const { data: planRow } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "intelligence_reprocess_staged_plan")
      .maybeSingle();
    const plan = (planRow?.value || {}) as StagedPlan;
    const method = String(plan.cleaner_method || "deterministic_v3");
    const ids = (plan.candidates || []).map((c) => c.id).filter((id): id is string => !!id).slice(0, batch);
    if (!ids.length) return json({ ok: true, processed: 0, reason: "no_staged_candidates" });

    const { data: episodes, error: epErr } = await admin
      .from("episodes")
      .select("id,description,summary")
      .in("id", ids);
    if (epErr) throw epErr;

    const rows = ((episodes || []) as EpisodeRow[]).map(async (ep) => {
      const raw = String(ep.description || ep.summary || "");
      const { text, removed } = heuristicClean(raw);
      const cleaned = text.trim();
      const sourceHash = await sha256Hex(`${method}::${raw}`);
      const quality = qualityGate(raw, cleaned);
      return {
        episode_id: ep.id,
        cleaner_method: method,
        source_hash: sourceHash,
        cleaned_text: cleaned,
        removed_categories: removed,
        quality_status: quality.status,
        quality_reasons: quality.reasons,
        quality_score: quality.score,
        updated_at: new Date().toISOString(),
      };
    });

    const candidateRows = await Promise.all(rows);
    if (candidateRows.length) {
      const { error: upErr } = await admin
        .from("episode_clean_text_candidates")
        .upsert(candidateRows, { onConflict: "episode_id,cleaner_method,source_hash" });
      if (upErr) throw upErr;
    }

    const passed = candidateRows.filter((r) => r.quality_status === "passed").length;
    const rejected = candidateRows.length - passed;
    await admin.from("app_settings").upsert({
      key: "episode_clean_text_candidate_progress",
      value: {
        last_run_at: new Date().toISOString(),
        runtime_ms: Date.now() - startedAt,
        method,
        processed: candidateRows.length,
        passed,
        rejected,
        sample_rejections: candidateRows
          .filter((r) => r.quality_status === "rejected")
          .slice(0, 10)
          .map((r) => ({ episode_id: r.episode_id, reasons: r.quality_reasons })),
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });

    return json({ ok: true, processed: candidateRows.length, passed, rejected, method });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "error" }, 500);
  }
});
