// Traffic hourly report → Telegram
// Hourly between 06:00-23:00 local (Europe/Budapest = UTC+2 CEST).
// Night summary at 06:00 local covers the previous 8 hours.
// Cron schedules at UTC: 04-21 hourly → 06-23 local. 04 UTC run = night summary.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const GATEWAY = "https://connector-gateway.lovable.dev/telegram";

type Counts = {
  pageviews: number;
  sessions: number;
  signups: number;
  shares: number;
  swipe_completions: number;
  play_starts: number;
  top_paths: { path: string; n: number }[];
  top_referrers: { ref: string; n: number }[];
  top_utm: { src: string; n: number }[];
  device_split: { d: string; n: number }[];
  top_played: { label: string; n: number }[];
};

async function collectCounts(admin: ReturnType<typeof createClient>, sinceISO: string): Promise<Counts> {
  // Page events (non-bot)
  const { data: pe } = await admin
    .from("page_events")
    .select("session_id,path,referrer,utm_source,utm_medium,utm_campaign,ua_os")
    .gte("created_at", sinceISO)
    .or("is_bot.is.null,is_bot.eq.false")
    .limit(50000);

  const events = pe ?? [];
  const sessions = new Set<string>();
  const pathMap = new Map<string, number>();
  const refMap = new Map<string, number>();
  const utmMap = new Map<string, number>();
  const devMap = new Map<string, number>();

  for (const e of events as any[]) {
    if (e.session_id) sessions.add(e.session_id);
    if (e.path) pathMap.set(e.path, (pathMap.get(e.path) ?? 0) + 1);
    if (e.referrer) {
      try {
        const host = new URL(e.referrer).hostname.replace(/^www\./, "");
        if (host) refMap.set(host, (refMap.get(host) ?? 0) + 1);
      } catch { /* ignore */ }
    }
    const src = e.utm_source ? `${e.utm_source}${e.utm_campaign ? "/" + e.utm_campaign : ""}` : null;
    if (src) utmMap.set(src, (utmMap.get(src) ?? 0) + 1);
    const dev = e.ua_os || "?";
    devMap.set(dev, (devMap.get(dev) ?? 0) + 1);
  }

  const top = (m: Map<string, number>, n = 5) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

  // Signups (profiles created in window)
  const { count: signups } = await admin
    .from("profiles").select("*", { count: "exact", head: true })
    .gte("created_at", sinceISO);

  // Shares (te_podiverzumod_shares created in window)
  const { count: shares } = await admin
    .from("te_podiverzumod_shares").select("*", { count: "exact", head: true })
    .gte("created_at", sinceISO);

  // Swipe completions = share rows (each completed swipe creates one share record)
  const swipe_completions = shares ?? 0;

  return {
    pageviews: events.length,
    sessions: sessions.size,
    signups: signups ?? 0,
    shares: shares ?? 0,
    swipe_completions,
    top_paths: top(pathMap).map(([path, n]) => ({ path, n })),
    top_referrers: top(refMap).map(([ref, n]) => ({ ref, n })),
    top_utm: top(utmMap).map(([src, n]) => ({ src, n })),
    device_split: top(devMap, 4).map(([d, n]) => ({ d, n })),
  };
}

function fmt(label: string, since: Date, until: Date, c: Counts): string {
  const fmtTime = (d: Date) =>
    new Intl.DateTimeFormat("hu-HU", {
      timeZone: "Europe/Budapest", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit",
    }).format(d);
  const lines: string[] = [];
  lines.push(`📊 <b>Podiverzum forgalom — ${label}</b>`);
  lines.push(`<i>${fmtTime(since)} → ${fmtTime(until)}</i>`);
  lines.push("");
  lines.push(`👥 Munkamenetek: <b>${c.sessions}</b>`);
  lines.push(`📄 Oldalmegtekintés: <b>${c.pageviews}</b>`);
  lines.push(`🎴 Swipe befejezés: <b>${c.swipe_completions}</b>`);
  lines.push(`📤 Megosztott eredmény: <b>${c.shares}</b>`);
  lines.push(`✨ Regisztráció: <b>${c.signups}</b>`);
  if (c.sessions > 0) {
    const convSwipe = ((c.swipe_completions / c.sessions) * 100).toFixed(1);
    const convReg = ((c.signups / c.sessions) * 100).toFixed(1);
    lines.push(`📈 Konverzió: swipe ${convSwipe}% · reg ${convReg}%`);
  }

  if (c.top_paths.length) {
    lines.push("");
    lines.push(`<b>Top oldalak</b>`);
    for (const p of c.top_paths) lines.push(`• ${p.path} — ${p.n}`);
  }
  if (c.top_referrers.length) {
    lines.push("");
    lines.push(`<b>Top forrás (referrer)</b>`);
    for (const r of c.top_referrers) lines.push(`• ${r.ref} — ${r.n}`);
  }
  if (c.top_utm.length) {
    lines.push("");
    lines.push(`<b>UTM kampány</b>`);
    for (const u of c.top_utm) lines.push(`• ${u.src} — ${u.n}`);
  }
  if (c.device_split.length) {
    lines.push("");
    lines.push(`<b>Eszköz/OS</b>: ${c.device_split.map((d) => `${d.d}:${d.n}`).join(" · ")}`);
  }
  return lines.join("\n");
}

async function sendTelegram(text: string) {
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const tgKey = Deno.env.get("TELEGRAM_API_KEY");
  const chatId = Deno.env.get("TELEGRAM_ALERT_CHAT_ID");
  if (!lovableKey || !tgKey || !chatId) {
    return { ok: false, error: "missing_telegram_env" };
  }
  // Retry on transient gateway errors (502/503/504) — connector gateway occasionally flakes.
  let lastErr = "";
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const r = await fetch(`${GATEWAY}/sendMessage`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableKey}`,
          "X-Connection-Api-Key": tgKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
      });
      if (r.ok) return { ok: true, attempts: attempt };
      const bodyText = (await r.text()).slice(0, 200);
      lastErr = `tg_${r.status}: ${bodyText}`;
      // Retry only on transient upstream errors
      if (r.status !== 502 && r.status !== 503 && r.status !== 504 && r.status !== 429) {
        return { ok: false, error: lastErr };
      }
    } catch (e: any) {
      lastErr = `fetch_failed: ${e?.message || e}`;
    }
    if (attempt < 4) await new Promise((res) => setTimeout(res, 500 * attempt * attempt));
  }
  return { ok: false, error: lastErr, attempts: 4 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const body = await req.json().catch(() => ({} as any));
  const now = new Date();

  // Determine window. Local hour in Europe/Budapest decides night-summary vs hourly.
  const localHour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Budapest", hour: "2-digit", hour12: false }).format(now),
  );

  // Force flags (manual testing)
  const forceNight = body?.mode === "night";
  const forceHour = body?.mode === "hourly";

  let windowHours = 1;
  let label = `utóbbi 1 óra`;
  if (forceNight || (!forceHour && localHour === 6)) {
    windowHours = 8; // 22:00 → 06:00 local
    label = `éjszakai összesítés (22:00 → 06:00)`;
  } else {
    label = `${localHour - 1}:00 → ${localHour}:00 helyi idő`;
  }

  const since = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  const counts = await collectCounts(admin, since.toISOString());

  const text = fmt(label, since, now, counts);
  const tg = await sendTelegram(text);

  return new Response(JSON.stringify({ ok: true, telegram: tg, counts }), {
    headers: { "Content-Type": "application/json" },
  });
});
