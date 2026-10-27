import { describe, expect, it } from "vitest";
import { parseChannelMeta } from "../../supabase/functions/_shared/podcast-channel-meta";

const feed = (head: string) => `<?xml version="1.0"?><rss><channel>${head}<item><title>Ep</title><link>https://ep.example/1</link><author>Guest Person</author></item></channel></rss>`;

describe("podcast channel publisher fields", () => {
  it("reads the publisher name from the feed header, not from episodes", () => {
    const m = parseChannelMeta(feed(`<title>Bubek | Telex</title><link>https://podcasters.spotify.com/pod/show/x</link><itunes:author>Telex.hu</itunes:author><itunes:owner><itunes:name>Telex.hu</itunes:name><itunes:email>podcast@telex.hu</itunes:email></itunes:owner><copyright><![CDATA[Telex.hu]]></copyright>`));
    expect(m.author).toBe("Telex.hu");
    expect(m.owner_name).toBe("Telex.hu");
    expect(m.copyright).toBe("Telex.hu");
    expect(m.channel_link).toBe("https://podcasters.spotify.com/pod/show/x");
  });
  it("keeps only the domain of an owner or copyright e-mail address", () => {
    const m = parseChannelMeta(feed(`<itunes:author>444</itunes:author><itunes:owner><itunes:email>erdelyip@444.hu</itunes:email></itunes:owner><copyright>2026 erdelyip@444.hu</copyright>`));
    expect(m.owner_email_domain).toBe("444.hu");
    expect(m.copyright).toBe("2026 444.hu");
    expect(JSON.stringify(m)).not.toContain("erdelyip");
  });
  it("returns empty fields for a feed without publisher data", () => {
    const m = parseChannelMeta(feed(`<title>X</title>`));
    expect(m).toEqual({ author: null, owner_name: null, owner_email_domain: null, copyright: null, channel_link: null });
  });
});
