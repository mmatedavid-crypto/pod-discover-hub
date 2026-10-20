import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as nameHelpers from "../../supabase/functions/_shared/search-name-match";
import * as personEvidence from "../../supabase/functions/_shared/search-person-evidence";
import * as exactPhrase from "../../supabase/functions/_shared/search-exact-phrase";

const source = readFileSync("supabase/functions/search-hybrid/index.ts", "utf8");
const code = ts.transpileModule(source.replace(/^import .*;\r?$/gm, ""), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

const podcast = { language_decision: "accept_hungarian", rss_status: "active" };
const basePerson = {
  id: "person", name: "Hajós András", normalized_name: "hajos andras", slug: "hajos-andras",
  is_public: true, is_indexable: true, activation_status: "active", gated_episode_count: 17, guest_count: 17,
  identity_ambiguous: false, wikipedia_match_status: "no_match", wikipedia_match_confidence: 0,
};

type Options = { ambiguous?: boolean; homonym?: boolean; hangCleanText?: boolean };

function endpoint(options: Options = {}) {
  const people: any[] = [{ ...basePerson, identity_ambiguous: !!options.ambiguous }];
  if (options.homonym) people.push({ ...basePerson, id: "person-2", slug: "hajos-andras-culture", gated_episode_count: 3, disambiguation_label: "kultúra" });
  const episodes = [
    { id: "split", title: "Hajós Szilárd és S. Miller András", people: ["Hajós Szilárd", "S. Miller András"], published_at: "2026-02-08", podcasts: podcast },
    { id: "real", title: "Hajós András – Apaidő", people: [], published_at: "2023-12-03", podcasts: podcast },
    { id: "real-dup", title: "Hajós András – apaidő", people: [], published_at: "2023-12-03T10:00:00Z", podcasts: podcast },
    { id: "suffix", title: "Médiatudatosság Hajós Andrással", people: [], published_at: "2025-11-21", podcasts: podcast },
    { id: "pending-only", title: "Másik vendég", people: [], published_at: "2026-10-18", podcasts: podcast },
    { id: "pending-text", title: "Beszélgetés Hajós Andrással a könyvekről", people: [], published_at: "2026-09-01", podcasts: podcast },
    { id: "accepted-only", title: "Beszélgetés az apaságról", people: [], published_at: "2025-06-01", podcasts: podcast },
    { id: "rejected-title", title: "Hajós András a rádióban", people: [], published_at: "2026-10-01", podcasts: podcast },
    { id: "clean-only", title: "Egy külön beszélgetés", people: [], published_at: "2025-05-01", podcasts: podcast },
    { id: "homonym-ep", title: "Kulturális est", people: [], published_at: "2024-01-01", podcasts: podcast },
  ];
  const mentions = [
    { person_id: "person", episode_id: "real", relevance_status: "accepted", mention_type: "guest", role_type: "participant" },
    { person_id: "person", episode_id: "suffix", relevance_status: "accepted", mention_type: "mentioned", role_type: "subject" },
    { person_id: "person", episode_id: "accepted-only", relevance_status: "accepted", mention_type: "mentioned", role_type: "mention" },
    { person_id: "person", episode_id: "pending-only", relevance_status: "pending", mention_type: "guest", role_type: "participant" },
    { person_id: "person", episode_id: "pending-text", relevance_status: "pending", mention_type: "mentioned", role_type: "mention" },
    { person_id: "person", episode_id: "rejected-title", relevance_status: "rejected", mention_type: "guest", role_type: "participant" },
    { person_id: "person-2", episode_id: "homonym-ep", relevance_status: "accepted", mention_type: "guest", role_type: "participant" },
  ];
  const tables: Record<string, any[]> = {
    people, episodes, person_episode_mentions: mentions,
    episode_clean_text: [{ episode_id: "clean-only", cleaned_text: "Bevezető ".repeat(800) + "Hajós András a vendégünk." }],
  };
  const heavyScans: string[] = [];
  let queryCount = 0;
  const touched: string[] = [];
  function builder(table: string) {
    queryCount++;
    touched.push(table);
    const filters: ((row: any) => boolean)[] = [];
    const b: any = {};
    b.select = b.order = b.limit = b.or = b.like = b.gte = b.textSearch = () => b;
    b.ilike = (key: string) => { if (table === "episode_clean_text" || (table === "episodes" && key === "description")) heavyScans.push(`${table}.${key}`); return b; };
    b.eq = (key: string, value: any) => { if (!key.includes(".")) filters.push((row) => row[key] === value); return b; };
    b.neq = (key: string, value: any) => { filters.push((row) => row[key] !== value); return b; };
    b.in = (key: string, values: any[]) => { filters.push((row) => values.includes(row[key])); return b; };
    const rows = () => (tables[table] || []).filter((row) => filters.every((test) => test(row)));
    b.then = (resolve: any, reject?: any) => Promise.resolve({ data: rows() }).then(resolve, reject);
    b.maybeSingle = () => Promise.resolve({ data: rows()[0] || null });
    return b;
  }
  const rpc = (name: string) => {
    touched.push(`rpc:${name}`);
    if (name === "search_clean_text_name_candidates") {
      return options.hangCleanText ? new Promise(() => {}) : Promise.resolve({ data: tables.episode_clean_text });
    }
    return Promise.resolve({ data: [] });
  };
  const ai = vi.fn(() => { throw new Error("unexpected paid model call"); });
  let handler: (req: Request) => Promise<Response>;
  runInNewContext(code, {
    ...nameHelpers, ...personEvidence, ...exactPhrase, createClient: () => ({ from: builder, rpc }),
    detectBot: () => ({ isBot: true, ua: "test-bot", reason: "ua" }),
    loadCuratedSynonyms: () => Promise.resolve({ matched_terms: [], expansions: [] }),
    understandQuery: ai, callLovableAI: ai, cohereRerank: ai, getHydeExpansion: ai,
    detectAdjNounTopic: () => null, buildExpandedQuery: (_u: unknown, q: string) => q, blendEmbeddings: (a: unknown) => a,
    Deno: { env: { get: () => "test" }, serve: (callback: typeof handler) => { handler = callback; } },
    Request, Response, URL, setTimeout, clearTimeout, console: { log: () => {}, warn: () => {}, error: () => {} },
  });
  return {
    run: async (q: string) => {
      const started = Date.now();
      const response = await handler(new Request("https://example.test/search-hybrid", { method: "POST", body: JSON.stringify({ q, limit: 20 }) }));
      return { response, result: await response.json(), ms: Date.now() - started };
    },
    ai, heavyScans, touched, queries: () => queryCount,
  };
}

const ids = (result: any) => result.episodes.map((e: any) => e.id);
const SPELLINGS = ["Hajós András", "hajós andrás", "hajos andras", "HAJÓS ANDRÁS"];
const ROLE_ORDER = ["real", "suffix", "accepted-only", "pending-text", "rejected-title", "clean-only"];

describe("person-first hybrid name search", () => {
  it.each(SPELLINGS)("orders by relationship evidence for a confirmed identity: %s", async (q) => {
    const { run, ai, heavyScans } = endpoint();
    const { response, result } = await run(q);
    expect(response.status).toBe(200);
    expect(result.person_name_strict).toBe(true);
    expect(result.person_identity).toBe("verified");
    expect(result.person_pin?.name).toBe("Hajós András");
    expect(result.matched_person_ids).toEqual(["person"]);
    expect(ids(result)).toEqual(ROLE_ORDER);
    expect(result.episodes.map((e: any) => e.name_evidence.label)).toEqual([
      "Vendég", "Róla szól", "Említés", "Nem ellenőrzött kapcsolat", "Szöveges találat", "Szöveges találat",
    ]);
    expect(result.ranking_version).toBeGreaterThanOrEqual(8);
    expect(heavyScans).toEqual([]);
    expect(ai).not.toHaveBeenCalled();
  });

  it("never matches a split name and never uses a rejected link as identity evidence", async () => {
    const { run } = endpoint();
    const { result } = await run("Hajós András");
    expect(ids(result)).not.toContain("split");
    expect(ids(result)).not.toContain("pending-only");
    const rejected = result.episodes.find((e: any) => e.id === "rejected-title");
    expect(rejected.name_evidence.kind).toBe("title_text");
    expect(rejected.name_evidence.identity_unconfirmed).toBe(true);
  });

  it("returns a different name's own episode without leaking the other person", async () => {
    const { run } = endpoint();
    const { result } = await run("Hajós Szilárd");
    expect(ids(result)).toEqual(["split"]);
    expect(result.person_pin).toBeUndefined();
  });

  it("removes duplicate episode cards with the same title and day", async () => {
    const { run } = endpoint();
    const { result } = await run("Hajós András");
    expect(ids(result).filter((id: string) => id.startsWith("real"))).toEqual(["real"]);
  });

  it.each(SPELLINGS)("keeps accepted links of an ambiguous identity but marks them unconfirmed: %s", async (q) => {
    const { run, ai } = endpoint({ ambiguous: true });
    const { result } = await run(q);
    expect(result.person_name_strict).toBe(true);
    expect(result.person_identity).toBe("unconfirmed");
    expect(result.person_pin).toBeUndefined();
    expect(result.matched_person_ids).toEqual([]);
    expect(result.person_candidates).toHaveLength(1);
    expect(ids(result)).toEqual(ROLE_ORDER);
    expect(result.episodes[0].name_evidence.label).toBe("Vendég · azonosság nem igazolt");
    expect(result.episodes.every((e: any) => e.name_evidence.identity_unconfirmed)).toBe(true);
    expect(ai).not.toHaveBeenCalled();
  });

  it("shows disambiguation instead of one identity when two people share the name", async () => {
    const { run } = endpoint({ homonym: true });
    const { result } = await run("Hajós András");
    expect(result.person_identity).toBe("multiple");
    expect(result.person_pin).toBeUndefined();
    expect(result.person_candidates.map((c: any) => c.slug)).toEqual(["hajos-andras", "hajos-andras-culture"]);
    expect(ids(result)).toContain("homonym-ep");
    expect(result.episodes.find((e: any) => e.id === "homonym-ep").name_evidence.person_slug).toBe("hajos-andras-culture");
    expect(result.episodes.every((e: any) => e.name_evidence.identity_unconfirmed)).toBe(true);
  });

  it("degrades a stalled source within the per-query cap and keeps indexed results", async () => {
    const { run, queries } = endpoint({ hangCleanText: true });
    const { result, ms } = await run("Hajós András");
    expect(ms).toBeLessThan(4500);
    expect(result.timing.person_strict.unavailable).toContain("clean_text_fts");
    expect(result.timing.person_strict.queries).toBeLessThanOrEqual(10);
    expect(ids(result)).toEqual(ROLE_ORDER.filter((id) => id !== "clean-only"));
    expect(queries()).toBeLessThan(40);
  }, 10000);

  it("leaves a general topic search to the normal pipeline", async () => {
    const { run, touched, ai } = endpoint();
    const { response, result } = await run("gulyásleves titka");
    expect(response.status).toBe(200);
    expect(result.person_name_strict).toBeUndefined();
    expect(result.person_identity).toBeUndefined();
    expect(touched).not.toContain("rpc:search_clean_text_name_candidates");
    expect(ai).not.toHaveBeenCalled();
  });
});
