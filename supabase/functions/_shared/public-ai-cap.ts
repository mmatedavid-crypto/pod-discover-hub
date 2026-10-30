// Daily cap on paid AI calls that anonymous visitors can trigger (search
// understanding/embeddings, AI answer, AI suggestions). Caps live in
// app_settings.public_ai_call_caps; the counter is atomic in
// take_public_ai_call_v1 (service-role only). When the cap is reached — or the
// check itself fails — callers fall back to their free, non-AI path.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

let client: ReturnType<typeof createClient> | null = null;

export async function takePublicAiCall(kind: string): Promise<boolean> {
  try {
    if (!client) {
      client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }
    const { data, error } = await client.rpc("take_public_ai_call_v1", { p_kind: kind });
    if (error) {
      console.warn("public AI cap check failed", { kind, code: error.code });
      return false;
    }
    return data === true;
  } catch {
    return false;
  }
}
