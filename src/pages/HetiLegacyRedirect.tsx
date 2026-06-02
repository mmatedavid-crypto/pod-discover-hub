import { useEffect, useState } from "react";
import { useParams, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { hetiSlug } from "@/lib/hetiSlug";

/**
 * Backwards-compat redirect for the legacy /heti-valogatas/:weekId URLs.
 * weekId was the YYYY-MM-DD week_start. We look up the post and 301 (via
 * SPA replace) to the new /heti/[slug].
 */
export default function HetiLegacyRedirect() {
  const { weekId } = useParams<{ weekId?: string }>();
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!weekId) { setTarget("/heti"); return; }
    (async () => {
      const { data } = await supabase
        .from("editorial_posts" as any)
        .select("week_start,title")
        .eq("status", "published")
        .eq("week_start", weekId)
        .limit(1);
      const p = (data?.[0] as unknown as { week_start: string; title: string | null }) || null;
      setTarget(p ? `/heti/${hetiSlug(p)}` : "/heti");
    })();
  }, [weekId]);

  if (!target) return null;
  return <Navigate to={target} replace />;
}
