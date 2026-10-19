import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as nameHelpers from "../../supabase/functions/_shared/search-name-match";

const source = readFileSync("supabase/functions/search-hybrid/index.ts", "utf8");
const code = ts.transpileModule(source.replace(/^import .*;\r?$/gm, ""), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

function endpoint() {
  const person = { id: "person", name: "Hajós András", normalized_name: "hajos andras", slug: "hajos-andras",
    is_public: true, is_indexable: true, activation_status: "active", gated_episode_count: 17, guest_count: 17 };
  const podcast = { language_decision: "accept_hungarian", rss_status: "active" };
  const episodes = [
    { id: "split", title: "Hajós Szilárd és S. Miller András", people: ["Hajós Szilárd", "S. Miller András"], published_at: "2026-02-08", podcasts: podcast },
    { id: "real", title: "Hajós András – Apaidő", people: [], published_at: "2023-12-03", podcasts: podcast },
    { id: "suffix", title: "Médiatudatosság Hajós Andrással", people: [], published_at: "2025-11-21", podcasts: podcast },
    { id: "pending-only", title: "Másik vendég", people: [], published_at: "2026-10-18", podcasts: podcast },
    { id: "accepted-only", title: "Beszélgetés az apaságról", people: [], published_at: "2025-06-01", podcasts: podcast },
    { id: "clean-only", title: "Egy külön beszélgetés", people: [], published_at: "2025-05-01", podcasts: podcast },
  ];
  const tables: Record<string, any[]> = {
    people: [person], episodes,
    person_episode_mentions: [
      { person_id: "person", episode_id: "pending-only", relevance_status: "pending" },
      { person_id: "person", episode_id: "accepted-only", relevance_status: "accepted" },
    ],
    episode_clean_text: [{ episode_id: "clean-only", cleaned_text: "Bevezető ".repeat(800) + "Hajós András a vendégünk." }],
  };
  function builder(table: string) {
    const filters: ((row: any) => boolean)[] = [];
    const b: any = {};
    b.select = b.order = b.limit = b.or = b.ilike = b.like = b.gte = b.textSearch = () => b;
    b.eq = (key: string, value: any) => { if (!key.includes(".")) filters.push((row) => row[key] === value); return b; };
    b.in = (key: string, values: any[]) => { filters.push((row) => values.includes(row[key])); return b; };
    const rows = () => (tables[table] || []).filter((row) => filters.every((test) => test(row)));
    b.then = (resolve: any) => Promise.resolve({ data: rows() }).then(resolve);
    b.maybeSingle = () => Promise.resolve({ data: rows()[0] || null });
    return b;
  }
  const ai = vi.fn(() => { throw new Error("unexpected paid model call"); });
  let handler: (req: Request) => Promise<Response>;
  runInNewContext(code, {
    ...nameHelpers, createClient: () => ({ from: builder, rpc: () => Promise.resolve({ data: [] }) }),
    detectBot: () => ({ isBot: true, ua: "test-bot", reason: "ua" }),
    loadCuratedSynonyms: () => Promise.resolve({ matched_terms: [], expansions: [] }),
    understandQuery: ai, callLovableAI: ai, cohereRerank: ai, getHydeExpansion: ai,
    Deno: { env: { get: () => "test" }, serve: (callback: typeof handler) => { handler = callback; } },
    Request, Response, URL, setTimeout, clearTimeout, console: { log: () => {}, warn: () => {}, error: () => {} },
  });
  return { run: (q: string) => handler(new Request("https://example.test/search-hybrid", {
    method: "POST", body: JSON.stringify({ q, limit: 5 }),
  })), ai };
}

describe("hybrid person search endpoint", () => {
  it.each(["Hajós András", "hajós andrás", "hajos andras", "HAJÓS ANDRÁS"])("enforces complete identity before returning %s", async (q) => {
    const { run, ai } = endpoint();
    const response = await run(q);
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.person_name_strict).toBe(true);
    expect(result.person_pin?.name).toBe("Hajós András");
    expect(result.episodes.map((e: any) => e.id)).toEqual(["suffix", "real", "accepted-only", "clean-only"]);
    expect(result.ranking_version).toBeGreaterThanOrEqual(7);
    expect(ai).not.toHaveBeenCalled();
  });
});
