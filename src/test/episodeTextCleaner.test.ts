import { describe, expect, it } from "vitest";

Object.defineProperty(globalThis, "Deno", {
  value: { env: { get: () => "" } },
  configurable: true,
});

const { heuristicClean, assessCleanTextQuality } = await import("../../supabase/functions/_shared/episode-text-cleaner");

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

  it("cuts one-line promo and legal boilerplate tails after the actual episode text", () => {
    const raw = [
      "Ebben az adásban arról beszélgetünk, miért szorongunk a pénztől, hogyan alakulnak ki a családi pénzminták, és milyen lépésekkel lehet tudatosabb döntéseket hozni a mindennapi kiadásokban.",
      "Money Mentoring Nap – Vegye kézbe pénzügyeit szakértőinkkel.",
      "Jelentkezzen 2026. május 29-én, részletek és regisztráció a weboldalunkon.",
      "Foglalj ingyenes konzultációt privát bankárainkkal.",
      "Rendeld meg bestseller könyvünket.",
      "Jogi nyilatkozat A jelen bejegyzésben/műsorban elhangzottak nem minősíthetők befektetésre való ösztönzésnek.",
    ].join(" ");

    const result = heuristicClean(raw);

    expect(result.text).toContain("családi pénzminták");
    expect(result.text).toContain("mindennapi kiadásokban");
    expect(result.text).not.toMatch(/Money Mentoring|Jelentkezzen|Foglalj|Rendeld meg|Jogi nyilatkozat|befektetésre/i);
    expect(result.removed).toContain("sentence_footer_tail_cut");
  });

  it("keeps substantive one-line descriptions that mention legal topics", () => {
    const raw = [
      "A mai epizódban egy munkajogi szakértővel beszélgetünk arról, hogyan működik a felmondás, milyen jogi lehetőségei vannak a munkavállalónak, és mit érdemes átnézni egy szerződésben.",
      "A beszélgetés konkrét példákon keresztül mutatja be a magyar munkahelyi konfliktusok tipikus hibáit.",
    ].join(" ");

    const result = heuristicClean(raw);

    expect(result.text).toContain("munkajogi szakértővel");
    expect(result.text).toContain("magyar munkahelyi konfliktusok");
    expect(result.removed).not.toContain("sentence_footer_tail_cut");
  });

  it("does not erase a substantive relationship description just because the footer is noisy", () => {
    const raw = [
      "Minden párkapcsolatnak szüksége van arra, hogy a felek időről időre őszintén beszéljenek a közelségről, a határokról és a visszatérő konfliktusokról.",
      "Ebben az adásban arról beszélgetünk, hogyan lehet újra kapcsolódni akkor is, amikor a hétköznapok már automatikussá tették a kommunikációt.",
      "Facebook: https://facebook.com/boldogparna Instagram: @boldogparna Honlap: https://boldogparna.hu",
    ].join(" ");

    const result = heuristicClean(raw);

    expect(result.text.length).toBeGreaterThan(140);
    expect(result.text).toContain("Minden párkapcsolatnak szüksége");
    expect(result.text).toContain("újra kapcsolódni");
    expect(result.text).not.toMatch(/Facebook|Instagram|Honlap|https?:\/\/|@boldogparna/i);
  });

  it("removes orphan URL fragments and platform labels when only newsletter junk remains", () => {
    const raw = [
      "Iratkozz fel hírleveleinkre: https://hvg.hu/hirlevel",
      "Klub360: info.hvg.hu/klub360",
      "Podcastok: .hvg.hu/podcast",
      "Hírlevél: cutt.ly/hvg-hirlevelek",
    ].join(" ");

    const result = heuristicClean(raw);

    expect(result.text).not.toMatch(/hvg\.hu|info\.hvg|cutt\.ly|Klub360|Podcastok|Hírlevél|Iratkozz/i);
    expect(result.text.length).toBeLessThan(20);
  });

  it("removes footer hashtag walls and Discord calls without touching the episode summary", () => {
    const raw = [
      "A mai adásban régi játékokról, hardverhibákról és arról beszélgetünk, miért maradnak emlékezetesek a technológiai korszakváltások.",
      "Discord szerverünk: https://discord.gg/kekhalal #podcast #retro #gaming #tech #kekhalal",
    ].join(" ");

    const result = heuristicClean(raw);

    expect(result.text).toContain("régi játékokról");
    expect(result.text).toContain("technológiai korszakváltások");
    expect(result.text).not.toMatch(/Discord|discord\.gg|#podcast|#retro|#gaming/i);
  });

  it("does not delete an ad-disclosed episode description that starts with a single hashtag", () => {
    const raw = [
      "#hirdetés November 28-a, a Black Friday napja minden évben egyet jelent a karácsonyi bevásárlási szezon berobbanásával.",
      "A beszélgetésben arról van szó, hogyan működnek az akciók, mire figyeljen a vásárló, és miért nem mindig valódi az árengedmény.",
      "Kövess minket Facebookon: https://facebook.com/kozoskoltseg",
    ].join(" ");

    const result = heuristicClean(raw);

    expect(result.text).toContain("Black Friday");
    expect(result.text).toContain("mire figyeljen a vásárló");
    expect(result.text.length).toBeGreaterThan(120);
    expect(result.text).not.toMatch(/Facebook|https?:\/\//i);
  });

  it("keeps substantive show notes lists instead of cutting after the first movie or book item", () => {
    const raw = [
      "Mivel rengeteg dolgot érintünk, ismét csak ömlesztett show notes van: King Arthur: Legend of the Sword.",
      "Könyv ajánló: E. K. Johnston: Ahsoka (Star Wars).",
      "Sorozatok: Person of Interest, Stargate Origins, Doctor Who, Blade Runner.",
      "A végén röviden beszélünk arról is, miért működnek ezek a történetek másképp könyvben és filmen.",
    ].join(" ");

    const result = heuristicClean(raw);

    expect(result.text).toContain("King Arthur");
    expect(result.text).toContain("Ahsoka");
    expect(result.text).toContain("Blade Runner");
    expect(result.text).toContain("könyvben és filmen");
    expect(result.removed).not.toContain("sentence_footer_tail_cut");
  });

  it("marks dirty cleaned text for AI trim without marking clean text", () => {
    const raw = "Ebben az adásban részletesen beszélgetünk a magyar gazdaság helyzetéről és a fontosabb piaci folyamatokról. Kövess minket Facebookon: https://example.com";
    const dirty = "Ebben az adásban részletesen beszélgetünk a magyar gazdaság helyzetéről. Kövess minket Facebookon:";
    const clean = "Ebben az adásban részletesen beszélgetünk a magyar gazdaság helyzetéről és a fontosabb piaci folyamatokról.";

    expect(assessCleanTextQuality(raw, dirty)).toMatchObject({
      ok: false,
      needs_ai_trim: true,
      overcut_risk: false,
    });
    expect(assessCleanTextQuality(raw, clean)).toMatchObject({
      ok: true,
      needs_ai_trim: false,
      overcut_risk: false,
    });
  });

  it("marks suspiciously tiny output from long raw text as overcut risk", () => {
    const raw = `${"Ez egy hosszabb, tartalmi leírás a beszélgetés témáiról és vendégeiről. ".repeat(20)} Facebook: https://example.com`;

    expect(assessCleanTextQuality(raw, "")).toMatchObject({
      ok: false,
      needs_ai_trim: false,
      overcut_risk: true,
    });
  });
});
