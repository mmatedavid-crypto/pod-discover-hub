import { describe, expect, it } from "vitest";
import { findProductionCreditHits } from "../../supabase/functions/_shared/person-production-credit";

const pc = (d: string, name: string, extra: Record<string, string> = {}) =>
  findProductionCreditHits({ episode_description: d, ...extra }, name);

describe("production-credit-v1: crew-only credits", () => {
  it("Mentálfröccs case: named only as editor (vágó) → production credit", () => {
    const r = pc("<p>Beszélgetés a szorongásról Szabó Annával.</p><p>Vágó: Pázmándi Gergely</p>", "Pázmándi Gergely");
    expect(r.outcome).toBe("production_credit");
    expect(r.hits[0].snippet).toBe("Vágó: Pázmándi Gergely");
  });
  it("label on its own line followed by a name list", () => {
    const d = "<p>Vágók, szerkesztők:</p><p>Pázmándi Gergely</p><p>Horváth Richárd</p><p><br></p><p>Fény, fotó, videó, vizuál:</p><p>Szávics Attila</p>";
    expect(pc(d, "Horváth Richárd").outcome).toBe("production_credit");
    expect(pc(d, "Szávics Attila").outcome).toBe("production_credit");
  });
  it("several crew labels in one line", () => {
    const d = "Utómunka: Herczeg András Főszerkesztő: Harasztovics Arnold";
    expect(pc(d, "Herczeg András").outcome).toBe("production_credit");
    expect(pc(d, "Harasztovics Arnold").outcome).toBe("production_credit");
  });
  it("credit in a matched Spotify description counts too", () => {
    expect(pc("Beszélgetés a gazdaságról.", "Nagy Béla", { spotify_episode_description: "Hangmérnök: Nagy Béla" }).outcome).toBe("production_credit");
  });
});

describe("production-credit-v1: never closes a speaking person", () => {
  it("host who also edits stays open (Mindenségit! pattern)", () => {
    const d = "Műsorvezető: Pázmándi Gergely\nSzerkesztő, vágó: Pázmándi Gergely, Horváth Richárd";
    expect(pc(d, "Pázmándi Gergely").outcome).toBe("production_mixed");
    expect(pc(d, "Horváth Richárd").outcome).toBe("production_credit");
  });
  it("name also in running text or title stays open", () => {
    expect(pc("Kovács Péter mesél a gyerekkoráról.\nSzerkesztő: Kovács Péter", "Kovács Péter").outcome).toBe("production_mixed");
    expect(findProductionCreditHits({ episode_title: "Kovács Péter", episode_description: "Vágó: Kovács Péter" }, "Kovács Péter").outcome).toBe("production_mixed");
  });
  it("speaking role glued to the crew word is not a crew-only credit", () => {
    expect(pc("Műsorvezető és szerkesztő: Tóth Eszter", "Tóth Eszter").outcome).not.toBe("production_credit");
    expect(pc("Riporter, szerkesztő: Tóth Eszter", "Tóth Eszter").outcome).not.toBe("production_credit");
    expect(pc("Szerkesztő-műsorvezető: Tóth Eszter", "Tóth Eszter").outcome).not.toBe("production_credit");
  });
  it("guest line is not a crew credit", () => {
    expect(pc("Vendég: Kovács Péter. Szerkesztő: Nagy Béla", "Kovács Péter").outcome).not.toBe("production_credit");
  });
  it("longer name (homonym prefix) and possessive forms are not the person", () => {
    expect(pc("Vágó: Pintér András Gábor", "Pintér András").outcome).not.toBe("production_credit");
    expect(pc("Szerkesztő: Kiss Anna munkatársa", "Kiss Anna").outcome).not.toBe("production_credit");
  });
  it("a sentence after the label line is not a name list", () => {
    const d = "Vágó:\nEbben az adásban Kovács Péter vendégünk volt.";
    expect(pc(d, "Kovács Péter").outcome).not.toBe("production_credit");
  });
  it("music labels list the episode's content on music shows, not its crew", () => {
    expect(pc("Zene: Henry Threadgill, Wadada Leo Smith", "Henry Threadgill").outcome).toBe("none");
    expect(pc("Mix: Kovács Péter", "Kovács Péter").outcome).toBe("none");
    expect(pc("Zenei szerkesztő: Varga Ramona", "Varga Ramona").outcome).toBe("production_credit");
  });
  it("no crew label → nothing", () => {
    expect(pc("Kovács Péter beszélgetése a gazdaságról", "Kovács Péter").outcome).toBe("none");
  });
});
