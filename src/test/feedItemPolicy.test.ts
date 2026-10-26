import { describe, expect, it } from "vitest";
import { countLinks, linkIdentifiesItem, newestFirst } from "../../supabase/functions/_shared/feed-item-policy";

describe("feed item policy", () => {
  it("reads oldest-first feeds newest first", () => {
    const items = [{ title: "a", published: "2014-02-05T00:00:00Z" }, { title: "b", published: "2018-07-14T00:00:00Z" }, { title: "c", published: "2026-10-26T18:00:00Z" }];
    expect(newestFirst(items).map((i) => i.title)).toEqual(["c", "b", "a"]);
  });
  it("keeps undated items after dated ones in feed order", () => {
    const items = [{ title: "x", published: null }, { title: "a", published: "2026-01-01T00:00:00Z" }, { title: "y", published: null }];
    expect(newestFirst(items).map((i) => i.title)).toEqual(["a", "x", "y"]);
  });
  it("never treats a shared show page link as the episode identity", () => {
    const items = [{ guid: null, link: "https://example.hu/" }, { guid: null, link: "https://example.hu/" }, { guid: null, link: "https://example.hu/ep/3" }];
    const counts = countLinks(items);
    expect(linkIdentifiesItem(items[0], counts)).toBe(false);
    expect(linkIdentifiesItem(items[2], counts)).toBe(true);
  });
  it("uses the guid, not the link, when the item has one", () => {
    const items = [{ guid: "spreaker-75204198", link: "https://example.hu/ep/1" }];
    expect(linkIdentifiesItem(items[0], countLinks(items))).toBe(false);
  });
});
