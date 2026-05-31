// Admin endpoint for safely planning clean-text refreshes.
// Important: this must not delete the currently served clean text. The site
// keeps using the old row until a newer candidate is generated, audited, and
// explicitly promoted.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

type Candidate = {
  id: string;
  podcast_id: string;
  title: string;
  description: string | null;
  ai_summary: string | null;
  clean_text_status: string;
  ai_entities_version: number;
  podcasts?: { title?: string | null; display_title?: string | null; rank_label?: string | null; language_decision?: string | null } | null;
};

type CleanRow = {
  episode_id: string;
  cleaned_text: string;
  cleaner_method: string;
  removed_categories: string[] | null;
};

type RepairQueueRow = {
  episode_id: string;
  podcast_id: string;
  podcast_title: string | null;
  podcast_display_title: string | null;
  rank_label: string | null;
  title: string | null;
  display_title: string | null;
  issue_codes: string[] | null;
  priority_score: number | null;
};

type AdminClient = ReturnType<typeof createClient>;
type ReprocessBody = {
  limit?: number | string;
  tiers?: string[];
  mode?: string;
  dry_run?: boolean;
};

const CURRENT_CLEANER_METHOD = "deterministic_v4";
const DEFAULT_TIERS = ["S", "A", "B", "C", "D", "E"];
const CLEAN_ROW_CHUNK_SIZE = 100;

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try { return JSON.stringify(e); } catch { return "unknown_error"; }
}

async function isAdmin(admin: AdminClient, authHeader: string | null) {
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (token && token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return true;
  const { data: u } = await admin.auth.getUser(token);
  if (!u?.user) return false;
  const { data: r } = await admin.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin").maybeSingle();
  return !!r;
}

function cleanJoin(rows: CleanRow[], ids: string[]) {
  const idSet = new Set(ids);
  return new Map(rows.filter((r) => idSet.has(r.episode_id)).map((r) => [r.episode_id, r]));
}

function reasonsFor(ep: Candidate, clean?: CleanRow, mode = "bad_or_old"): string[] {
  const reasons: string[] = [];
  const rawLen = String(ep.description || "").trim().length;
  const cleanLen = String(clean?.cleaned_text || "").trim().length;
  const removed = clean?.removed_categories || [];

  if (!clean) reasons.push("missing_clean_row");
  if (ep.clean_text_status !== "done") reasons.push("clean_status_not_done");
  if (clean && clean.cleaner_method !== CURRENT_CLEANER_METHOD) reasons.push("old_cleaner_method");
  if (rawLen > 500 && cleanLen < 80) reasons.push("overcleaned");
  if (rawLen > 500 && cleanLen > rawLen * 0.9 && /https?:\/\/|www\.|(?:open\.)?spotify\.com|podcasts\.apple\.com|youtube\.com|youtu\.be|instagram\.com|facebook\.com|tiktok\.com|patreon\.com|linktr\.ee|kövess|iratkozz/i.test(String(ep.description || ""))) {
    reasons.push("likely_undercleaned");
  }
  if (removed.includes("footer_cut") && rawLen > 500 && cleanLen < rawLen * 0.2) reasons.push("suspicious_footer_cut");

  if (mode === "all") return ["forced_all"];
  if (mode === "old") return reasons.filter((r) => r === "old_cleaner_method");
  if (mode === "bad") return reasons.filter((r) => ["overcleaned", "likely_undercleaned", "suspicious_footer_cut", "missing_clean_row"].includes(r));
  return reasons;
}

async function loadCandidates(admin: AdminClient, body: ReprocessBody): Promise<{ candidates: Array<Candidate & { reasons: string[] }>; scanned: number }> {
  const limit = Math.max(1, Math.min(1000, Number(body.limit || 200)));
  const tiers = Array.isArray(body.tiers) && body.tiers.length ? body.tiers.map(String) : DEFAULT_TIERS;
  const mode = String(body.mode || "bad_or_old");

  if (mode === "repair_queue") {
    const { data, error } = await admin
      .from("v_data_repair_queue")
      .select("episode_id,podcast_id,podcast_title,podcast_display_title,rank_label,title,display_title,issue_codes,priority_score")
      .eq("repair_action", "clean_text_candidate")
      .in("rank_label", tiers)
      .order("priority_score", { ascending: false })
      .limit(limit);
    if (error) throw error;
    const rows = ((data || []) as RepairQueueRow[]);
    const candidates = rows.map((row) => ({
      id: row.episode_id,
      podcast_id: row.podcast_id,
      title: row.display_title || row.title || "Untitled episode",
      description: null,
      ai_summary: null,
      clean_text_status: "queued_by_repair_plan",
      ai_entities_version: 0,
      podcasts: {
        title: row.podcast_title,
        display_title: row.podcast_display_title,
        rank_label: row.rank_label,
      },
      reasons: [
        "repair_queue",
        ...((row.issue_codes || []).map((code) => `dq_${code}`)),
      ],
    }));
    return { candidates, scanned: rows.length };
  }

  const scanLimit = Math.min(limit * 2, 1500);
  const { data: eps, error } = await admin
    .from("episodes")
    .select("id,podcast_id,title,description,ai_summary,clean_text_status,ai_entities_version,podcasts!inner(title,display_title,rank_label,is_hungarian,language_decision)")
    .eq("podcasts.is_hungarian", true)
    .eq("podcasts.language_decision", "accept_hungarian")
    .in("podcasts.rank_label", tiers)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(scanLimit);
  if (error) throw error;

  const rows = ((eps || []) as Candidate[]).slice(0, scanLimit);
  const ids = rows.map((r) => r.id);
  const cleanRows: CleanRow[] = [];
  for (let i = 0; i < ids.length; i += CLEAN_ROW_CHUNK_SIZE) {
    const slice = ids.slice(i, i + CLEAN_ROW_CHUNK_SIZE);
    const { data, error: cleanErr } = await admin
      .from("episode_clean_text")
      .select("episode_id,cleaned_text,cleaner_method,removed_categories")
      .in("episode_id", slice);
    if (cleanErr) throw cleanErr;
    cleanRows.push(...((data || []) as CleanRow[]));
  }
  const cleanById = cleanJoin(cleanRows, ids);

  const candidates = rows
    .map((ep) => ({ ...ep, reasons: reasonsFor(ep, cleanById.get(ep.id), mode) }))
    .filter((ep) => ep.reasons.length > 0)
    .slice(0, limit);

  return { candidates, scanned: rows.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "plan";

  try {
    const ok = await isAdmin(admin, req.headers.get("Authorization"));
    if (!ok) return json({ error: "forbidden" }, 403);

    const body = (await req.json().catch(() => ({}))) as ReprocessBody;
    const { candidates, scanned } = await loadCandidates(admin, body);
    const ids = candidates.map((c) => c.id);

    if (action === "plan" || body.dry_run === true) {
      return json({
        ok: true,
        dry_run: true,
        cleaner_method: CURRENT_CLEANER_METHOD,
        scanned,
        candidate_count: candidates.length,
        candidates: candidates.slice(0, 50).map((c) => ({
          id: c.id,
          title: c.title,
          podcast: c.podcasts?.display_title || c.podcasts?.title || null,
          tier: c.podcasts?.rank_label || null,
          reasons: c.reasons,
        })),
      });
    }

    if (action !== "stage") return json({ error: "unknown action" }, 400);
    if (!ids.length) return json({ ok: true, staged: 0 });

    await admin.from("app_settings").upsert({
      key: "intelligence_reprocess_staged_plan",
      value: {
        at: new Date().toISOString(),
        cleaner_method: CURRENT_CLEANER_METHOD,
        staged_count: ids.length,
        mode: body.mode || "bad_or_old",
        tiers: body.tiers || DEFAULT_TIERS,
        candidates: candidates.map((c) => ({
          id: c.id,
          title: c.title,
          podcast_id: c.podcast_id,
          reasons: c.reasons,
        })),
        promotion_policy: "generate_new_clean_text_candidate_first_then_promote_after_quality_gate",
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });

    return json({
      ok: true,
      staged: ids.length,
      next_steps: [
        "Generate replacement clean-text candidates without touching episode_clean_text.",
        "Audit candidate quality against the currently served clean text.",
        "Promote only rows that pass the quality gate.",
        "Invalidate and rebuild SEO, entities, embeddings, and chunks only after promotion.",
      ],
    });
  } catch (e: unknown) {
    return json({ error: errorMessage(e) }, 500);
  }
});
