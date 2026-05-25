// live-event-notify: forwards in-app user events to Telegram in real time.
// Events: search_submit, swipe_complete, play_start.
// Bot requests are dropped server-side so crawlers don't flood the channel.
//
// Throttling: app_settings.live_event_notify = { enabled: bool, kinds_disabled: string[] }.
// Per-session+kind in-memory soft dedup (60s) to suppress accidental double-fires.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { detectBot } from "../_shared/bot-detect.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const GATEWAY = "https://connector-gateway.lovable.dev/telegram";

// Process-local dedup. Edge function warm instances reuse this Map.
const recent = new Map<string, number>();
function isDuplicate(key: string, windowMs = 60_000): boolean {
  const now = Date.now();
  // Periodic cleanup
  if (recent.size > 500) {
    for (const [k, t] of recent) if (now - t > windowMs) recent.delete(k);
  }
  const t = recent.get(key);
  if (t && now - t < windowMs) return true;
  recent.set(key, now);
  return false;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function clip(s: string, n = 120): string {
  s = String(s ?? "").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

async function sendTelegram(text: string) {
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const tgKey = Deno.env.get("TELEGRAM_API_KEY");
  const chatId = Deno.env.get("TELEGRAM_ALERT_CHAT_ID");
  if (!lovableKey || !tgKey || !chatId) return { ok: false, error: "missing_telegram_env" };
  try {
    const r = await fetch(`${GATEWAY}/sendMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": tgKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        disable_notification: true, // silent — high-frequency stream
      }),
    });
    if (!r.ok) return { ok: false, error: `tg_${r.status}` };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "tg_failed" };
  }
}

function formatMessage(kind: string, p: any): string | null {
  const sess = p.session_id ? ` <code>${escapeHtml(clip(String(p.session_id), 12))}</code>` : "";
  const ref = p.referrer ? ` · ref ${escapeHtml(clip(String(p.referrer), 40))}` : "";
  const utm = p.utm_source ? ` · utm ${escapeHtml(clip(String(p.utm_source), 30))}` : "";

  if (kind === "search_submit") {
    const q = clip(String(p.q || ""), 100);
    if (!q) return null;
    return `🔎 <b>Keresés</b>${sess}\n<code>${escapeHtml(q)}</code>${ref}${utm}`;
  }
  if (kind === "swipe_complete") {
    const archetype = clip(String(p.archetype || p.result_title || ""), 60);
    const url = p.share_url ? `\n${escapeHtml(String(p.share_url))}` : "";
    return `🎴 <b>Swipe befejezve</b>${sess}${archetype ? `\n${escapeHtml(archetype)}` : ""}${url}${ref}${utm}`;
  }
  if (kind === "play_start") {
    const ep = clip(String(p.episode_title || ""), 80);
    const pod = clip(String(p.podcast_title || ""), 50);
    const url = p.episode_url ? `\n${escapeHtml(String(p.episode_url))}` : "";
    return `▶️ <b>Lejátszás indult</b>${sess}\n${escapeHtml(ep)}${pod ? ` <i>· ${escapeHtml(pod)}</i>` : ""}${url}${ref}${utm}`;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  try {
    // Drop bots
    const bot = detectBot(req);
    if (bot.isBot) return json({ ok: true, skipped: "bot", reason: bot.reason });

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: cfgRow } = await admin
      .from("app_settings").select("value").eq("key", "live_event_notify").maybeSingle();
    const cfg = (cfgRow?.value || {}) as any;
    if (cfg.enabled === false) return json({ ok: true, skipped: "disabled" });

    const body = await req.json().catch(() => ({}));
    const kind = String(body.kind || "").trim();
    const payload = body.payload || {};

    if (!kind) return json({ error: "missing_kind" }, 400);
    if (Array.isArray(cfg.kinds_disabled) && cfg.kinds_disabled.includes(kind)) {
      return json({ ok: true, skipped: "kind_disabled" });
    }

    // Dedup key
    const dedupKey = `${kind}:${payload.session_id || ""}:${payload.q || payload.episode_id || payload.share_id || ""}`;
    if (dedupKey.length > 3 && isDuplicate(dedupKey)) {
      return json({ ok: true, skipped: "duplicate" });
    }

    const text = formatMessage(kind, payload);
    if (!text) return json({ ok: true, skipped: "no_text" });

    const tg = await sendTelegram(text);
    return json({ ok: true, telegram: tg });
  } catch (e: any) {
    return json({ error: e?.message || "error" }, 500);
  }
});
