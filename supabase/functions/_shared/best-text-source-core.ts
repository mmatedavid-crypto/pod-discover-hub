// Shared I/O for best-text-source selection and verified YouTube re-clean.
// Used by episode-best-text-source-runner (cron) and clean-text-repair (admin
// dry run / canary). Deterministic, $0, no AI calls. Writes to clean text only
// through apply_clean_text_repair_v1 (backup + compare-and-swap, ≤100/batch).
import { heuristicClean, validateExtractOnlyTrim } from "./episode-text-cleaner.ts";
import {
  CLEAN_TEXT_QUALITY_VERSION,
  RESCUE_METHOD_SUFFIX,
  decideCleanText,
  htmlToPlain,
  validateCleanOutput,
} from "./clean-text-validation.ts";
import {
  BEST_SOURCE_POLICY_VERSION,
  needsReclean,
  pickBest,
  sourceFingerprint,
  transcriptRank,
  type EpisodeRow,
} from "./best-text-source-policy.ts";
import { informativeUnits, recurringFor, recurringUnitCounts, stripRecurringLines, stripSponsorSections, trimDanglingLabels, youtubeRecleanGate } from "./youtube-source-gain.ts";
import { conservativeRescueClean } from "./clean-text-validation.ts";
import { spotifyRecurringCounts, stripSpotifyBoilerplate } from "./spotify-source-gain.ts";

export const CHUNK = 50;
const PREVIEW_INPUT_MAX = 12_000;
export const YOUTUBE_RECLEAN_METHOD = "deterministic_v4+youtube";
export const SPOTIFY_RECLEAN_METHOD = "deterministic_v4+spotify";

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Per-podcast recurrence counts over up to 12 recent confirmed YouTube
 * descriptions (idx_eyl_podcast). Sponsor/intro blocks shared by other episodes
 * are not "new information". Podcasts with fewer than 4 descriptions get none.
 */
export async function loadRecurringByPodcast(admin: any, podcastIds: string[]): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  const ids = Array.from(new Set(podcastIds.filter(Boolean))).slice(0, 40);
  const res = await Promise.all(ids.map((pid) => admin.from("episode_youtube_links")
    .select("episode_id,youtube_description")
    .eq("podcast_id", pid)
    .eq("status", "confirmed")
    .order("updated_at", { ascending: false })
    .limit(12)));
  ids.forEach((pid, i) => {
    const r = res[i];
    if (r.error) throw r.error;
    const descs = ((r.data || []) as any[]).map((x) => String(x.youtube_description || "")).filter((d) => d.length > 40);
    if (descs.length >= 4) out.set(pid, recurringUnitCounts(descs));
  });
  return out;
}

/**
 * Per-show recurrence counts over ≤24 Spotify descriptions sampled evenly across
 * the show's history (boilerplate wording changes over the years, so the most
 * recent descriptions alone miss older footers). Two light queries per show.
 */
export async function loadRecurringSpotifyByPodcast(admin: any, podcastIds: string[]): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  const ids = Array.from(new Set(podcastIds.filter(Boolean))).slice(0, 20);
  await Promise.all(ids.map(async (pid) => {
    const { data: rows, error } = await admin.from("episode_spotify_meta")
      .select("id,release_date").eq("podcast_id", pid).order("release_date", { ascending: true, nullsFirst: false }).order("id", { ascending: true }).limit(4000);
    if (error) throw error;
    const all = (rows || []) as any[];
    if (all.length < 4) return;
    const step = Math.max(1, all.length / 24);
    const pick = Array.from(new Set(Array.from({ length: Math.min(24, all.length) }, (_, i) => all[Math.floor(i * step)].id)));
    const { data: descs, error: dErr } = await admin.from("episode_spotify_meta")
      .select("spotify_description,spotify_html_description").in("id", pick);
    if (dErr) throw dErr;
    const texts = ((descs || []) as any[]).map((d) => String(d.spotify_html_description || d.spotify_description || ""));
    const c = spotifyRecurringCounts(texts);
    if (c) out.set(pid, c);
  }));
  return out;
}

/** Load HU episodes and all candidate sources for at most a few hundred ids (chunked `in` lookups). */
export async function loadEpisodeSources(admin: any, targetIds: string[]) {
  const episodes: EpisodeRow[] = [];
  for (let i = 0; i < targetIds.length; i += CHUNK) {
    const { data, error } = await admin
      .from("episodes")
      .select("id,podcast_id,title,description,updated_at,podcasts!inner(language_decision,spotify_match_confidence)")
      .in("id", targetIds.slice(i, i + CHUNK))
      .eq("podcasts.language_decision", "accept_hungarian");
    if (error) throw error;
    if (data) episodes.push(...(data as EpisodeRow[]));
  }
  const epIds = episodes.map((e) => e.id);
  const spotifyByEp = new Map<string, any>();
  const youtubeByEp = new Map<string, any>();
  const articleByEp = new Map<string, any>();
  const transcriptByEp = new Map<string, any>();
  const prevByEp = new Map<string, any>();
  for (let i = 0; i < epIds.length; i += CHUNK) {
    const slice = epIds.slice(i, i + CHUNK);
    const [sp, yt, art, tr, prev] = await Promise.all([
      admin.from("episode_spotify_meta")
        .select("id,episode_id,spotify_description,spotify_html_description,match_confidence,match_method")
        .in("episode_id", slice),
      admin.from("episode_youtube_links")
        .select("id,episode_id,youtube_description,match_score,confidence,status,validation_reason")
        .in("episode_id", slice)
        .eq("status", "confirmed")
        .contains("validation_reason", { policy: "youtube_episode_match_v3" })
        .order("match_score", { ascending: false }),
      admin.from("episode_article_candidates")
        .select("id,episode_id,outlet,article_url,article_title,article_excerpt,article_text,match_score,status,match_reasons,evidence")
        .in("episode_id", slice)
        .eq("status", "confirmed")
        .order("match_score", { ascending: false }),
      admin.from("episode_transcripts")
        // No `segments`: ~62 kB jsonb per row exhausted worker memory at limit=100.
        .select("id,episode_id,model,source,language,transcript,content_hash,status,rights_status,public_display,updated_at")
        .in("episode_id", slice)
        .eq("status", "ok")
        .order("updated_at", { ascending: false, nullsFirst: false }),
      admin.from("episode_best_text_source")
        .select("episode_id,source_type,raw_text,source_fingerprint,reclean_status")
        .in("episode_id", slice),
    ]);
    for (const res of [sp, yt, art, tr, prev]) if (res.error) throw res.error;
    for (const row of sp.data || []) {
      const p = spotifyByEp.get(row.episode_id);
      const len = String(row.spotify_description || row.spotify_html_description || "").length;
      const pLen = String(p?.spotify_description || p?.spotify_html_description || "").length;
      if (!p || len > pLen) spotifyByEp.set(row.episode_id, row);
    }
    for (const row of yt.data || []) {
      const p = youtubeByEp.get(row.episode_id);
      const s = Number(row.match_score || 0), ps = Number(p?.match_score || 0);
      if (!p || s > ps || (s === ps && String(row.youtube_description || "").length > String(p?.youtube_description || "").length)) youtubeByEp.set(row.episode_id, row);
    }
    for (const row of art.data || []) {
      const p = articleByEp.get(row.episode_id);
      const s = Number(row.match_score || 0), ps = Number(p?.match_score || 0);
      const len = String(row.article_text || row.article_excerpt || "").length;
      const pLen = String(p?.article_text || p?.article_excerpt || "").length;
      if (!p || s > ps || (s === ps && len > pLen)) articleByEp.set(row.episode_id, row);
    }
    for (const row of tr.data || []) {
      const p = transcriptByEp.get(row.episode_id);
      const r = transcriptRank(String(row.model || "")), pr = transcriptRank(String(p?.model || ""));
      if (!p || r > pr || (r === pr && String(row.transcript || "").length > String(p?.transcript || "").length)) transcriptByEp.set(row.episode_id, row);
    }
    for (const row of prev.data || []) prevByEp.set(row.episode_id, row);
  }
  const ytPodcasts = episodes.filter((e) => youtubeByEp.has(e.id)).map((e) => e.podcast_id);
  const recurringByPodcast = ytPodcasts.length ? await loadRecurringByPodcast(admin, ytPodcasts) : new Map();
  // Recurring-block detection only where Spotify could add information at all:
  // a gain needs ≥200 novel chars with ≤60 RSS-unique chars, i.e. Spotify ≥ RSS + ~140.
  // Skipping the rest keeps the runner's CPU flat on ordinary feed episodes.
  const spPodcasts = episodes.filter((e) => {
    const sp = spotifyByEp.get(e.id);
    if (!sp) return false;
    const spLen = String(sp.spotify_html_description || sp.spotify_description || "").length;
    return spLen >= String(e.description || "").length + 120;
  }).map((e) => e.podcast_id);
  const spotifyRecurringByPodcast = spPodcasts.length ? await loadRecurringSpotifyByPodcast(admin, spPodcasts) : new Map();
  return { episodes, spotifyByEp, youtubeByEp, articleByEp, transcriptByEp, prevByEp, recurringByPodcast, spotifyRecurringByPodcast };
}

export type SelectionStats = {
  scanned: number;
  unchanged: number;
  rss_noop: number;
  reclean_marked: number;
  source_counts: Record<string, number>;
  youtube_gain: Record<string, number>;
  spotify_gain: Record<string, number>;
};

/** Pick the best source per episode; returns upsert-ready rows for changed selections only. */
export async function computeSelections(admin: any, targetIds: string[], ctrl: any) {
  const src = await loadEpisodeSources(admin, targetIds);
  const now = new Date().toISOString();
  const rows: any[] = [];
  const decisions: any[] = [];
  const stats: SelectionStats = { scanned: src.episodes.length, unchanged: 0, rss_noop: 0, reclean_marked: 0, source_counts: {}, youtube_gain: {}, spotify_gain: {} };
  for (const ep of src.episodes) {
    const ytRow = src.youtubeByEp.get(ep.id) || null;
    const recurring = recurringFor(src.recurringByPodcast.get(ep.podcast_id), ytRow?.youtube_description ?? null);
    const spRow = src.spotifyByEp.get(ep.id) || null;
    const spotifyRecurring = recurringFor(src.spotifyRecurringByPodcast.get(ep.podcast_id), spRow ? String(spRow.spotify_html_description || spRow.spotify_description || "") : null);
    const best = pickBest(ep, spRow, ytRow, src.articleByEp.get(ep.id) || null, src.transcriptByEp.get(ep.id) || null, ctrl, { recurring, spotifyRecurring });
    if (!best) continue;
    const gain = best.evidence?.youtube_gain || null;
    if (gain) stats.youtube_gain[gain.decision] = (stats.youtube_gain[gain.decision] || 0) + 1;
    const spGain = best.evidence?.spotify_gain || null;
    if (spGain) stats.spotify_gain[spGain.decision] = (stats.spotify_gain[spGain.decision] || 0) + 1;
    const prev = src.prevByEp.get(ep.id) || null;
    const fingerprint = await sourceFingerprint(best);
    decisions.push({ episode_id: ep.id, podcast_id: ep.podcast_id, prev_source: prev?.source_type || null, next_source: best.source_type, gain, spotify_gain: spGain, raw_text: best.raw_text, source_fingerprint: fingerprint, evidence: { ...best.evidence, policy_version: BEST_SOURCE_POLICY_VERSION } });
    if (prev?.source_fingerprint === fingerprint) { stats.unchanged++; continue; }
    // RSS remains the default without a row; only record RSS when a row exists, a transcript or a YouTube decision is available.
    if (!prev && best.source_type === "rss" && !best.evidence?.transcript_available && !gain && !spGain) { stats.rss_noop++; continue; }
    // A verified YouTube selection that was never re-clean-evaluated is evaluated once (gate decides).
    const reclean = needsReclean(prev, best) || ((best.source_type === "youtube" || best.source_type === "spotify") && !prev?.reclean_status);
    if (reclean) stats.reclean_marked++;
    // Preview only (4000 chars stored). deterministic_v4 can take >2 s CPU on some
    // 50k+ transcripts, so long texts are previewed from their first 12k chars.
    const previewTruncated = best.raw_text.length > PREVIEW_INPUT_MAX;
    const cleaned = heuristicClean(previewTruncated ? best.raw_text.slice(0, PREVIEW_INPUT_MAX) : best.raw_text).text.trim();
    const row: any = {
      episode_id: ep.id,
      podcast_id: ep.podcast_id,
      source_type: best.source_type,
      source_ref_id: best.source_ref_id,
      source_confidence: Number(best.source_confidence.toFixed(4)),
      source_reason: best.reasons,
      raw_text: best.raw_text,
      cleaned_preview: cleaned.slice(0, 4000),
      raw_len: best.raw_text.length,
      cleaned_len: cleaned.length,
      evidence: { ...best.evidence, policy_version: BEST_SOURCE_POLICY_VERSION, ...(previewTruncated ? { preview_truncated: true } : {}) },
      source_fingerprint: fingerprint,
      reclean_status: reclean ? "pending" : (prev?.reclean_status ?? null),
      selected_at: now,
      updated_at: now,
    };
    if (reclean) row.reclean_marked_at = now;
    rows.push(row);
    stats.source_counts[best.source_type] = (stats.source_counts[best.source_type] || 0) + 1;
  }
  return { rows, decisions, stats };
}

export async function upsertSelections(admin: any, rows: any[]): Promise<number> {
  let upserted = 0;
  // Rows with and without reclean_marked_at must not share one upsert (missing keys become null).
  const groups = [rows.filter((r) => "reclean_marked_at" in r), rows.filter((r) => !("reclean_marked_at" in r))];
  for (const g of groups) {
    for (let i = 0; i < g.length; i += CHUNK) {
      const { error } = await admin.from("episode_best_text_source").upsert(g.slice(i, i + CHUNK), { onConflict: "episode_id" });
      if (error) throw error;
      upserted += Math.min(CHUNK, g.length - i);
    }
  }
  return upserted;
}


const infoLen = (t: string) => informativeUnits(t).units.join(" ").length;

/**
 * Deterministic clean text for a verified YouTube description. deterministic_v4
 * drops timestamp lines; when that loses chapter topics (≥30% of informative
 * text) the extract-only rescue output is used instead. Same method names and
 * source-hash formula in the clean-text runner and the re-clean planner.
 */
export function cleanYoutubeDescription(rawIn: string, v4In?: { text: string; removed: string[] }, recurring?: Set<string> | null, methodBase: string = YOUTUBE_RECLEAN_METHOD) {
  // Sponsor/ad sections and podcast-recurring blocks are removed before cleaning
  // (removal only; still extract-only vs the raw text).
  const plain = htmlToPlain(rawIn);
  const raw = stripRecurringLines(stripSponsorSections(plain), recurring);
  const sponsorStripped = raw !== plain;
  const v4 = sponsorStripped || !v4In ? heuristicClean(raw) : v4In;
  const decision = decideCleanText({ raw, v4, priorCleanedText: null });
  if (decision.action !== "write") return { ok: false as const, decision };
  let text = trimDanglingLabels(decision.text);
  let rescued = decision.rescued;
  let removed = [...decision.removed];
  if (!rescued) {
    const rescue = conservativeRescueClean(raw);
    const rText = trimDanglingLabels(rescue.text);
    const rv = validateCleanOutput(raw, rText);
    const rx = validateExtractOnlyTrim(htmlToPlain(raw), rText, { minOverlap: 0.97, maxAddedTokenRatio: 0.03, minCompressionRatio: 0 });
    if (rv.status === "valid" && rx.ok && infoLen(rText) >= infoLen(text) * 1.3 + 40) {
      text = rText; rescued = true; removed = Array.from(new Set([...rescue.removed, "youtube_chapters_kept"]));
    }
  }
  if (sponsorStripped) removed = Array.from(new Set([...removed, "youtube_sponsor_sections"]));
  const verdict = validateCleanOutput(raw, text);
  const method = rescued ? `${methodBase}+${RESCUE_METHOD_SUFFIX}` : methodBase;
  return { ok: true as const, decision, text, rescued, removed, verdict, method };
}

export type RecleanCandidate = { episode_id: string; podcast_id?: string | null; raw_text: string; source_fingerprint: string | null; evidence?: any };
export type RecleanPlan = {
  episode_id: string;
  outcome: "apply" | "noop_same" | "reject" | "skip";
  reasons: string[];
  source_fingerprint: string | null;
  evidence?: any;
  prior_len: number;
  next_len: number;
  prior_method: string | null;
  preview: string;
  item?: any;
};

/** Deterministic, extract-only YouTube clean text + prior-preserving gate. No writes. */
/**
 * Owner-reviewed repair batches that automatic runs must never overwrite
 * (43-row RSS canary and the 40-row reviewed YouTube canary, 2026-10-21).
 */
export const PROTECTED_REPAIR_BATCHES = [
  "5f25cffd-e041-4f91-a60f-fd8a953a2009",
  "8e365da4-f9db-4bbc-90f7-4fc6506fb358",
];

export type BackupClass = { protected: boolean; autoYoutube: boolean; autoSpotify: boolean };

/**
 * Active (not rolled back) repair backups per episode. An episode is protected
 * when any backup belongs to a reviewed batch or is not a verified-YouTube
 * re-clean; automatic YouTube re-clean batches may be refreshed/reverted when
 * the verified source itself changes (each write adds a new backup).
 */
export function classifyBackups(rows: Array<{ episode_id: string; batch_id?: string | null; new_cleaner_method?: string | null }>, protectedBatches: string[] = PROTECTED_REPAIR_BATCHES) {
  const out = new Map<string, BackupClass>();
  const prot = new Set(protectedBatches);
  for (const r of rows) {
    const id = String(r.episode_id);
    const c = out.get(id) || { protected: false, autoYoutube: false, autoSpotify: false };
    const m = String(r.new_cleaner_method || "");
    const yt = m.startsWith(YOUTUBE_RECLEAN_METHOD);
    const sp = m.startsWith(SPOTIFY_RECLEAN_METHOD);
    if ((!yt && !sp) || (r.batch_id && prot.has(String(r.batch_id)))) c.protected = true;
    else if (yt) c.autoYoutube = true;
    else c.autoSpotify = true;
    out.set(id, c);
  }
  return out;
}

export async function loadRecleanContext(admin: any, ids: string[], withDescription = false) {
  const cleanByEp = new Map<string, any>();
  const epById = new Map<string, any>();
  const backupRows: any[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const [c, e, b] = await Promise.all([
      admin.from("episode_clean_text").select("episode_id,cleaned_text,source_hash,cleaner_method").in("episode_id", slice),
      admin.from("episodes").select(withDescription ? "id,clean_text_status,description,summary" : "id,clean_text_status").in("id", slice),
      admin.from("episode_clean_text_repair_backups").select("episode_id,batch_id,new_cleaner_method").in("episode_id", slice).is("rolled_back_at", null),
    ]);
    for (const res of [c, e, b]) if (res.error) throw res.error;
    for (const r of c.data || []) cleanByEp.set(String(r.episode_id), r);
    for (const r of e.data || []) epById.set(String(r.id), r);
    backupRows.push(...(b.data || []));
  }
  return { cleanByEp, epById, backupRows };
}

export async function planYoutubeReclean(admin: any, candidates: RecleanCandidate[], opts: { protectRepaired?: boolean; gate?: any; protectedBatches?: string[]; allowCleanerUpdate?: boolean } = {}): Promise<RecleanPlan[]> {
  const ids = candidates.map((c) => c.episode_id);
  const ctx = await loadRecleanContext(admin, ids);
  const cleanByEp = ctx.cleanByEp;
  const statusByEp = new Map<string, string>();
  for (const [id, r] of ctx.epById) statusByEp.set(id, String(r.clean_text_status || ""));
  const backups = classifyBackups(ctx.backupRows, opts.protectedBatches);
  const recurringByPodcast = await loadRecurringByPodcast(admin, candidates.map((c) => String(c.podcast_id || "")));
  const plans: RecleanPlan[] = [];
  for (const cand of candidates) {
    const raw = String(cand.raw_text || "").trim();
    const cur = cleanByEp.get(cand.episode_id) || null;
    const base = { episode_id: cand.episode_id, source_fingerprint: cand.source_fingerprint, evidence: cand.evidence, prior_len: String(cur?.cleaned_text || "").length, prior_method: cur?.cleaner_method ?? null };
    const status = statusByEp.get(cand.episode_id) || "";
    const bk = backups.get(cand.episode_id);
    if (opts.protectRepaired !== false && bk?.protected) {
      plans.push({ ...base, outcome: "reject", reasons: ["protected_prior_repair_batch"], next_len: 0, preview: "" });
      continue;
    }
    // Earlier automatic YouTube re-clean: the verified source itself changed, so the
    // live text is refreshed (no extra-gain requirement) unless it was edited since.
    const refresh = !!bk?.autoYoutube;
    if (refresh && !String(cur?.cleaner_method || "").startsWith(YOUTUBE_RECLEAN_METHOD)) {
      plans.push({ ...base, outcome: "reject", reasons: ["protected_changed_after_auto_repair"], next_len: 0, preview: "" });
      continue;
    }
    if (status === "pending" || status === "error") {
      plans.push({ ...base, outcome: "reject", reasons: [`clean_text_status_${status}_runner_owns`], next_len: 0, preview: "" });
      continue;
    }
    const recurring = recurringFor(recurringByPodcast.get(String(cand.podcast_id || "")), raw);
    const yc = cleanYoutubeDescription(raw, undefined, recurring);
    if (!yc.ok) {
      plans.push({ ...base, outcome: "reject", reasons: [`decision_${yc.decision.action}`, ...((yc.decision as any).reasons || [])], next_len: 0, preview: "" });
      continue;
    }
    const { text, verdict, method, removed } = yc;
    const extract = validateExtractOnlyTrim(htmlToPlain(raw), text, { minOverlap: 0.97, maxAddedTokenRatio: 0.03, minCompressionRatio: 0 });
    const source_hash = await sha256Hex(`${method}::${raw}`);
    const cleanerUpdate = refresh && opts.allowCleanerUpdate === true && String(cur?.cleaned_text || "").trim() !== text.trim();
    if (cur?.source_hash === source_hash && !cleanerUpdate) {
      plans.push({ ...base, outcome: "noop_same", reasons: ["already_applied_same_source_hash"], next_len: text.length, preview: text.slice(0, 280) });
      continue;
    }
    const gate = refresh
      ? { ok: true, reasons: /https?:\/\/|www\.[a-z0-9-]+\./i.test(text) ? ["residual_url"] : [], prior_info_len: infoLen(String(cur?.cleaned_text || "")), next_info_len: infoLen(text), prior_units_lost: 0 }
      : youtubeRecleanGate(cur?.cleaned_text, text, { ...(opts.gate || {}), recurring });
    const reasons = [...gate.reasons];
    if (verdict.status !== "valid") reasons.push(`verdict_${verdict.status}`);
    if (!extract.ok) reasons.push(...extract.reasons.map((r: string) => `extract_${r}`));
    if (text.length < 80) reasons.push("too_short");
    if (reasons.length) {
      plans.push({ ...base, outcome: "reject", reasons, next_len: text.length, preview: text.slice(0, 280) });
      continue;
    }
    plans.push({
      ...base,
      outcome: "apply",
      reasons: [refresh ? (cleanerUpdate ? "youtube_cleaner_update" : "youtube_source_refresh") : `info_gain_${gate.next_info_len - gate.prior_info_len}`],
      next_len: text.length,
      preview: text.slice(0, 280),
      item: {
        episode_id: cand.episode_id,
        cleaned_text: text,
        source_hash,
        cleaner_method: method,
        removed_categories: Array.from(new Set([...removed, "source_youtube", "youtube_dangling_labels"])),
        quality_status: verdict.status,
        quality_reasons: [refresh ? (cleanerUpdate ? "youtube_cleaner_update" : "youtube_source_refresh") : "youtube_informative_gain", `prior_method_${cur?.cleaner_method ?? "none"}`],
        quality_version: CLEAN_TEXT_QUALITY_VERSION,
        source_type: "youtube",
        expected_source_hash: cur ? (cur.source_hash ?? null) : null,
        expected_cleaned_sha256: cur ? await sha256Hex(String(cur.cleaned_text || "")) : null,
      },
    });
  }
  return plans;
}

/**
 * Verified Spotify show notes → clean text. Deterministic, extract-only, and only
 * when the prior text's information is kept and ≥100 informative chars are added
 * (same gate as YouTube). Never overwrites: reviewed canaries / manual or other
 * repairs (any non-Spotify backup), YouTube-derived clean text, or episodes the
 * clean-text runner owns (pending/error). No writes here.
 */
export async function planSpotifyReclean(admin: any, candidates: RecleanCandidate[], opts: { gate?: any; protectedBatches?: string[] } = {}): Promise<RecleanPlan[]> {
  const ctx = await loadRecleanContext(admin, candidates.map((c) => c.episode_id));
  const backups = classifyBackups(ctx.backupRows, opts.protectedBatches);
  const recurringByPodcast = await loadRecurringSpotifyByPodcast(admin, candidates.map((c) => String(c.podcast_id || "")));
  const plans: RecleanPlan[] = [];
  for (const cand of candidates) {
    const raw = String(cand.raw_text || "").trim();
    const cur = ctx.cleanByEp.get(cand.episode_id) || null;
    const curMethod = String(cur?.cleaner_method || "");
    const base = { episode_id: cand.episode_id, source_fingerprint: cand.source_fingerprint, evidence: cand.evidence, prior_len: String(cur?.cleaned_text || "").length, prior_method: cur?.cleaner_method ?? null };
    const reject = (reasons: string[], next_len = 0, preview = "") => plans.push({ ...base, outcome: "reject", reasons, next_len, preview });
    const bk = backups.get(cand.episode_id);
    if (bk?.protected || bk?.autoYoutube) { reject(["protected_prior_repair_batch"]); continue; }
    if (/youtube|ytdesc/i.test(curMethod)) { reject(["prior_youtube_derived_kept"]); continue; }
    const status = String(ctx.epById.get(cand.episode_id)?.clean_text_status || "");
    if (status === "pending" || status === "error") { reject([`clean_text_status_${status}_runner_owns`]); continue; }
    const recurring = recurringFor(recurringByPodcast.get(String(cand.podcast_id || "")), raw);
    const yc = cleanYoutubeDescription(stripSpotifyBoilerplate(raw), undefined, recurring, SPOTIFY_RECLEAN_METHOD);
    if (!yc.ok) { reject([`decision_${yc.decision.action}`, ...((yc.decision as any).reasons || [])]); continue; }
    const { text, verdict, method, removed } = yc;
    const source_hash = await sha256Hex(`${method}::${raw}`);
    if (cur?.source_hash === source_hash) {
      plans.push({ ...base, outcome: "noop_same", reasons: ["already_applied_same_source_hash"], next_len: text.length, preview: text.slice(0, 280) });
      continue;
    }
    const extract = validateExtractOnlyTrim(htmlToPlain(raw), text, { minOverlap: 0.97, maxAddedTokenRatio: 0.03, minCompressionRatio: 0 });
    const gate = youtubeRecleanGate(cur?.cleaned_text, text, { ...(opts.gate || {}), recurring });
    const reasons = [...gate.reasons];
    if (verdict.status !== "valid") reasons.push(`verdict_${verdict.status}`);
    if (!extract.ok) reasons.push(...extract.reasons.map((r: string) => `extract_${r}`));
    if (text.length < 80) reasons.push("too_short");
    if (reasons.length) { reject(reasons, text.length, text.slice(0, 280)); continue; }
    plans.push({
      ...base,
      outcome: "apply",
      reasons: [`info_gain_${gate.next_info_len - gate.prior_info_len}`],
      next_len: text.length,
      preview: text.slice(0, 280),
      item: {
        episode_id: cand.episode_id,
        cleaned_text: text,
        source_hash,
        cleaner_method: method,
        removed_categories: Array.from(new Set([...removed, "source_spotify", "spotify_boilerplate"])),
        quality_status: verdict.status,
        quality_reasons: ["spotify_informative_gain", `prior_method_${cur?.cleaner_method ?? "none"}`],
        quality_version: CLEAN_TEXT_QUALITY_VERSION,
        source_type: "spotify",
        expected_source_hash: cur ? (cur.source_hash ?? null) : null,
        expected_cleaned_sha256: cur ? await sha256Hex(String(cur.cleaned_text || "")) : null,
      },
    });
  }
  return plans;
}

/**
 * A verified YouTube link stopped being the best source (demoted / no longer v3):
 * live clean text that came from an automatic YouTube re-clean is rebuilt from the
 * RSS description (same method + source-hash formula as the clean-text runner), so
 * unverified text does not linger in search. Backed up + CAS like every re-clean.
 * Episodes whose clean text is not YouTube-derived get outcome "skip" (untouched).
 */
export async function planRssRevert(admin: any, candidates: RecleanCandidate[], opts: { method?: string; protectedBatches?: string[] } = {}): Promise<RecleanPlan[]> {
  const method = String(opts.method || "deterministic_v4");
  const ctx = await loadRecleanContext(admin, candidates.map((c) => c.episode_id), true);
  const backups = classifyBackups(ctx.backupRows, opts.protectedBatches);
  const plans: RecleanPlan[] = [];
  for (const cand of candidates) {
    const cur = ctx.cleanByEp.get(cand.episode_id) || null;
    const ep = ctx.epById.get(cand.episode_id) || null;
    const base = { episode_id: cand.episode_id, source_fingerprint: cand.source_fingerprint, evidence: cand.evidence, prior_len: String(cur?.cleaned_text || "").length, prior_method: cur?.cleaner_method ?? null };
    if (!cur || !String(cur.cleaner_method || "").startsWith(YOUTUBE_RECLEAN_METHOD)) {
      plans.push({ ...base, outcome: "skip", reasons: ["clean_text_not_youtube_derived"], next_len: 0, preview: "" });
      continue;
    }
    const reject = (reasons: string[], next_len = 0, preview = "") => plans.push({ ...base, outcome: "reject", reasons, next_len, preview });
    if (backups.get(cand.episode_id)?.protected) { reject(["protected_prior_repair_batch"]); continue; }
    const status = String(ep?.clean_text_status || "");
    if (!ep || status === "pending" || status === "error") { reject([`clean_text_status_${status || "missing"}_runner_owns`]); continue; }
    const raw = String(ep.description || ep.summary || "").trim();
    if (!raw) { reject(["rss_revert_no_source"]); continue; }
    const decision = decideCleanText({ raw, v4: heuristicClean(raw), priorCleanedText: null });
    if (decision.action !== "write") { reject([`rss_revert_${decision.action}`, ...((decision as any).reasons || [])]); continue; }
    const text = decision.text.trim();
    const appliedMethod = decision.rescued ? `${method}+${RESCUE_METHOD_SUFFIX}` : method;
    if (text.length < 40) { reject(["rss_revert_too_short"], text.length, text); continue; }
    if (/https?:\/\//i.test(text)) { reject(["residual_url"], text.length, text.slice(0, 280)); continue; }
    plans.push({
      ...base,
      outcome: "apply",
      reasons: ["youtube_source_no_longer_verified_revert_to_rss"],
      next_len: text.length,
      preview: text.slice(0, 280),
      item: {
        episode_id: cand.episode_id,
        cleaned_text: text,
        source_hash: await sha256Hex(`${appliedMethod}::${raw}`),
        cleaner_method: appliedMethod,
        removed_categories: Array.from(new Set([...decision.removed, "source_rss_revert_from_youtube"])),
        quality_status: decision.verdict.status,
        quality_reasons: ["youtube_source_no_longer_verified_revert_to_rss", `prior_method_${cur.cleaner_method}`],
        quality_version: CLEAN_TEXT_QUALITY_VERSION,
        source_type: "rss",
        expected_source_hash: cur.source_hash ?? null,
        expected_cleaned_sha256: await sha256Hex(String(cur.cleaned_text || "")),
      },
    });
  }
  return plans;
}

/** Apply planned items as one backed-up CAS batch, then record the outcome on each best-source row. */
export async function applyYoutubeReclean(admin: any, plans: RecleanPlan[], batchId: string, opts: { markRows?: boolean; maxConflictAttempts?: number } = {}) {
  const items = plans.filter((p) => p.outcome === "apply" && p.item).map((p) => p.item).slice(0, 100);
  let result: any = { batch_id: batchId, applied: 0, conflicts: 0, invalid: 0, conflict_episode_ids: [] };
  if (items.length) {
    const { data, error } = await admin.rpc("apply_clean_text_repair_v1", { p_batch_id: batchId, p_items: items });
    if (error) throw error;
    result = data;
  }
  if (opts.markRows === false) return result;
  const conflicts = new Set<string>((result?.conflict_episode_ids || []).map(String));
  const now = new Date().toISOString();
  const maxAttempts = opts.maxConflictAttempts ?? 3;
  for (const p of plans) {
    if (!p.source_fingerprint || p.outcome === "skip") continue;
    const prevRe = p.evidence?.reclean || {};
    let status: string;
    if (p.outcome === "apply") status = conflicts.has(p.episode_id) ? ((Number(prevRe.attempts || 0) + 1) >= maxAttempts ? "conflict" : "pending") : "applied";
    else if (p.outcome === "noop_same") status = "applied";
    else status = "rejected_quality";
    const reclean = {
      at: now,
      outcome: conflicts.has(p.episode_id) ? "conflict" : p.outcome,
      reasons: p.reasons,
      batch_id: p.outcome === "apply" && !conflicts.has(p.episode_id) ? batchId : null,
      attempts: Number(prevRe.attempts || 0) + 1,
      prior_len: p.prior_len,
      next_len: p.next_len,
      prior_method: p.prior_method,
    };
    // Compare-and-swap on the fingerprint: a newer selection is never overwritten.
    await admin.from("episode_best_text_source")
      .update({ reclean_status: status, evidence: { ...(p.evidence || {}), reclean } })
      .eq("episode_id", p.episode_id)
      .eq("source_fingerprint", p.source_fingerprint);
  }
  return result;
}
