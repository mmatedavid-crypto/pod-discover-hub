// Public shared "Hallgatói profil" oldal. A friend nyitja meg a linket → ezt
// látja először (above the fold a barátja receipt-je), majd egy erős CTA-t
// hogy ő is megcsinálja a sajátját.
//
// Route: /hallgatoi-profil/:shareId
// Noindex (egyedi share oldalak nem mennek a Google indexébe).

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ListenerReceipt } from "@/components/receipt/ListenerReceipt";
import { ShareRecommendedEpisodes } from "@/components/share/ShareRecommendedEpisodes";
import {
  LISTENER_PROFILES,
  profileById,
  profileForArchetypeId,
  buildReceiptNumber,
  type ListenerProfile,
} from "@/lib/listenerProfiles";
import { trackProfileEvent } from "@/lib/profileEvents";

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
const SHARE_FN_URL = `${SUPABASE_URL}/functions/v1/te-podiverzumod-share`;
const SITE = "https://podiverzum.hu";
const LOAD_TIMEOUT_MS = 8000;

function resolveProfile(share: PublicShare | null): ListenerProfile {
  if (!share) return LISTENER_PROFILES[0];
  // Új flow: result_type a listener profile id.
  const direct = profileById(share.result_type);
  if (direct) return direct;
  // Régi flow: result_type a régi archetype id — mappingelünk.
  return profileForArchetypeId(share.result_type);
}

export default function ListenerProfilePage() {
  const { shareId } = useParams<{ shareId: string }>();
  const [share, setShare] = useState<PublicShare | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!shareId) return;
    let cancelled = false;
    const controller = new AbortController();
    const tid = window.setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS);
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${SHARE_FN_URL}?id=${encodeURIComponent(shareId)}`, {
          signal: controller.signal,
        });
        if (cancelled) return;
        if (res.status === 404) {
          setError("Ez a megosztott profil már nem elérhető.");
        } else if (!res.ok) {
          setError("Nem sikerült betölteni a profilt.");
        } else {
          const data = (await res.json()) as PublicShare;
          setShare(data);
        }
      } catch {
        if (!cancelled) setError("Nem sikerült betölteni. Próbáld újra.");
      } finally {
        window.clearTimeout(tid);
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(tid);
    };
  }, [shareId]);

  const profile = useMemo(() => resolveProfile(share), [share]);
  const receiptNumber = useMemo(
    () => buildReceiptNumber(shareId || "pv", share ? new Date(share.created_at) : new Date()),
    [shareId, share],
  );

  // Analytics
  const viewedRef = useRef(false);
  useEffect(() => {
    if (!share || viewedRef.current) return;
    viewedRef.current = true;
    trackProfileEvent("shared_profile_viewed", {
      share_id: share.share_id,
      archetype_id: profile.id,
    });
  }, [share, profile.id]);

  const pageUrl = `${SITE}/hallgatoi-profil/${shareId ?? ""}`;
  const ogTitle = share
    ? `${profile.name} lett a Podiverzumon`
    : "A Te Podiverzumod — milyen hallgató vagy?";
  const ogDesc =
    "Pár döntésből kiderül, milyen podcast-hallgató vagy. Neked mi jön ki?";
  const ogImageParams = new URLSearchParams({
    kind: "share",
    title: profile.name,
    subtitle: `A TE PODIVERZUMOD · ${profile.recommendedDirection}`,
  });
  const ogImage = `${SUPABASE_URL}/functions/v1/og-image?${ogImageParams.toString()}`;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Helmet>
        <title>{ogTitle} — Podiverzum</title>
        <meta name="description" content={ogDesc} />
        <meta name="robots" content="noindex,nofollow" />
        <link rel="canonical" href={pageUrl} />
        <meta property="og:type" content="article" />
        <meta property="og:url" content={pageUrl} />
        <meta property="og:title" content={ogTitle} />
        <meta property="og:description" content={ogDesc} />
        <meta property="og:image" content={ogImage} />
        <meta property="og:site_name" content="Podiverzum" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={ogTitle} />
        <meta name="twitter:description" content={ogDesc} />
        <meta name="twitter:image" content={ogImage} />
      </Helmet>

      <div className="mx-auto max-w-md px-4 pt-6 pb-20 md:pt-10">
        <header className="mb-6 flex items-center justify-between">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
            ← Podiverzum
          </Link>
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" /> Hallgatói profil
          </div>
        </header>

        {loading && (
          <div className="space-y-4" role="status" aria-live="polite">
            <Skeleton className="mx-auto h-[520px] w-[360px] max-w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-2xl" />
          </div>
        )}

        {!loading && error && (
          <div className="rounded-3xl border border-border bg-card p-8 text-center">
            <p className="text-muted-foreground">{error}</p>
            <Button asChild className="mt-6">
              <Link
                to="/te-podiverzumod"
                onClick={() =>
                  trackProfileEvent("shared_profile_cta_clicked", {
                    share_id: shareId ?? null,
                    archetype_id: null,
                  })
                }
              >
                Csináld meg te is <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        )}

        {!loading && share && (
          <>
            <div className="flex justify-center">
              <ListenerReceipt
                profile={profile}
                receiptNumber={receiptNumber}
                date={share.created_at}
                seed={share.share_id}
              />
            </div>

            <ShareRecommendedEpisodes
              tags={share.tags}
              shareId={share.share_id}
              autoplayTop
            />

            <div className="mt-10 rounded-3xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card p-6 text-center md:p-8">
              <div className="text-[10px] uppercase tracking-[0.25em] text-primary">
                Te is
              </div>
              <h1 className="mt-2 text-2xl font-semibold md:text-3xl">
                Neked mi jön ki?
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Készítsd el a saját hallgatói profilod. Pár perc, pár swipe.
              </p>
              <Button asChild size="lg" className="mt-5 w-full md:w-auto">
                <Link
                  to={`/te-podiverzumod?ref=${encodeURIComponent(share.share_id)}`}
                  onClick={() =>
                    trackProfileEvent("shared_profile_cta_clicked", {
                      share_id: share.share_id,
                      archetype_id: profile.id,
                    })
                  }
                >
                  Indítom <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
