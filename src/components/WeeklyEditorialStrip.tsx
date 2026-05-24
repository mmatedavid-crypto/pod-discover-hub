import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Sparkles, ArrowRight } from "lucide-react";

type Post = {
  id: string;
  week_start: string;
  week_end: string;
  title: string | null;
  intro: string | null;
  items: Array<{ podcast_name?: string; title?: string }> | null;
  published_at: string | null;
};

export default function WeeklyEditorialStrip() {
  const [post, setPost] = useState<Post | null>(null);

  useEffect(() => {
    (async () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
      const { data } = await supabase
        .from("editorial_posts" as any)
        .select("id,week_start,week_end,title,intro,items,published_at")
        .eq("status", "published")
        .gte("published_at", sevenDaysAgo)
        .order("published_at", { ascending: false })
        .limit(1);
      const p = (data?.[0] as unknown as Post) || null;
      setPost(p);
    })();
  }, []);

  if (!post) return null;

  const teaser =
    (post.intro || "").split("\n").find((l) => l.trim().length > 30)?.trim().slice(0, 180) ||
    `${post.items?.length ?? 0} epizód, amit érdemes meghallgatni a héten.`;

  return (
    <section className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/[0.08] via-card/40 to-card/40 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <Sparkles className="h-5 w-5 text-primary mt-1 shrink-0" aria-hidden />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-[0.18em] text-primary font-semibold mb-1.5">
            Heti válogatás
          </div>
          <h2 className="text-lg sm:text-xl font-semibold leading-snug mb-1.5">
            <Link to="/heti-valogatas" className="hover:text-primary">
              {post.title || "A hét legizgalmasabb podcast epizódjai"}
            </Link>
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed mb-3 line-clamp-2">
            {teaser}
          </p>
          <Link
            to="/heti-valogatas"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            Olvasd el a heti válogatást
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}
