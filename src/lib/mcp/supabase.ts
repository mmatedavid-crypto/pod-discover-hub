// Server-side Supabase client for MCP tool handlers.
// Reads env at handler call time (not module top-level) so the MCP entry
// stays import-safe during build-time manifest extraction and cold start.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function getSupabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

export function json(obj: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }],
    structuredContent: obj as any,
  };
}

export function err(msg: string) {
  return { content: [{ type: "text" as const, text: msg }], isError: true };
}
