import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
// Static fallback only — real OG comes from prerender (bots) or dynamic og-image (below).
import ogFallback from "@/assets/te-podiverzumod-og.jpg";

type PublicShare = {
  share_id: string;
  result_type: string;
  result_title: string;
  result_subtitle: string | null;
  result_description: string;
  tags: string[];
  aura_colors: string[];
  created_at: string;
  expires_at: string | null;
};

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID as string;
const SHARE_FN_URL = `https://${PROJECT_ID}.supabase.co/functions/v1/te-podiverzumod-share`;

const SITE = "https://podiverzum.hu";
const OG_FALLBACK_ABS = `${SITE}${ogFallback}`;

function buildDynamicOg(share: PublicShare | null): string {
  if (!share) return OG_FALLBACK_ABS;
  const params = new URLSearchParams({
    kind: "share",
    title: share.result_title || "A Te Podiverzumod",
    subtitle: share.result_subtitle ? `A TE PODIVERZUMOD · ${share.result_subtitle}` : "A TE PODIVERZUMOD",
  });
  return `https://${PROJECT_ID}.supabase.co/functions/v1/og-image?${params.toString()}`;
}

export default function TePodiverzumodSharePage() {
  const { slug } = useParams<{ slug: string }>();
  const [share, setShare] = useState<PublicShare | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${SHARE_FN_URL}?id=${encodeURIComponent(slug)}`, {
          headers: { "Content-Type": "application/json" },
        });
        if (cancelled) return;
        if (res.status === 404) {
          setError("Ez a megosztott eredmény már nem elérhető.");
        } else if (!res.ok) {
          setError("Nem sikerült betölteni az eredményt.");
        } else {
          const data = (await res.json()) as PublicShare;
          setShare(data);
        }
      } catch {
        if (!cancelled) setError("Hálózati hiba.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  const pageUrl = `${SITE}/te-podiverzumod/eredmeny/${slug ?? ""}`;
  const ogTitle = share
    ? `Én ${share.result_title} lettem a Podiverzumon`
    : "A Te Podiverzumod — milyen hallgató vagy?";
  const ogDesc = share
    ? `${share.result_subtitle ? share.result_subtitle + " · " : ""}Nézd meg, te milyen hallgató vagy.`
    : "Nézd meg, te milyen hallgató vagy a Podiverzumon.";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Helmet>
        <title>{ogTitle} — Podiverzum</title>
        <meta name="description" content={ogDesc} />
        <link rel="canonical" href={pageUrl} />
        <meta property="og:type" content="article" />
        <meta property="og:url" content={pageUrl} />
        <meta property="og:title" content={ogTitle} />
        <meta property="og:description" content={ogDesc} />
        <meta property="og:image" content={OG_IMAGE_ABS} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:site_name" content="Podiverzum" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={ogTitle} />
        <meta name="twitter:description" content={ogDesc} />
        <meta name="twitter:image" content={OG_IMAGE_ABS} />
      </Helmet>

      <div className="mx-auto max-w-xl px-4 pt-6 pb-32 md:pt-10">
        <header className="mb-6 flex items-center justify-between">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← Podiverzum</Link>
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" /> A Te Podiverzumod
          </div>
        </header>

        {loading && (
          <div className="space-y-6">
            <Skeleton className="h-72 w-full rounded-3xl" />
            <Skeleton className="h-24 w-full rounded-2xl" />
            <Skeleton className="h-12 w-full rounded-2xl" />
          </div>
        )}

        {!loading && error && (
          <div className="rounded-3xl border border-border bg-card p-8 text-center">
            <p className="text-muted-foreground">{error}</p>
            <Button asChild className="mt-6">
              <Link to="/start">Én is kipróbálom <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
          </div>
        )}

        {!loading && share && (
          <ResultCard share={share} />
        )}

        {!loading && (
          <div className="mt-10 rounded-3xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card p-6 text-center md:p-8">
            <div className="text-[10px] uppercase tracking-[0.25em] text-primary">CTA</div>
            <h2 className="mt-2 text-2xl font-semibold md:text-3xl">
              Nézd meg, te milyen hallgató vagy
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Pár perc. Pár swipe. A személyes podcast-profilod.
            </p>
            <Button asChild size="lg" className="mt-5 w-full md:w-auto">
              <Link to="/start">Én is kipróbálom <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ResultCard({ share }: { share: PublicShare }) {
  const colors = share.aura_colors.length >= 2
    ? share.aura_colors
    : ["#dc2626", "#7c1d1d", "#0a0a0f"];
  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-card">
      <div
        className="relative h-64 w-full md:h-80"
        style={{
          background: `radial-gradient(circle at 30% 30%, ${colors[0]} 0%, transparent 55%), radial-gradient(circle at 75% 70%, ${colors[1] || colors[0]} 0%, transparent 60%), #0a0a0f`,
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-card via-card/30 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-6 md:p-8">
          <div className="text-[10px] uppercase tracking-[0.25em] text-white/70">
            A Te Podiverzumod
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white drop-shadow-md md:text-5xl">
            {share.result_title}
          </h1>
          {share.result_subtitle && (
            <div className="mt-1 text-sm italic text-white/80">{share.result_subtitle}</div>
          )}
        </div>
      </div>

      <div className="space-y-5 p-6 md:p-8">
        <p className="text-sm leading-relaxed text-foreground md:text-base">
          {share.result_description}
        </p>

        {share.tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {share.tags.map(t => (
              <span key={t} className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
