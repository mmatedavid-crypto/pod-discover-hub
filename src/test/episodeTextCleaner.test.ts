import { describe, expect, it } from "vitest";

Object.defineProperty(globalThis, "Deno", {
  value: { env: { get: () => "" } },
  configurable: true,
});

const { heuristicClean } = await import("../../supabase/functions/_shared/episode-text-cleaner");

describe("episode text cleaner", () => {
  it("cuts inline Hungarian link/supporter footers after the substantive description", () => {
    const raw = [
      "Tartalom: Aktuális adásunkban először vasúton érkezünk az egri MÁV állomásra, hogy felkutassuk Jumurdzsákot a helyi Tourinform segítségével. Majd ismét vonatra szállunk és egy gyilkosság kapcsán nyomozunk.",
      "-- Hasznos linkek: X (ex-Twitter): Zephyr Bluesky: Warhawk Telegram csatornánk Discord szerverünk Támogatóink: Ádám, Bálint, Gergő, Miklós",
    ].join(" ");

    const result = heuristicClean(raw);

    expect(result.text).toContain("Jumurdzsákot");
    expect(result.text).toContain("gyilkosság kapcsán nyomozunk");
    expect(result.text).not.toMatch(/Hasznos linkek|Telegram|Discord|Támogatóink/i);
    expect(result.removed).toContain("inline_footer_cut");
  });

  it("removes lead CTA/link sentences without deleting the actual chapter content", () => {
    const raw = [
      "Kövesd a hivatalos Biblia egy év alatt olvasási tervet: https://zarandok.ma/biblia-egy-ev-alatt",
      "Köszönjük, ha egy kávé árával támogatod munkánkat: https://zarandok.ma/tamogatas/",
      "Fejezetek: 00:00 - Intro 00:37 - Bevezető 02:09 - Első olvasmány - 1 Kir 9 14:08 - Második olvasmány - Préd 6-7 25:47 - Tanítás",
      "Permission to use the official The Bible in a Year reading plan was granted by Ascension.",
    ].join(" ");

    const result = heuristicClean(raw);

    expect(result.text).toContain("Fejezetek");
    expect(result.text).toContain("Tanítás");
    expect(result.text).not.toMatch(/Kövesd|Köszönjük|zarandok\.ma|https?:\/\//i);
  });

  it("strips URLs and dangling resource labels from English descriptions", () => {
    const raw = [
      "Ever wonder why you submit a lot but barely get auditions? This episode shows how small changes to your profile, clips, and notes can bring in more auditions fast.",
      "Email: martin@cityheadshots.com Website: https://www.martinbentsen.com Additional Resources: Headshots: https://www.cityheadshots.com Shoot Footage for Your Reel: https://example.com",
    ].join(" ");

    const result = heuristicClean(raw);

    expect(result.text).toContain("bring in more auditions fast");
    expect(result.text).not.toMatch(/Email|Website|Additional Resources|Headshots|https?:\/\/|martin@/i);
  });
});
