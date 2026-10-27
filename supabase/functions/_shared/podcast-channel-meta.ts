// Publisher-identifying fields from a feed's channel header (pure, no I/O).
// Used to link a podcast to the organization that publishes it (Telex, 444, Partizán…).
// Personal data stays out: an owner e-mail is reduced to its domain, and e-mail
// addresses inside the copyright line are replaced by their domain.

export interface ChannelMeta {
  author: string | null;
  owner_name: string | null;
  owner_email_domain: string | null;
  copyright: string | null;
  channel_link: string | null;
}

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(xml: string, name: string): string {
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = xml.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${n}>`, "i"));
  return m ? decode(m[1]) : "";
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;

export function emailDomain(s: string): string | null {
  const m = String(s || "").match(/@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/);
  return m ? m[1].toLowerCase() : null;
}

function clip(s: string, n = 300): string | null {
  const t = s.trim();
  return t ? t.slice(0, n) : null;
}

export function parseChannelMeta(xml: string): ChannelMeta {
  const head = String(xml || "").split(/<item\b|<entry\b/i)[0] || "";
  const owner = (head.match(/<itunes:owner\b[^>]*>([\s\S]*?)<\/itunes:owner>/i) || [])[1] || "";
  const author = tag(head, "itunes:author") || tag(head, "googleplay:author") || tag(head, "author");
  const ownerName = owner ? tag(owner, "itunes:name") : "";
  const ownerEmail = owner ? tag(owner, "itunes:email") : "";
  const copyright = (tag(head, "copyright") || tag(head, "dc:rights") || tag(head, "rights"))
    .replace(EMAIL_RE, (_, d) => ` ${String(d).toLowerCase()} `).replace(/\s+/g, " ");
  let link = tag(head, "link");
  if (!/^https?:\/\//i.test(link)) {
    const atom = head.match(/<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)
      || head.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']alternate["']/i);
    link = atom ? atom[1] : "";
  }
  return {
    author: clip(author.replace(EMAIL_RE, "").trim()),
    owner_name: clip(ownerName.replace(EMAIL_RE, "").trim()),
    owner_email_domain: emailDomain(ownerEmail),
    copyright: clip(copyright),
    channel_link: /^https?:\/\//i.test(link) ? clip(link, 500) : null,
  };
}
