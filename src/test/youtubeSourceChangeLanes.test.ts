import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

Object.defineProperty(globalThis, "Deno", { value: { env: { get: () => "" } }, configurable: true });

const { laneBudgets, recleanAllowances } = await import("../../supabase/functions/_shared/best-text-source-lanes");
const { cleanYoutubeDescription, planYoutubeReclean, planRssRevert, classifyBackups, sha256Hex, YOUTUBE_RECLEAN_METHOD, PROTECTED_REPAIR_BATCHES } = await import("../../supabase/functions/_shared/best-text-source-core");

function fakeAdmin(tables: Record<string, any[]>) {
  return {
    from(t: string) {
      const rows = tables[t] || [];
      const q: any = { select: () => q, in: () => q, is: () => q, eq: () => q, order: () => q, limit: () => q, then: (res: any, rej: any) => Promise.resolve({ data: rows, error: null }).then(res, rej) };
      return q;
    },
  };
}

const YT = `A vendég a magyar gazdaság helyzetéről, az inflációról és a forint árfolyamáról beszélt részletesen, konkrét számokkal.

00:00 Bevezetés
05:12 Infláció és kamatdöntések
21:40 A forint árfolyama és a költségvetés`;
const RSS = "Ebben az adásban a magyar gazdaság helyzetéről beszélgetünk vendégünkkel. Szóba kerül az infláció alakulása és a költségvetési hiány is.";
const AUTO_BATCH = "be8cf41d-dfb3-48a6-a523-11550fbf0e8d";

describe("runner lane budgets (≤60 per call, fast lane first)", () => {
  it("defaults to 20 fast + 20 archive backfill + a feed minimum within the 60 cap", () => {
    const b = laneBudgets(40, {});
    expect(b).toMatchObject({ fast: 20, backfill: 20, feedMin: 8 });
    expect(b.fast + b.backfill + b.feedMin).toBeLessThanOrEqual(60);
  });
  it("never lets configured lanes exceed 60 episodes and can switch the fast lane off", () => {
    const b = laneBudgets(500, { fast_lane_per_run: 99, youtube_backfill_per_run: 99 });
    expect(b.limit).toBe(60);
    expect(b.fast + b.backfill + b.feedMin).toBeLessThanOrEqual(60);
    expect(laneBudgets(40, { fast_lane_enabled: false }).fast).toBe(0);
  });
});

describe("re-clean daily cap with a fast-lane reserve", () => {
  const ctrl = { youtube_reclean_daily_cap: 150, youtube_reclean_per_run: 10 };
  it("allows 10 per run for both lanes early in the day", () => {
    expect(recleanAllowances(ctrl, 0)).toMatchObject({ cap: 150, perRun: 10, reserve: 30, fast: 10, archive: 10 });
  });
  it("stops archive work before the reserve so new episodes still get re-cleaned", () => {
    expect(recleanAllowances(ctrl, 125)).toMatchObject({ fast: 10, archive: 0 });
  });
  it("stops everything at the 150/day cap", () => {
    expect(recleanAllowances(ctrl, 150)).toMatchObject({ fast: 0, archive: 0 });
  });
  it("is off when no cap is configured", () => {
    expect(recleanAllowances({}, 0)).toMatchObject({ cap: 0, fast: 0, archive: 0 });
    // catch-up bounds: stored caps above the hard maximum are clamped
    expect(recleanAllowances({ youtube_reclean_daily_cap: 1000, youtube_reclean_per_run: 15 }, 0)).toMatchObject({ cap: 1000, perRun: 15 });
    expect(recleanAllowances({ youtube_reclean_daily_cap: 5000, youtube_reclean_per_run: 99 }, 0)).toMatchObject({ cap: 1000, perRun: 25 });
  });
});

describe("repair-batch protection", () => {
  it("protects the reviewed canaries and non-YouTube repairs, not automatic YouTube batches", () => {
    const c = classifyBackups([
      { episode_id: "a", batch_id: PROTECTED_REPAIR_BATCHES[1], new_cleaner_method: `${YOUTUBE_RECLEAN_METHOD}+rescue_v1` },
      { episode_id: "b", batch_id: PROTECTED_REPAIR_BATCHES[0], new_cleaner_method: "deterministic_v4" },
      { episode_id: "c", batch_id: AUTO_BATCH, new_cleaner_method: YOUTUBE_RECLEAN_METHOD },
    ]);
    expect(c.get("a")?.protected).toBe(true);
    expect(c.get("b")?.protected).toBe(true);
    expect(c.get("c")).toEqual({ protected: false, autoYoutube: true, autoSpotify: false });
  });
});

describe("source change on an earlier automatic YouTube re-clean", () => {
  const cand = { episode_id: "e1", raw_text: YT, source_fingerprint: "fp2", evidence: {} };
  it("refreshes the live text when the verified YouTube description itself changed", async () => {
    const admin = fakeAdmin({
      episode_clean_text: [{ episode_id: "e1", cleaned_text: "Régi YouTube-leírás a gazdaságról, hosszabb érdemi szöveggel, mint ami most maradt.", source_hash: "old-yt", cleaner_method: YOUTUBE_RECLEAN_METHOD }],
      episodes: [{ id: "e1", clean_text_status: "done" }],
      episode_clean_text_repair_backups: [{ episode_id: "e1", batch_id: AUTO_BATCH, new_cleaner_method: YOUTUBE_RECLEAN_METHOD }],
    });
    const [p] = await planYoutubeReclean(admin, [cand]);
    expect(p.outcome).toBe("apply");
    expect(p.reasons).toEqual(["youtube_source_refresh"]);
    expect(p.item.expected_source_hash).toBe("old-yt");
  });
  it("does not touch a text that was edited after the automatic re-clean", async () => {
    const admin = fakeAdmin({
      episode_clean_text: [{ episode_id: "e1", cleaned_text: "Kézzel javított szöveg.", source_hash: "manual", cleaner_method: "manual_edit" }],
      episodes: [{ id: "e1", clean_text_status: "done" }],
      episode_clean_text_repair_backups: [{ episode_id: "e1", batch_id: AUTO_BATCH, new_cleaner_method: YOUTUBE_RECLEAN_METHOD }],
    });
    expect((await planYoutubeReclean(admin, [cand]))[0].reasons).toContain("protected_changed_after_auto_repair");
  });
  it("re-applies an improved cleaner on the same source only when explicitly allowed", async () => {
    const yc = cleanYoutubeDescription(YT);
    if (!yc.ok) throw new Error("fixture must clean");
    const method = yc.method;
    const hash = await sha256Hex(`${method}::${YT}`);
    const admin = fakeAdmin({
      episode_clean_text: [{ episode_id: "e1", cleaned_text: "Elavult tisztítás #hashtag", source_hash: hash, cleaner_method: method }],
      episodes: [{ id: "e1", clean_text_status: "done" }],
      episode_clean_text_repair_backups: [{ episode_id: "e1", batch_id: AUTO_BATCH, new_cleaner_method: method }],
    });
    expect((await planYoutubeReclean(admin, [cand]))[0].outcome).toBe("noop_same");
    const [p] = await planYoutubeReclean(admin, [cand], { allowCleanerUpdate: true });
    expect(p.outcome).toBe("apply");
    expect(p.reasons).toEqual(["youtube_cleaner_update"]);
  });
  it("never refreshes the reviewed 40-episode canary", async () => {
    const admin = fakeAdmin({
      episode_clean_text: [{ episode_id: "e1", cleaned_text: "x", source_hash: "h", cleaner_method: YOUTUBE_RECLEAN_METHOD }],
      episodes: [{ id: "e1", clean_text_status: "done" }],
      episode_clean_text_repair_backups: [{ episode_id: "e1", batch_id: PROTECTED_REPAIR_BATCHES[1], new_cleaner_method: YOUTUBE_RECLEAN_METHOD }],
    });
    expect((await planYoutubeReclean(admin, [cand], { allowCleanerUpdate: true }))[0].reasons).toContain("protected_prior_repair_batch");
  });
});

describe("YouTube source no longer verified → RSS revert", () => {
  const cand = { episode_id: "e1", raw_text: RSS, source_fingerprint: "fp-rss", evidence: {} };
  it("rebuilds YouTube-derived clean text from RSS with the clean-text runner's hash formula", async () => {
    const admin = fakeAdmin({
      episode_clean_text: [{ episode_id: "e1", cleaned_text: "YouTube-ból tisztított régi szöveg.", source_hash: "yt", cleaner_method: YOUTUBE_RECLEAN_METHOD }],
      episodes: [{ id: "e1", clean_text_status: "done", description: RSS, summary: null }],
      episode_clean_text_repair_backups: [{ episode_id: "e1", batch_id: AUTO_BATCH, new_cleaner_method: YOUTUBE_RECLEAN_METHOD }],
    });
    const [p] = await planRssRevert(admin, [cand]);
    expect(p.outcome).toBe("apply");
    expect(p.item.source_type).toBe("rss");
    expect(p.item.cleaner_method.startsWith("deterministic_v4")).toBe(true);
    expect(p.item.source_hash).toBe(await sha256Hex(`${p.item.cleaner_method}::${RSS}`));
    expect(p.item.cleaned_text).toContain("magyar gazdaság");
  });
  it("leaves clean text that never came from YouTube untouched", async () => {
    const admin = fakeAdmin({
      episode_clean_text: [{ episode_id: "e1", cleaned_text: RSS, source_hash: "rss", cleaner_method: "deterministic_v4" }],
      episodes: [{ id: "e1", clean_text_status: "done", description: RSS }],
    });
    expect((await planRssRevert(admin, [cand]))[0].outcome).toBe("skip");
  });
  it("keeps the reviewed canary even if its YouTube link changes", async () => {
    const admin = fakeAdmin({
      episode_clean_text: [{ episode_id: "e1", cleaned_text: "x", source_hash: "yt", cleaner_method: YOUTUBE_RECLEAN_METHOD }],
      episodes: [{ id: "e1", clean_text_status: "done", description: RSS }],
      episode_clean_text_repair_backups: [{ episode_id: "e1", batch_id: PROTECTED_REPAIR_BATCHES[1], new_cleaner_method: YOUTUBE_RECLEAN_METHOD }],
    });
    expect((await planRssRevert(admin, [cand]))[0].reasons).toContain("protected_prior_repair_batch");
  });
});

describe("pairer and runner wiring (no noisy writes, durable fast lane)", () => {
  const pairer = readFileSync("supabase/functions/youtube-episode-pairer/index.ts", "utf8");
  const runner = readFileSync("supabase/functions/episode-best-text-source-runner/index.ts", "utf8");
  const views = readFileSync("supabase/functions/youtube-views-backfill/index.ts", "utf8");
  it("writes YouTube links only through the change-only RPC", () => {
    expect(pairer).toContain('rpc("upsert_episode_youtube_links_v1"');
    expect(pairer).not.toMatch(/from\("episode_youtube_links"\)\s*\.upsert\(/);
    expect(pairer).not.toMatch(/youtube_caption_checked_at: new Date/);
    expect(pairer).not.toMatch(/youtube_paired_at: new Date/);
  });
  it("reuses a prior confirmation or AI rejection instead of paying for the same AI decision", () => {
    expect(pairer).toContain('prior?.status === "confirmed"');
    expect(pairer).toContain("prior?.ai_decision === false");
    expect(pairer).toContain("demote_allowed: !!winner && winner.videoId !== videoId");
  });
  it("claims the fast lane first and acks only after selection and re-clean", () => {
    const claim = runner.indexOf('rpc("claim_episode_source_changes_v1"');
    const backfill = runner.indexOf('rpc("best_source_youtube_gain_targets_v1"');
    const reclean = runner.indexOf("applyYoutubeReclean(admin, real");
    // Deferred (CPU-budget) items are released without an attempt; processed ones are acked.
    const release = runner.indexOf('rpc("release_episode_source_changes_v1", { p_lease_token: lease.token, p_items: deferredItems })');
    const ack = runner.indexOf('rpc("ack_episode_source_changes_v1", { p_lease_token: lease.token, p_items: doneItems, p_error: null })');
    expect(claim).toBeGreaterThan(0);
    expect(claim).toBeLessThan(backfill);
    expect(reclean).toBeLessThan(release);
    expect(release).toBeLessThan(ack);
    expect(runner).toContain("p_error: msg.slice(0, 500)");
  });
  it("keeps view-count refreshes off updated_at", () => {
    expect(views).not.toMatch(/updated_at: new Date/);
    expect(views).toContain("metadata_refreshed_at");
  });
});
