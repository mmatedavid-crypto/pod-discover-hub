import { describe, expect, it } from "vitest";
import { withShareUtm } from "@/lib/shareUtm";

describe("share link UTM tagging", () => {
  it("tags a share with the platform as source and share as medium", () => {
    const u = new URL(withShareUtm("https://podiverzum.hu/podcast/a/b", "whatsapp"));
    expect(u.searchParams.get("utm_source")).toBe("whatsapp");
    expect(u.searchParams.get("utm_medium")).toBe("share");
  });

  it("replaces the sharer's own arrival UTM instead of passing it on", () => {
    const u = new URL(
      withShareUtm("https://podiverzum.hu/podcast/a/b?utm_source=chatgpt.com&utm_campaign=x", "facebook"),
    );
    expect(u.searchParams.get("utm_source")).toBe("facebook");
    expect(u.searchParams.get("utm_campaign")).toBeNull();
  });

  it("keeps non-UTM parameters such as the timestamp of a shared moment", () => {
    const u = new URL(withShareUtm("https://podiverzum.hu/podcast/a/b?t=125", "copy"));
    expect(u.searchParams.get("t")).toBe("125");
    expect(u.searchParams.get("utm_source")).toBe("copy");
  });
});
