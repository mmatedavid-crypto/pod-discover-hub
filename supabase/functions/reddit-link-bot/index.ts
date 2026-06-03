// Reddit link bot — reactive Podiverzum linker.
// Polls r/hungary, r/Magyarorszag, r/podcasts for new comments + submissions,
// finds exact name matches against the Podiverzum catalog (podcasts/people/orgs),
// and posts a single short reply with the relevant /podcast | /szemelyek | /ceg link.
//
// Controls live in app_settings.reddit_link_bot_controls:
//   { enabled, dry_run, daily_cap, comment_cooldown_s, max_thread_age_days,
//     subs[], last_seen{sub:fullname}, access_token, access_token_expires_at }
//
// Secrets required:
//   REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD,
//   REDDIT_USER_AGENT (e.g. "podiverzum-linker/0.1 by u/podiverzum_bot")

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SITE_BASE = "https://podiverzum.hu";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Controls = {
  enabled: boolean;
  dry_run: boolean;
  daily_cap: number;
  comment_cooldown_s: number;
  max_thread_age_days: number;
  subs: string[];
  last_seen: Record<string, string>;
  access_token: string | null;
  access_token_expires_at: string | null;
};

type NameRow = {
  kind: "podcast" | "person" | "organization";
  entity_id: string;
  name: string;
  norm_name: string;
  path: string;
  weight: number;
};

async function loadControls(): Promise<Controls> {
  const { data, error } = await sb.from("app_settings").select("value").eq("key", "reddit_link_bot_controls").maybeSingle();
  if (error) throw error;
  return (data?.value ?? {}) as Controls;
}

async function saveControls(patch: Partial<Controls>) {
  const cur = await loadControls();
  const next = { ...cur, ...patch, updated_at: new Date().toISOString() };
  await sb.from("app_settings").upsert({ key: "reddit_link_bot_controls", value: next });
}

function userAgent(): string {
  return Deno.env.get("REDDIT_USER_AGENT") ?? "podiverzum-linker/0.1 by u/podiverzum_bot";
}

async function getAccessToken(controls: Controls): Promise<string> {
  if (controls.access_token && controls.access_token_expires_at) {
    const exp = new Date(controls.access_token_expires_at).getTime();
    if (exp - Date.now() > 60_000) return controls.access_token;
  }
  const id = Deno.env.get("REDDIT_CLIENT_ID");
  const secret = Deno.env.get("REDDIT_CLIENT_SECRET");
  const username = Deno.env.get("REDDIT_USERNAME");
  const password = Deno.env.get("REDDIT_PASSWORD");
  if (!id || !secret || !username || !password) {
    throw new Error("missing reddit secrets");
  }
  const basic = btoa(`${id}:${secret}`);
  const body = new URLSearchParams({ grant_type: "password", username, password });
  const r = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": userAgent(),
    },
    body,
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`reddit auth ${r.status}: ${text.slice(0, 200)}`);
  }
  const j = await r.json();
  const expires = new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString();
  await saveControls({ access_token: j.access_token, access_token_expires_at: expires });
  return j.access_token;
}

async function redditGet(path: string, token: string, params: Record<string, string> = {}) {
  const url = new URL(`https://oauth.reddit.com${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": userAgent() },
  });
  if (!r.ok) throw new Error(`reddit GET ${path} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return await r.json();
}

async function redditPostComment(parentFullname: string, text: string, token: string) {
  const body = new URLSearchParams({ thing_id: parentFullname, text, api_type: "json" });
  const r = await fetch("https://oauth.reddit.com/api/comment", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": userAgent(),
    },
    body,
  });
  const j = await r.json();
  if (!r.ok || j?.json?.errors?.length) {
    throw new Error(`reddit post failed ${r.status}: ${JSON.stringify(j?.json?.errors ?? j).slice(0, 300)}`);
  }
  const things = j?.json?.data?.things ?? [];
  return things[0]?.data?.id ?? null;
}

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Word-boundary aware match over normalized text. Hungarian word chars include
// digits and underscore; we treat anything in /[a-z0-9]/ as a word char.
function findMatches(normText: string, names: NameRow[]): NameRow[] {
  const seen = new Set<string>();
  const out: NameRow[] = [];
  for (const n of names) {
    if (seen.has(n.norm_name)) continue;
    const re = new RegExp(`(^|[^a-z0-9])${escapeRegex(n.norm_name)}([^a-z0-9]|$)`);
    if (re.test(normText)) {
      out.push(n);
      seen.add(n.norm_name);
      if (out.length >= 2) break;
    }
  }
  return out;
}

function commentBody(match: NameRow): string {
  const label = match.kind === "podcast" ? "podcast" : match.kind === "person" ? "szereplő" : "szervezet";
  return [
    `A [${match.name}](${SITE_BASE}${match.path}) ${label} oldalán a Podiverzumon megtalálod a kapcsolódó epizódokat.`,
    "",
    `^(automatikus link, opt-out: válaszolj „!podiverzum stop")`,
  ].join("\n");
}

async function logRow(row: Partial<{
  subreddit: string; thing_id: string; thing_kind: string; thing_author: string;
  thing_url: string; matched_kind: string; matched_name: string; matched_url: string;
  action: string; reason: string; response_id: string; raw: unknown;
}>) {
  try {
    await sb.from("reddit_bot_log").insert(row as Record<string, unknown>);
  } catch (e) {
    console.error("log insert failed", e);
  }
}

async function dailyCountSentToday(): Promise<number> {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await sb
    .from("reddit_bot_log")
    .select("*", { count: "exact", head: true })
    .eq("action", "posted")
    .gte("ts", since);
  return count ?? 0;
}

async function lastPostedAt(): Promise<number> {
  const { data } = await sb.from("reddit_bot_log").select("ts").eq("action", "posted").order("ts", { ascending: false }).limit(1).maybeSingle();
  return data?.ts ? new Date(data.ts).getTime() : 0;
}

async function alreadyRepliedTo(thingId: string): Promise<boolean> {
  const { count } = await sb
    .from("reddit_bot_log")
    .select("*", { count: "exact", head: true })
    .eq("thing_id", thingId)
    .in("action", ["posted", "skipped_dry_run"]);
  return (count ?? 0) > 0;
}

async function isOptedOut(username: string): Promise<boolean> {
  const { data } = await sb.from("reddit_bot_opt_out").select("username").eq("username", username).maybeSingle();
  return !!data;
}

async function loadNameIndex(): Promise<NameRow[]> {
  // Order: longer names first to prefer specific matches; weight as tiebreaker.
  const { data, error } = await sb
    .from("reddit_name_index")
    .select("kind, entity_id, name, norm_name, path, weight")
    .limit(20000);
  if (error) throw error;
  const rows = (data ?? []) as NameRow[];
  rows.sort((a, b) => b.norm_name.length - a.norm_name.length || b.weight - a.weight);
  return rows;
}

async function handleOptOutReplies(token: string) {
  // Poll our own inbox for opt-out commands.
  try {
    const inbox = await redditGet("/message/unread", token, { limit: "25" });
    const children = inbox?.data?.children ?? [];
    for (const c of children) {
      const d = c?.data;
      if (!d) continue;
      const body = String(d.body ?? "").toLowerCase();
      if (body.includes("!podiverzum stop") && d.author) {
        await sb.from("reddit_bot_opt_out").upsert({ username: d.author, reason: "user_command" });
        await logRow({ thing_author: d.author, action: "opt_out_added", reason: "!podiverzum stop" });
      }
    }
    if (children.length) {
      // Mark all read
      const ids = children.map((c: { data?: { name?: string } }) => c.data?.name).filter(Boolean).join(",");
      if (ids) {
        await fetch("https://oauth.reddit.com/api/read_message", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": userAgent(),
          },
          body: new URLSearchParams({ id: ids }),
        });
      }
    }
  } catch (e) {
    console.warn("inbox poll failed", (e as Error).message);
  }
}

async function processSub(
  sub: string,
  token: string,
  names: NameRow[],
  controls: Controls,
  budget: { remaining: number; lastPostedMs: number },
): Promise<{ scanned: number; posted: number; matched: number }> {
  const last = controls.last_seen?.[sub];
  const maxAgeMs = controls.max_thread_age_days * 24 * 3600 * 1000;
  let scanned = 0, posted = 0, matched = 0;

  for (const path of [`/r/${sub}/comments`, `/r/${sub}/new`]) {
    const params: Record<string, string> = { limit: "25", sort: "new" };
    if (last) params.before = last;
    let listing;
    try {
      listing = await redditGet(path, token, params);
    } catch (e) {
      await logRow({ subreddit: sub, action: "error", reason: `${path}: ${(e as Error).message}` });
      continue;
    }
    const children = listing?.data?.children ?? [];
    if (children.length) {
      const newest = children[0]?.data?.name;
      if (newest) {
        controls.last_seen[sub] = newest;
      }
    }

    for (const c of children) {
      scanned++;
      const d = c?.data;
      if (!d) continue;
      const isComment = c.kind === "t1";
      const thingId = d.name as string;
      const author = d.author as string;
      const text = isComment ? (d.body as string) : `${d.title ?? ""}\n${d.selftext ?? ""}`;
      const created = (d.created_utc as number) * 1000;
      const permalink = d.permalink ? `https://reddit.com${d.permalink}` : null;
      const ageMs = Date.now() - created;

      if (!author || author === "[deleted]" || /bot$/i.test(author)) continue;
      if (Deno.env.get("REDDIT_USERNAME") && author.toLowerCase() === Deno.env.get("REDDIT_USERNAME")!.toLowerCase()) continue;
      if (ageMs > maxAgeMs) { await logRow({ subreddit: sub, thing_id: thingId, thing_kind: isComment ? "comment" : "submission", thing_author: author, thing_url: permalink ?? undefined, action: "skipped_old" }); continue; }
      if (!text || text.length < 20) continue;

      const normText = ` ${normalize(text)} `;
      const hits = findMatches(normText, names);
      if (hits.length === 0) { continue; } // don't log every no-match, would be noisy
      matched++;
      const match = hits[0];

      if (await alreadyRepliedTo(thingId)) {
        await logRow({ subreddit: sub, thing_id: thingId, thing_kind: isComment ? "comment" : "submission", thing_author: author, action: "skipped_duplicate", matched_kind: match.kind, matched_name: match.name });
        continue;
      }
      if (await isOptedOut(author)) {
        await logRow({ subreddit: sub, thing_id: thingId, thing_kind: isComment ? "comment" : "submission", thing_author: author, action: "skipped_opt_out", matched_kind: match.kind, matched_name: match.name });
        continue;
      }
      if (budget.remaining <= 0) {
        await logRow({ subreddit: sub, thing_id: thingId, thing_kind: isComment ? "comment" : "submission", thing_author: author, action: "skipped_cap", matched_kind: match.kind, matched_name: match.name });
        continue;
      }
      const sinceLast = Date.now() - budget.lastPostedMs;
      if (sinceLast < controls.comment_cooldown_s * 1000) {
        await logRow({ subreddit: sub, thing_id: thingId, thing_kind: isComment ? "comment" : "submission", thing_author: author, action: "skipped_cooldown", reason: `wait ${Math.ceil((controls.comment_cooldown_s * 1000 - sinceLast) / 1000)}s`, matched_kind: match.kind, matched_name: match.name });
        continue;
      }

      const body = commentBody(match);
      const url = `${SITE_BASE}${match.path}`;
      if (controls.dry_run) {
        await logRow({ subreddit: sub, thing_id: thingId, thing_kind: isComment ? "comment" : "submission", thing_author: author, thing_url: permalink ?? undefined, action: "skipped_dry_run", matched_kind: match.kind, matched_name: match.name, matched_url: url });
        continue;
      }

      try {
        const respId = await redditPostComment(thingId, body, token);
        budget.remaining--;
        budget.lastPostedMs = Date.now();
        posted++;
        await logRow({ subreddit: sub, thing_id: thingId, thing_kind: isComment ? "comment" : "submission", thing_author: author, thing_url: permalink ?? undefined, action: "posted", matched_kind: match.kind, matched_name: match.name, matched_url: url, response_id: respId ?? undefined });
        // Hard wait for cooldown — only one post per invocation usually anyway.
        await new Promise((r) => setTimeout(r, Math.min(controls.comment_cooldown_s, 5) * 1000));
      } catch (e) {
        await logRow({ subreddit: sub, thing_id: thingId, thing_kind: isComment ? "comment" : "submission", thing_author: author, action: "error", reason: (e as Error).message.slice(0, 500), matched_kind: match.kind, matched_name: match.name });
      }
    }
  }

  return { scanned, posted, matched };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const controls = await loadControls();
    const force = new URL(req.url).searchParams.get("force") === "true";
    if (!controls.enabled && !force) {
      return json({ ok: true, skipped: "disabled" });
    }

    const sentToday = await dailyCountSentToday();
    const remaining = Math.max(0, (controls.daily_cap ?? 30) - sentToday);
    const budget = { remaining, lastPostedMs: await lastPostedAt() };

    const token = await getAccessToken(controls);
    await handleOptOutReplies(token);
    const names = await loadNameIndex();

    const subs = controls.subs ?? [];
    const results: Record<string, unknown> = {};
    for (const sub of subs) {
      results[sub] = await processSub(sub, token, names, controls, budget);
    }
    // Persist updated last_seen cursors.
    await saveControls({ last_seen: controls.last_seen });

    return json({
      ok: true,
      dry_run: controls.dry_run,
      sent_today: sentToday,
      remaining_budget: budget.remaining,
      name_index_size: names.length,
      results,
    });
  } catch (e) {
    const msg = (e as Error).message;
    console.error("reddit-link-bot fatal", msg);
    await logRow({ action: "error", reason: msg.slice(0, 500) });
    return json({ ok: false, error: msg }, 500);
  }
});
