import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { setSeo } from "@/lib/seo";
import NotFoundState from "@/components/NotFoundState";
import { EpisodeList, EpisodeLite } from "@/components/EpisodeCard";
import { ArrowLeft, Sparkles } from "lucide-react";

export default function MoodCollectionPage() {
  const { slug } = useParams();
  const [mood, setMood] = useState<any>(null);
  const [episodes, setEpisodes] = useState<EpisodeLite[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      setLoading(true);
      const { data: m } = await supabase
        .from("mood_collections" as any)
        .select("slug,title,mood,description,short_description,accent_hsl,is_indexable")
        .eq("slug", slug)
        .eq("active", true)
        .maybeSingle();
      setMood(m);
      if (!m) {
        setLoading(false);
        return;
      }
      // Mood detail pages are noindex by default until is_indexable=true is set per mood.
      setSeo({
        title: `${(m as any).title} — hallgatási helyzet | Podiverzum`,
        description:
          (m as any).short_description ||
          (m as any).description ||
          `Magyar podcast epizódok ehhez a hallgatási helyzethez: ${(m as any).title}.`,
        noindex: !(m as any).is_indexable,
      });

      const { data: recs } = await supabase.rpc("get_mood_episode_recommendations", {
        p_mood_slug: slug,
        p_limit: 18,
      });

      const mapped: EpisodeLite[] = ((recs as any[]) || []).map((r) => ({
        id: r.episode_id,
        title: r.title,
        display_title: r.display_title,
        slug: r.slug,
        summary: r.summary,
        ai_summary: r.ai_summary,
        description: r.description,
        published_at: r.published_at,
        audio_url: r.audio_url,
        topics: r.topics,
        podcasts: {
          slug: r.podcast_slug,
          title: r.podcast_title,
          display_title: r.podcast_display_title,
          image_url: r.podcast_image_url,
          category: r.podcast_category,
          podiverzum_rank: r.podiverzum_rank,
          rank_label: r.rank_label,
        } as any,
      }));
      setEpisodes(mapped);
      setLoading(false);
    })();
  }, [slug]);

  if (loading)
    return (
      <Layout>
        <div className="container mx-auto py-20 text-muted-foreground">Betöltés…</div>
      </Layout>
    );
  if (!mood)
    return (
      <NotFoundState
        title="Nincs ilyen hallgatási helyzet"
        message="Ez a válogatás nem létezik vagy már nem aktív."
      />
    );

  const accent = mood.accent_hsl ? `hsl(${mood.accent_hsl})` : "hsl(var(--primary))";

  return (
    <Layout>
      <div className="container mx-auto py-10 max-w-5xl">
        <Link
          to="/hangulatok"
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Összes hallgatási helyzet
        </Link>
        <div
          className="mt-3 rounded-2xl border border-border bg-card/60 p-6 sm:p-8"
          style={{
            background: `linear-gradient(135deg, ${accent}1a, transparent 70%), hsl(var(--card) / 0.6)`,
          }}
        >
          <div
            className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] mb-2"
            style={{ color: accent }}
          >
            <Sparkles className="h-3 w-3" /> Hallgatási helyzet
          </div>
          <h1 className="text-3xl sm:text-4xl font-semibold">{mood.title}</h1>
          <p className="text-muted-foreground mt-2">
            {mood.description || mood.short_description}
          </p>
        </div>

        {episodes.length > 0 ? (
          <section className="mt-10">
            <h2 className="font-semibold mb-3">Ajánlott magyar epizódok</h2>
            <EpisodeList items={episodes} />
          </section>
        ) : (
          <div className="mt-10 p-6 border border-border rounded-lg bg-card text-sm text-muted-foreground">
            Egyelőre nincs erős találat ehhez a hallgatási helyzethez. Nézz vissza hamarosan.
          </div>
        )}
      </div>
    </Layout>
  );
}
