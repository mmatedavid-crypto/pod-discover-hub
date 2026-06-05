import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { setSeo, breadcrumbJsonLd } from "@/lib/seo";
import NotFoundState from "@/components/NotFoundState";
import { EpisodeList, EpisodeLite } from "@/components/EpisodeCard";
import { ArrowLeft, ArrowRight, ChevronRight, Sparkles } from "lucide-react";
import { polishMoodTitle } from "@/components/MoodCollections";
import { sanitizeHungarianPublicText } from "@/lib/publicTextLanguage";

const SITE = "https://podiverzum.hu";

type RelatedMood = {
  slug: string;
  title: string;
  short_description: string | null;
  accent_hsl: string | null;
};

export default function MoodCollectionPage() {
  const { slug } = useParams();
  const [mood, setMood] = useState<any>(null);
  const [episodes, setEpisodes] = useState<EpisodeLite[]>([]);
  const [related, setRelated] = useState<RelatedMood[]>([]);
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
      const canonical = `${SITE}/hangulatok/${(m as any).slug}`;
      const pageTitle = polishMoodTitle((m as any).title, (m as any).slug);
      const shortDescription = sanitizeHungarianPublicText((m as any).short_description);
      const longDescription = sanitizeHungarianPublicText((m as any).description);
      setSeo({
        title: `${pageTitle} — hallgatási helyzet | Podiverzum`,
        description:
          shortDescription ||
          longDescription ||
          `Magyar podcast epizódok ehhez a hallgatási helyzethez: ${pageTitle}.`,
        canonical,
        noindex: !(m as any).is_indexable,
        jsonLd: breadcrumbJsonLd([
          { name: "Podiverzum", url: SITE },
          { name: "Hallgatási helyzetek", url: `${SITE}/hangulatok` },
          { name: pageTitle, url: canonical },
        ]),
      });

      const [{ data: recs }, { data: rel }] = await Promise.all([
        supabase.rpc("get_mood_episode_recommendations", {
          p_mood_slug: slug,
          p_limit: 18,
        }),
        supabase
          .from("mood_collections" as any)
          .select("slug,title,short_description,accent_hsl,sort_order")
          .eq("active", true)
          .neq("slug", slug)
          .order("sort_order")
          .limit(6),
      ]);

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
        image_url: r.image_url || null,
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
      setRelated(((rel as any[]) || []) as RelatedMood[]);
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
  const pageTitle = polishMoodTitle(mood.title, mood.slug);
  const description = sanitizeHungarianPublicText(mood.description) || sanitizeHungarianPublicText(mood.short_description);
  const subtitle =
    sanitizeHungarianPublicText(mood.short_description) || "Magyar podcast epizódok ehhez a hallgatási helyzethez.";

  return (
    <Layout>
      <div className="container mx-auto py-10 max-w-5xl">
        {/* Breadcrumb */}
        <nav
          aria-label="Breadcrumb"
          className="text-xs text-muted-foreground inline-flex items-center gap-1 flex-wrap"
        >
          <Link to="/" className="hover:text-foreground">Podiverzum</Link>
          <ChevronRight className="h-3 w-3" />
          <Link to="/hangulatok" className="hover:text-foreground">Hallgatási helyzetek</Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-foreground">{pageTitle}</span>
        </nav>

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
          <h1 className="text-3xl sm:text-4xl font-semibold">{pageTitle}</h1>
          {description && (
            <p className="text-muted-foreground mt-2">
              {description}
            </p>
          )}
        </div>

        {episodes.length > 0 ? (
          <section className="mt-10">
            <h2 className="font-semibold text-lg">Ajánlott epizódok</h2>
            <p className="text-xs text-muted-foreground mt-1 mb-4">{subtitle}</p>
            <EpisodeList items={episodes} />
          </section>
        ) : (
          <div className="mt-10 p-6 border border-border rounded-lg bg-card text-sm text-muted-foreground">
            Egyelőre nincs erős találat ehhez a hallgatási helyzethez. Nézz vissza hamarosan.
          </div>
        )}

        {related.length > 0 && (
          <section className="mt-12">
            <h2 className="font-semibold text-lg mb-3">További hallgatási helyzetek</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {related.map((r) => {
                const a = r.accent_hsl ? `hsl(${r.accent_hsl})` : "hsl(var(--primary))";
                return (
                  <Link
                    key={r.slug}
                    to={`/hangulatok/${r.slug}`}
                    className="group rounded-xl border border-border/70 hover:border-primary/40 p-4 transition-colors"
                    style={{ background: `linear-gradient(135deg, ${a}1a, transparent 70%), hsl(var(--card) / 0.6)` }}
                  >
                    <div className="flex items-start justify-between">
                      <Sparkles className="h-4 w-4" style={{ color: a }} />
                      <ArrowRight className="h-3 w-3 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
                    </div>
                    <div className="mt-2 font-medium text-sm leading-tight">{polishMoodTitle(r.title, r.slug)}</div>
                    {sanitizeHungarianPublicText(r.short_description) && (
                      <div className="text-[11px] text-muted-foreground mt-1 line-clamp-2">
                        {sanitizeHungarianPublicText(r.short_description)}
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        <div className="mt-10">
          <Link
            to="/hangulatok"
            className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Összes hallgatási helyzet
          </Link>
        </div>
      </div>
    </Layout>
  );
}
