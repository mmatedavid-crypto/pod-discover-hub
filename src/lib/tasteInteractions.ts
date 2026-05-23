// Fire-and-forget client helper for recording user/episode interactions
// that feed the personalized taste vector. No-op when not authenticated.

import { supabase } from "@/integrations/supabase/client";

export type TasteInteractionKind =
  | "like"
  | "dislike"
  | "play_start"
  | "play_30s"
  | "play_complete"
  | "skip"
  | "dismiss";

const sent = new Set<string>(); // session-local de-dupe

export async function recordTasteInteraction(
  episodeId: string | null | undefined,
  kind: TasteInteractionKind,
  source: string = "app",
): Promise<void> {
  if (!episodeId) return;
  const key = `${episodeId}:${kind}`;
  if (sent.has(key) && kind !== "like" && kind !== "dislike") return;
  sent.add(key);
  try {
    const { data: session } = await supabase.auth.getSession();
    if (!session.session?.user) return;
    await supabase.rpc("record_episode_interaction" as never, {
      p_episode_id: episodeId,
      p_kind: kind,
      p_source: source,
    } as never);
  } catch {
    /* fail-safe */
  }
}
