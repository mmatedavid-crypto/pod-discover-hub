import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  episodeExactFields,
  exactCleanTextTsQuery,
  exactPhraseMatch,
  exactWebsearchQuery,
  parseExactPhraseQuery,
  stripSearchQuotes,
} from "../../supabase/functions/_shared/search-exact-phrase";

const ep = (over: Record<string, unknown>) => ({ title: "", description: "", podcasts: { title: "Műsor" }, ...over });

describe("quoted phrase parsing", () => {
  it("detects straight and Hungarian quotes", () => {
    expect(parseExactPhraseQuery('"magyar gazdaság"').phrases).toEqual([["magyar", "gazdasag"]]);
    expect(parseExactPhraseQuery("„magyar gazdaság”").phrases).toEqual([["magyar", "gazdasag"]]);
    expect(parseExactPhraseQuery("“Hajós András”").labels).toEqual(["Hajós András"]);
  });

  it("treats an unterminated quote as a phrase to the end, like Google", () => {
    expect(parseExactPhraseQuery('infláció "magyar gazdaság').phrases).toEqual([["magyar", "gazdasag"]]);
  });

  it("keeps free and excluded words outside quotes", () => {
    const p = parseExactPhraseQuery('"magyar gazdaság" infláció -tőzsde');
    expect(p.freeTerms).toEqual(["inflacio"]);
    expect(p.excluded).toEqual(["tozsde"]);
    expect(exactWebsearchQuery(p)).toBe('"magyar gazdasag" inflacio -tozsde');
  });

  it("does not switch to exact mode without quotes or with empty quotes", () => {
    expect(parseExactPhraseQuery("magyar gazdaság").hasExact).toBe(false);
    expect(parseExactPhraseQuery('""').hasExact).toBe(false);
    expect(stripSearchQuotes('„magyar gazdaság”')).toBe("magyar gazdaság");
  });

  it("never lets tsquery operators through", () => {
    const p = parseExactPhraseQuery('"a & b | !c <-> d:*" \')(');
    expect(exactWebsearchQuery(p)).toBe('"a b c d"');
    expect(exactCleanTextTsQuery(p)).toBe("(a <-> b <-> c <-> d)");
  });

  it("builds accented and accentless clean-text variants", () => {
    expect(exactCleanTextTsQuery(parseExactPhraseQuery('"magyar gazdaság" -tőzsde')))
      .toBe("((magyar <-> gazdaság) | (magyar <-> gazdasag)) & !tőzsde & !tozsde");
  });
});

describe("exact phrase matching", () => {
  const q = parseExactPhraseQuery('"magyar gazdaság"');

  it("matches the contiguous phrase, case and accent insensitive", () => {
    expect(exactPhraseMatch(episodeExactFields(ep({ title: "A MAGYAR GAZDASAG jövője" })), q)).toEqual({ ok: true, fields: ["title"] });
    expect(exactPhraseMatch(episodeExactFields(ep({ description: "<p>A magyar</p> gazdaság helyzete" })), q).ok).toBe(true);
  });

  it("rejects the same words when they are not adjacent or in order", () => {
    expect(exactPhraseMatch(episodeExactFields(ep({ title: "Magyar foci és a gazdaság" })), q).ok).toBe(false);
    expect(exactPhraseMatch(episodeExactFields(ep({ title: "Gazdaság magyar szemmel" })), q).ok).toBe(false);
  });

  it("does not match across separate fields", () => {
    expect(exactPhraseMatch(episodeExactFields(ep({ title: "Ez a magyar", description: "gazdaság" })), q).ok).toBe(false);
  });

  it("does not let a person name collide with split names", () => {
    const name = parseExactPhraseQuery('"Hajós András"');
    expect(exactPhraseMatch(episodeExactFields(ep({ title: "Hajós Szilárd és Miller András" })), name).ok).toBe(false);
    expect(exactPhraseMatch(episodeExactFields(ep({ people: ["Hajós András"] })), name)).toEqual({ ok: true, fields: ["tag"] });
  });

  it("matches the private clean text but requires free words and honours exclusions", () => {
    const withTerms = parseExactPhraseQuery('"magyar gazdaság" infláció -tőzsde');
    expect(exactPhraseMatch(episodeExactFields(ep({ title: "Infláció" }), "a magyar gazdaság lassul"), withTerms).ok).toBe(true);
    expect(exactPhraseMatch(episodeExactFields(ep({ title: "Hírek" }), "a magyar gazdaság lassul"), withTerms).ok).toBe(false);
    expect(exactPhraseMatch(episodeExactFields(ep({ title: "Infláció és tőzsde" }), "a magyar gazdaság lassul"), withTerms).ok).toBe(false);
  });
});

describe("search-hybrid exact mode routing", () => {
  const source = readFileSync("supabase/functions/search-hybrid/index.ts", "utf8");
  it("handles quoted queries before any AI understanding, embedding or rerank", () => {
    const exactAt = source.indexOf("exactQuery.hasExact");
    expect(exactAt).toBeGreaterThan(0);
    expect(exactAt).toBeLessThan(source.indexOf("understandQuery(q,"));
    expect(exactAt).toBeLessThan(source.indexOf("embed(q,"));
    const fn = source.slice(source.indexOf("async function runExactPhraseSearch"), source.indexOf("Deno.serve("));
    expect(fn).toContain("q_embedding: null");
    expect(fn).not.toMatch(/cohereRerank|understandQuery|getHydeExpansion|\.ilike\(/);
  });
});
