// youtube-captions: zero-cost YouTube caption fetching.
//
// Strategy (matches jdepoix/youtube-transcript-api, ported to Deno):
//   1. GET the watch page  -> extract INNERTUBE_API_KEY
//   2. POST /youtubei/v1/player with the ANDROID client context
//      (the WEB client now returns baseUrls carrying "&exp=xpe", which require
//      a PO token; the ANDROID client still returns plain caption baseUrls)
//   3. GET the caption baseUrl with &fmt=json3 and flatten the segments
//
// YouTube rate-limits datacenter IPs aggressively (HTTP 429 on
// /api/timedtext after a few dozen requests), so every request can optionally
// be routed through a rotating residential proxy (Webshare). The edge runtime
// has no proxy support in fetch(), so proxied requests are made over a manual
// HTTP CONNECT tunnel (Deno.connect + Deno.startTls) with a minimal HTTP/1.1
// client. Callers should treat "ip_blocked" as a signal to switch to the proxy.

export type CaptionResult = {
  ok: true;
  text: string;
  segments: { start: number; end: number; text: string }[];
  language: string;
  isGenerated: boolean;
  durationSeconds: number;
  via: "direct" | "proxy";
};

export type CaptionFailure = {
  ok: false;
  /** no_captions | ip_blocked | unplayable | po_token_required | http_<code> | error */
  reason: string;
  terminal: boolean;
  via: "direct" | "proxy";
  detail?: string;
};

export type ProxyConfig = {
  host: string;
  port: number;
  username?: string;
  password?: string;
};

const ANDROID_UA = "com.google.android.youtube/20.10.38 (Linux; U; Android 12) gzip";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const COOKIE = "CONSENT=YES+cb; SOCS=CAI";
/** Public web INNERTUBE key, stable for years; refreshed from the watch page on failure. */
const STATIC_INNERTUBE_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";

export function proxyFromEnv(): ProxyConfig | null {
  const host = Deno.env.get("WEBSHARE_PROXY_HOST");
  const port = Number(Deno.env.get("WEBSHARE_PROXY_PORT") || 0);
  if (!host || !port) return null;
  return {
    host,
    port,
    username: Deno.env.get("WEBSHARE_PROXY_USERNAME") || undefined,
    password: Deno.env.get("WEBSHARE_PROXY_PASSWORD") || undefined,
  };
}

// ---------------------------------------------------------------- HTTP client

type SimpleResponse = { status: number; body: string };

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Minimal HTTPS GET/POST through an HTTP CONNECT proxy. */
async function proxyRequest(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
  proxy: ProxyConfig,
  timeoutMs = 25_000,
): Promise<SimpleResponse> {
  const target = new URL(url);
  const port = target.port ? Number(target.port) : 443;
  const conn = await Deno.connect({ hostname: proxy.host, port: proxy.port });
  const timer = setTimeout(() => {
    try {
      conn.close();
    } catch { /* already closed */ }
  }, timeoutMs);
  try {
    const auth = proxy.username
      ? `Proxy-Authorization: Basic ${btoa(`${proxy.username}:${proxy.password ?? ""}`)}\r\n`
      : "";
    const connectReq =
      `CONNECT ${target.hostname}:${port} HTTP/1.1\r\nHost: ${target.hostname}:${port}\r\n${auth}\r\n`;
    await conn.write(new TextEncoder().encode(connectReq));

    // Read the CONNECT response headers off the raw socket.
    const head = new Uint8Array(4096);
    let headText = "";
    while (!headText.includes("\r\n\r\n")) {
      const n = await conn.read(head);
      if (n === null) throw new Error("proxy_closed_during_connect");
      headText += new TextDecoder().decode(head.subarray(0, n));
    }
    const connectStatus = Number(headText.split(" ")[1] || 0);
    if (connectStatus !== 200) throw new Error(`proxy_connect_${connectStatus}`);

    const tls = await Deno.startTls(conn, { hostname: target.hostname });
    const method = init.method || "GET";
    const headers: Record<string, string> = {
      host: target.hostname,
      connection: "close",
      "accept-encoding": "identity",
      ...(init.headers || {}),
    };
    if (init.body !== undefined) headers["content-length"] = String(new TextEncoder().encode(init.body).length);
    const reqLine = `${method} ${target.pathname}${target.search} HTTP/1.1\r\n` +
      Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\r\n") +
      `\r\n\r\n${init.body ?? ""}`;
    await tls.write(new TextEncoder().encode(reqLine));

    const chunks: Uint8Array[] = [];
    const rbuf = new Uint8Array(65536);
    while (true) {
      const n = await tls.read(rbuf);
      if (n === null) break;
      chunks.push(rbuf.slice(0, n));
    }
    const raw = new TextDecoder().decode(concat(chunks));
    const sep = raw.indexOf("\r\n\r\n");
    const rawHead = sep === -1 ? raw : raw.slice(0, sep);
    let body = sep === -1 ? "" : raw.slice(sep + 4);
    const status = Number(rawHead.split(" ")[1] || 0);
    if (/transfer-encoding:\s*chunked/i.test(rawHead)) body = dechunk(body);
    return { status, body };
  } finally {
    clearTimeout(timer);
    try {
      conn.close();
    } catch { /* closed by TLS wrapper */ }
  }
}

function dechunk(body: string): string {
  let out = "";
  let i = 0;
  while (i < body.length) {
    const nl = body.indexOf("\r\n", i);
    if (nl === -1) break;
    const size = parseInt(body.slice(i, nl).trim(), 16);
    if (!Number.isFinite(size) || size === 0) break;
    out += body.slice(nl + 2, nl + 2 + size);
    i = nl + 2 + size + 2;
  }
  return out;
}

async function directRequest(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
  timeoutMs = 20_000,
): Promise<SimpleResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: init.method || "GET",
      headers: init.headers,
      body: init.body,
      signal: controller.signal,
    });
    return { status: r.status, body: await r.text() };
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------ transcript

function pickTrack(tracks: any[], preferredLangs: string[]) {
  for (const lang of preferredLangs) {
    const manual = tracks.find((t) => t.languageCode?.startsWith(lang) && t.kind !== "asr");
    if (manual) return manual;
  }
  for (const lang of preferredLangs) {
    const any = tracks.find((t) => t.languageCode?.startsWith(lang));
    if (any) return any;
  }
  return tracks[0];
}

function parseJson3(body: string) {
  const j = JSON.parse(body);
  const segments = (j.events ?? [])
    .filter((e: any) => Array.isArray(e.segs))
    .map((e: any) => ({
      start: (e.tStartMs || 0) / 1000,
      end: ((e.tStartMs || 0) + (e.dDurationMs || 0)) / 1000,
      text: e.segs.map((s: any) => s.utf8 ?? "").join("").replace(/\s+/g, " ").trim(),
    }))
    .filter((s: any) => s.text);
  const text = segments.map((s: any) => s.text).join(" ").replace(/\s+/g, " ").trim();
  return { segments, text };
}

/**
 * Fetch a single video's captions. Never throws — always resolves to a
 * CaptionResult or CaptionFailure so callers can record the attempt.
 */
export async function fetchYoutubeCaption(
  videoId: string,
  opts: { preferredLangs?: string[]; proxy?: ProxyConfig | null } = {},
): Promise<CaptionResult | CaptionFailure> {
  const preferredLangs = opts.preferredLangs?.length ? opts.preferredLangs : ["hu", "en"];
  const proxy = opts.proxy ?? null;
  const via: "direct" | "proxy" = proxy ? "proxy" : "direct";
  const request = (url: string, init: Parameters<typeof directRequest>[1]) =>
    proxy ? proxyRequest(url, init, proxy) : directRequest(url, init);

  try {
    // The INNERTUBE_API_KEY is a public, static web key. Using it directly skips
    // the ~1MB watch-page download per video, which matters a lot when traffic
    // is metered through a residential proxy. The watch page is only fetched as
    // a fallback when the static key stops working.
    let apiKey = STATIC_INNERTUBE_KEY;
    let usedWatchPage = false;
    const loadKeyFromWatchPage = async () => {
      const watch = await request(`https://www.youtube.com/watch?v=${videoId}`, {
        headers: { "user-agent": BROWSER_UA, "accept-language": "hu-HU,hu;q=0.9,en;q=0.8", cookie: COOKIE },
      });
      if (watch.status === 429 || /class="g-recaptcha"|consent\.youtube\.com\/s/.test(watch.body)) return "ip_blocked";
      if (watch.status !== 200) return `http_${watch.status}`;
      const k = watch.body.match(/"INNERTUBE_API_KEY":\s*"([\w-]+)"/)?.[1];
      if (!k) return "ip_blocked";
      apiKey = k;
      usedWatchPage = true;
      return null;
    };

    const callPlayer = () =>
      request(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": ANDROID_UA,
          "accept-language": "en-US",
        },
        body: JSON.stringify({
          context: { client: { clientName: "ANDROID", clientVersion: "20.10.38" } },
          videoId,
        }),
      });

    let player = await callPlayer();
    if ((player.status === 400 || player.status === 403) && !usedWatchPage) {
      const keyErr = await loadKeyFromWatchPage();
      if (keyErr) return { ok: false, reason: keyErr, terminal: false, via };
      player = await callPlayer();
    }
    if (player.status === 429) return { ok: false, reason: "ip_blocked", terminal: false, via };
    if (player.status !== 200) return { ok: false, reason: `http_${player.status}`, terminal: false, via };
    const data = JSON.parse(player.body);
    const playability = data?.playabilityStatus?.status;
    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    if (!tracks.length) {
      // LOGIN_REQUIRED / "Sign in to confirm you're not a bot" means the IP is
      // flagged, not that the video lacks captions. UNPLAYABLE / private /
      // removed videos are terminal for this pipeline.
      const botWall = playability === "LOGIN_REQUIRED";
      const unplayable = !!playability && playability !== "OK";
      if (botWall) return { ok: false, reason: "ip_blocked", terminal: false, via, detail: playability };
      return {
        ok: false,
        reason: unplayable ? "unplayable" : "no_captions",
        terminal: true,
        via,
        detail: playability,
      };
    }
    const track = pickTrack(tracks, preferredLangs);
    const baseUrl = String(track.baseUrl || "");
    if (!baseUrl) return { ok: false, reason: "no_captions", terminal: true, via };
    if (baseUrl.includes("&exp=xpe")) return { ok: false, reason: "po_token_required", terminal: false, via };

    const tt = await request(`${baseUrl}&fmt=json3`, { headers: { "user-agent": ANDROID_UA } });
    if (tt.status === 429) return { ok: false, reason: "ip_blocked", terminal: false, via };
    if (tt.status !== 200) return { ok: false, reason: `http_${tt.status}`, terminal: false, via };
    const { segments, text } = parseJson3(tt.body);
    if (text.length < 30) return { ok: false, reason: "no_captions", terminal: true, via };
    return {
      ok: true,
      text,
      segments,
      language: String(track.languageCode || "").toLowerCase(),
      isGenerated: track.kind === "asr",
      durationSeconds: Math.round(segments.length ? segments[segments.length - 1].end : 0),
      via,
    };
  } catch (e) {
    const msg = (e as any)?.message || String(e);
    const blocked = /proxy_connect_|proxy_closed|connection reset|timed out|abort/i.test(msg);
    return { ok: false, reason: blocked ? "ip_blocked" : "error", terminal: false, via, detail: msg.slice(0, 200) };
  }
}
