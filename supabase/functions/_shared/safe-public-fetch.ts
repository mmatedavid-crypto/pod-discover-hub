// Outbound fetch for visitor-supplied URLs (feed submissions, cover images).
// Only plain http(s) to public internet hosts is allowed: loopback, private,
// link-local, metadata and other reserved addresses are refused, both for the
// hostname itself and for every DNS answer, and redirects are followed manually
// so each hop is checked again.

function ipv4Blocked(ip: string): boolean {
  const p = ip.split(".").map((x) => Number(x));
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function ipv6Blocked(ip: string): boolean {
  const s = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (s === "::" || s === "::1") return true;
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipv4Blocked(mapped[1]);
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(s) || s.startsWith("64:ff9b:") || s.startsWith("2001:db8");
}

function isIpv4(h: string) { return /^\d+\.\d+\.\d+\.\d+$/.test(h); }
function isIpv6(h: string) { return h.includes(":"); }

export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("invalid_url"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("invalid_protocol");
  if (u.username || u.password) throw new Error("invalid_url");
  if (u.port && !["80", "443", "8080", "8443"].includes(u.port)) throw new Error("blocked_port");
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
      host.endsWith(".internal") || host.endsWith(".supabase.internal") || !host.includes(".") && !isIpv6(host)) {
    throw new Error("blocked_host");
  }
  if (isIpv4(host)) { if (ipv4Blocked(host)) throw new Error("blocked_host"); return u; }
  if (isIpv6(host)) { if (ipv6Blocked(host)) throw new Error("blocked_host"); return u; }
  const answers: string[] = [];
  for (const type of ["A", "AAAA"] as const) {
    try {
      // deno-lint-ignore no-explicit-any
      const r = await (Deno as any).resolveDns(host, type);
      if (Array.isArray(r)) answers.push(...r.map(String));
    } catch { /* no record of this type */ }
  }
  for (const ip of answers) {
    if ((isIpv4(ip) && ipv4Blocked(ip)) || (isIpv6(ip) && ipv6Blocked(ip))) throw new Error("blocked_host");
  }
  return u;
}

export async function safePublicFetch(raw: string, init: RequestInit = {}, maxRedirects = 4): Promise<Response> {
  let current = raw;
  for (let i = 0; i <= maxRedirects; i++) {
    const u = await assertPublicHttpUrl(current);
    const res = await fetch(u.toString(), { ...init, redirect: "manual" });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, u).toString();
      try { await res.body?.cancel(); } catch { /* ignore */ }
      continue;
    }
    return res;
  }
  throw new Error("too_many_redirects");
}
