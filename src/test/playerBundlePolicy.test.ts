import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");

describe("smart player bundle policy", () => {
  it("keeps analytics and live notification side effects out of the passive provider bundle", () => {
    const provider = read("src/components/smart-player/SmartPlayerProvider.tsx");

    expect(provider).toContain('void import("@/lib/playerEvents")');
    expect(provider).toContain('void import("@/lib/liveTelegramNotify")');
    expect(provider).not.toContain('import { logPlayerEvent } from "@/lib/playerEvents"');
    expect(provider).not.toContain('import { notifyLiveEvent } from "@/lib/liveTelegramNotify"');
  });

  it("loads taste-vector mirroring only after relevant player events", () => {
    const events = read("src/lib/playerEvents.ts");

    expect(events).toContain('void import("@/lib/tasteInteractions")');
    expect(events).not.toContain('import { recordTasteInteraction } from "@/lib/tasteInteractions"');
  });

  it("actually executes the player_events insert instead of voiding a lazy builder", () => {
    const events = read("src/lib/playerEvents.ts");

    // A PostgREST builder only performs the request when awaited / .then()-ed.
    expect(events).not.toContain('void supabase\n      .from("player_events"');
    expect(events).not.toContain('void supabase.from("player_events"');
    expect(events).toContain(".then(() => undefined, () => undefined)");
  });
});
