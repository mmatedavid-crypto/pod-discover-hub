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

type BestTextSourceRow = {
  episode_id: string;
  source_type: string;
  raw_text: string | null;
  source_confidence: number | null;
};

type AdminClient = ReturnType<typeof createClient>;
const ID_CHUNK_SIZE = 40;

async function isAdmin(admin: AdminClient, authHeader: string | null) {
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (token && token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return true;
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
  if (/https?:\/\/|www\.|(?:open\.)?spotify\.com|podcasts\.apple\.com|youtube\.com|youtu\.be|instagram\.com|facebook\.com|tiktok\.com|patreon\.com|linktr\.ee/i.test(text)) signals.push("url");
  if (/@[A-Za-z0-9_.-]+/.test(text)) signals.push("social_handle");
  if (/^\s*(?:instagram|facebook|youtube|tiktok|spotify|patreon|apple podcasts?)\s*[:：-]/im.test(text)) signals.push("platform_link");
  if (/\b(?:foglalj|foglaljon|jelentkezz|jelentkezzen|regisztrálj|regisztráljon|rendeld\s+meg|rendelje\s+meg|vegye\s+kézbe|vedd\s+kézbe|részletek(?:\s+és\s+regisztráció)?|weboldalunkon|webinár|webinar|mentoring\s+nap|konzultáció|bestseller\s+könyv|támogat(?:ni|ás|ó|ók|od|játok|hatod|hatjátok)|adomány|bankszámla(?:szám)?|meghívnál\s+minket\s+egy\s+kávéra|patreon\s+támogatás|telegramon\s+is\s+megtehetitek|learn\s+more\s+about\s+your\s+ad\s+choices|megaphone\.fm\/adchoices|book\s+a\s+call|register(?:\s+(?:now|here|today))?|apply\s+for)\b/i.test(text)) signals.push("promo_cta");
  if (/\b(?:jogi\s+(?:nyilatkozat|figyelmeztetés)|disclaimer|legal\s+(?:notice|disclaimer)?|nem\s+minős(?:ül|íthető)[^.!?\n]{0,120}(?:befektetési|befektetésre|tanácsadás|ösztönzés)|not\s+(?:financial|investment|legal)\s+advice)\b/i.test(text)) signals.push("legal_disclaimer");
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
  if (rawLen > 500 && cleanLen > rawLen * 0.95 && dirtySignals(raw).length > 0 && dirty.length > 0) reasons.push("candidate_undercleaned");
  if (dirty.length > 0) reasons.push(...dirty.map((s) => `candidate_dirty_${s}`));

  const retention = rawLen ? Math.min(1, cleanLen / rawLen) : 0;
  const score = Math.max(0, Math.min(1, retention - reasons.length * 0.15));
  return { status: reasons.length ? "rejected" : "passed", reasons, score };
}

async function filterAcceptedHungarianEpisodeIds(admin: AdminClient, ids: string[]): Promise<string[]> {
  const order = new Map(ids.map((id, index) => [id, index]));
  const accepted = new Set<string>();

  for (let i = 0; i < ids.length; i += ID_CHUNK_SIZE) {
    const slice = ids.slice(i, i + ID_CHUNK_SIZE);
    const { data, error } = await admin
      .from("episodes")
      .select("id,podcasts!inner(is_hungarian,language_decision)")
      .in("id", slice)
      .eq("podcasts.is_hungarian", true)
      .eq("podcasts.language_decision", "accept_hungarian");
    if (error) throw error;
    for (const row of data || []) accepted.add(String(row.id));
  }

  return Array.from(accepted).sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

async function loadDirectDrainEpisodeIds(
  admin: AdminClient,
  method: string,
  limit: number,
  exclude: Set<string>,
): Promise<string[]> {
  const idSet = new Set<string>();
  const add = (id: string) => {
    if (!id || exclude.has(id) || idSet.has(id) || idSet.size >= limit) return;
    idSet.add(id);
  };

  const { data: oldClean, error: oldErr } = await admin
    .from("episode_clean_text")
    .select("episode_id,updated_at,cleaner_method")
    .neq("cleaner_method", method)
    .order("updated_at", { ascending: true, nullsFirst: true })
    .limit(limit * 4);
  if (oldErr) throw oldErr;
  for (const id of await filterAcceptedHungarianEpisodeIds(admin, (oldClean || []).map((row) => String(row.episode_id)))) {
    add(id);
    if (idSet.size >= limit) break;
  }

  if (idSet.size < limit) {
    const { data: missingClean, error: missingErr } = await admin
      .from("episodes")
      .select("id,updated_at,podcasts!inner(is_hungarian,language_decision)")
      .neq("clean_text_status", "done")
      .eq("podcasts.is_hungarian", true)
      .eq("podcasts.language_decision", "accept_hungarian")
      .order("updated_at", { ascending: false, nullsFirst: false })
      .limit((limit - idSet.size) * 4);
    if (missingErr) throw missingErr;
    for (const row of missingClean || []) {
      add(String(row.id));
      if (idSet.size >= limit) break;
    }
  }

  return Array.from(idSet).slice(0, limit);
}

function isDirectDrainRequested(body: Record<string, unknown>, plan: StagedPlan): boolean {
  if (body.direct_drain === true) return true;
  if (body.ignore_staged_plan === true) return true;
  const planCount = Array.isArray(plan.candidates) ? plan.candidates.length : 0;
  return planCount === 0;
}

function candidateKey(row: { episode_id: string; cleaner_method: string; source_hash: string }) {
  return `${row.episode_id}::${row.cleaner_method}::${row.source_hash}`;
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
    const batch = Math.max(1, Math.min(1000, Number(body.batch || 100)));
    const { data: planRow } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "intelligence_reprocess_staged_plan")
      .maybeSingle();
    const plan = (planRow?.value || {}) as StagedPlan;
    const method = String(plan.cleaner_method || "deterministic_v4");
    const directDrain = isDirectDrainRequested(body, plan);
    let ids = directDrain
      ? []
      : (plan.candidates || []).map((c) => c.id).filter((id): id is string => !!id).slice(0, batch);
    ids = directDrain ? ids : await filterAcceptedHungarianEpisodeIds(admin, ids);

    if (ids.length < batch) {
      const direct = await loadDirectDrainEpisodeIds(admin, method, batch - ids.length, new Set(ids));
      ids = Array.from(new Set([...ids, ...direct])).slice(0, batch);
    }

    if (!ids.length) return json({ ok: true, processed: 0, reason: "no_staged_or_drain_candidates" });

    const episodesAll: EpisodeRow[] = [];
    for (let i = 0; i < ids.length; i += ID_CHUNK_SIZE) {
      const slice = ids.slice(i, i + ID_CHUNK_SIZE);
      const { data: epRows, error: epErr } = await admin
        .from("episodes")
        .select("id,description,summary,podcasts!inner(is_hungarian,language_decision)")
        .in("id", slice)
        .eq("podcasts.is_hungarian", true)
        .eq("podcasts.language_decision", "accept_hungarian");
      if (epErr) throw epErr;
      for (const row of (epRows || []) as EpisodeRow[]) episodesAll.push(row);
    }
    const episodes = episodesAll;

    const bestTextByEp = new Map<string, BestTextSourceRow>();
    for (let i = 0; i < ids.length; i += ID_CHUNK_SIZE) {
      const slice = ids.slice(i, i + ID_CHUNK_SIZE);
      const { data: bestRows, error: bestErr } = await admin
        .from("episode_best_text_source")
        .select("episode_id,source_type,raw_text,source_confidence")
        .in("episode_id", slice);
      if (bestErr && !String(bestErr.message || "").includes("episode_best_text_source")) throw bestErr;
      for (const row of (bestRows || []) as BestTextSourceRow[]) bestTextByEp.set(row.episode_id, row);
    }

    const rows = ((episodes || []) as EpisodeRow[]).map(async (ep) => {
      const best = bestTextByEp.get(ep.id);
      const raw = String(best?.raw_text || ep.description || ep.summary || "");
      const { text, removed } = heuristicClean(raw);
      const cleaned = text.trim();
      const sourceHash = await sha256Hex(`${method}::${best?.source_type || "rss"}::${raw}`);
      const quality = qualityGate(raw, cleaned);
      return {
        episode_id: ep.id,
        cleaner_method: method,
        source_hash: sourceHash,
        cleaned_text: cleaned,
        removed_categories: Array.from(new Set([...removed, best?.source_type ? `source_${best.source_type}` : "source_rss"])),
        quality_status: quality.status,
        quality_reasons: quality.reasons,
        quality_score: quality.score,
        updated_at: new Date().toISOString(),
      };
    });

    const candidateRows = await Promise.all(rows);
    const alreadyPromoted = new Set<string>();
    for (let i = 0; i < candidateRows.length; i += ID_CHUNK_SIZE) {
      const slice = candidateRows.slice(i, i + ID_CHUNK_SIZE);
      const { data: existing, error: existingErr } = await admin
        .from("episode_clean_text_candidates")
        .select("episode_id,cleaner_method,source_hash,promoted_at")
        .in("episode_id", slice.map((row) => row.episode_id))
        .eq("cleaner_method", method)
        .not("promoted_at", "is", null);
      if (existingErr) throw existingErr;
      for (const row of existing || []) {
        alreadyPromoted.add(candidateKey(row as { episode_id: string; cleaner_method: string; source_hash: string }));
      }
    }

    const candidateRowsToWrite = candidateRows.filter((row) => !alreadyPromoted.has(candidateKey(row)));
    if (candidateRowsToWrite.length) {
      const { error: upErr } = await admin
        .from("episode_clean_text_candidates")
        .upsert(candidateRowsToWrite, { onConflict: "episode_id,cleaner_method,source_hash" });
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
        direct_drain: directDrain,
        requested_batch: batch,
        processed: candidateRows.length,
        skipped_already_promoted: candidateRows.length - candidateRowsToWrite.length,
        passed,
        rejected,
        sample_rejections: candidateRows
          .filter((r) => r.quality_status === "rejected")
          .slice(0, 10)
          .map((r) => ({ episode_id: r.episode_id, reasons: r.quality_reasons })),
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });

    return json({
      ok: true,
      processed: candidateRows.length,
      written: candidateRowsToWrite.length,
      skipped_already_promoted: candidateRows.length - candidateRowsToWrite.length,
      passed,
      rejected,
      method,
      direct_drain: directDrain,
    });
  } catch (e) {
    const msg = e instanceof Error ? `${e.message}${e.stack ? `\n${e.stack}` : ""}` : (() => { try { return JSON.stringify(e); } catch { return String(e); } })();
    console.error("[clean-text-candidate-runner] fatal:", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
