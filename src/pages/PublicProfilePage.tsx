import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Layout from "@/components/Layout";
import { supabase } from "@/integrations/supabase/client";
import { Sparkles, Heart, ArrowRight } from "lucide-react";
import { setSeo } from "@/lib/seo";
import NotFoundState from "@/components/NotFoundState";
import { sanitizeHungarianPublicText } from "@/lib/publicTextLanguage";
import { imageSrcSet, optimizedImageUrl } from "@/lib/image";

type Profile = {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  username: string | null;
  archetype_slug: string | null;
  archetype_result: any;
  is_public_profile: boolean;
};

type EpRow = {
  id: string;
  title: string;
  display_title: string | null;
  slug: string;
  podcasts: { slug: string; title: string; display_title: string | null; image_url: string | null } | null;
};

function publicProfileText(value: unknown, minLength = 2): string {
  const clean = sanitizeHungarianPublicText(String(value || ""));
  return clean.length >= minLength ? clean : "";
}

function publicProfileTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return tags.map((tag) => publicProfileText(tag, 2)).filter(Boolean).slice(0, 8);
}

export default function PublicProfilePage() {
  const { username } = useParams<{ username: string }>();
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [favs, setFavs] = useState<EpRow[]>([]);

  useEffect(() => {
    if (!username) return;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("user_id,display_name,avatar_url,username,archetype_slug,archetype_result,is_public_profile")
        .eq("username", username)
        .eq("is_public_profile", true)
        .maybeSingle();
      if (!data) { setProfile(null); return; }
      setProfile(data as Profile);
      const seoDescription = publicProfileText((data.archetype_result as any)?.result_description, 20);
      setSeo({
        title: `${data.display_name || data.username} Podiverzuma`,
        description: seoDescription.slice(0, 160) || "Egy hallgató személyes podcast-profilja a Podiverzumon.",
      });
      const { data: marks } = await supabase
        .from("user_episode_marks")
        .select("episode_id, created_at")
        .eq("user_id", data.user_id)
        .eq("mark_type", "favorite")
        .order("created_at", { ascending: false })
        .limit(12);
      const ids = (marks || []).map((m: any) => m.episode_id);
      if (ids.length > 0) {
        const { data: eps } = await supabase
          .from("episodes")
          .select("id,title,display_title,slug,podcasts(slug,title,display_title,image_url)")
          .in("id", ids);
        const order = new Map(ids.map((id, i) => [id, i]));
        const sorted = (eps || []).sort((a: any, b: any) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
        setFavs(sorted as any);
      }
    })();
  }, [username]);

  if (profile === undefined) return <Layout><div className="container mx-auto py-20 text-center text-muted-foreground">Betöltés…</div></Layout>;
  if (profile === null) return <NotFoundState title="Ez a profil nem nyilvános" message="Lehet hogy nem létezik, vagy a tulajdonosa privátra állította." />;

  const archetype = profile.archetype_result;
  const archetypeTitle = publicProfileText(archetype?.result_title) || profile.archetype_slug || "Podiverzum-profil";
  const archetypeSubtitle = publicProfileText(archetype?.result_subtitle);
  const archetypeDescription = publicProfileText(archetype?.result_description, 20);
  const archetypeTags = publicProfileTags(archetype?.tags);

  return (
    <Layout>
      <div className="container mx-auto max-w-2xl py-10 sm:py-16">
        <div className="flex items-center gap-4">
          {profile.avatar_url ? (
            <img
              src={optimizedImageUrl(profile.avatar_url, { width: 96, height: 96 }) || profile.avatar_url}
              srcSet={imageSrcSet(profile.avatar_url, [64, 96, 128])}
              sizes="64px"
              alt=""
              loading="lazy"
              decoding="async"
              className="h-16 w-16 rounded-full object-cover ring-2 ring-primary/30"
            />
          ) : (
            <div className="h-16 w-16 rounded-full bg-primary/15 text-primary flex items-center justify-center text-2xl font-semibold ring-2 ring-primary/30">
              {(profile.display_name || profile.username || "?").charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Podiverzum-profil</div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">{profile.display_name || profile.username}</h1>
          </div>
        </div>

        {archetype && (
          <div className="mt-8 rounded-2xl border border-border bg-card p-6">
            <div className="inline-flex items-center gap-1.5 text-xs uppercase tracking-[0.2em] text-primary">
              <Sparkles className="h-3.5 w-3.5" /> Archetípus
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">{archetypeTitle}</h2>
            {archetypeSubtitle && <div className="text-sm text-muted-foreground mt-1">{archetypeSubtitle}</div>}
            {archetypeDescription && <p className="mt-4 text-sm leading-relaxed">{archetypeDescription}</p>}
            {archetypeTags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-4">
                {archetypeTags.map((t) => (
                  <span key={t} className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">{t}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {favs.length > 0 && (
          <section className="mt-8">
            <h3 className="text-lg font-semibold flex items-center gap-2"><Heart className="h-4 w-4 text-red-500" /> Kedvenc epizódok</h3>
            <ul className="mt-3 divide-y divide-border/70 border border-border/70 rounded-xl bg-card/60 overflow-hidden">
              {favs.map((e) => (
                <li key={e.id}>
                  <Link to={`/podcast/${e.podcasts?.slug}/${e.slug}`} className="flex items-center gap-3 p-3 hover:bg-secondary/40">
                    {e.podcasts?.image_url && (
                      <img
                        src={optimizedImageUrl(e.podcasts.image_url, { width: 64, height: 64 }) || e.podcasts.image_url}
                        srcSet={imageSrcSet(e.podcasts.image_url, [48, 64, 96])}
                        sizes="48px"
                        alt=""
                        loading="lazy"
                        fetchPriority="low"
                        decoding="async"
                        className="h-12 w-12 rounded-md object-cover shrink-0"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium line-clamp-1">{e.display_title || e.title}</div>
                      <div className="text-xs text-muted-foreground line-clamp-1">{e.podcasts?.display_title || e.podcasts?.title}</div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="mt-10 rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/8 via-card to-card p-6 text-center">
          <h3 className="text-xl font-semibold">Készítsd el a saját Podiverzumod</h3>
          <p className="text-sm text-muted-foreground mt-2">60 másodperc, és kiderül te milyen hallgató vagy.</p>
          <Link
            to="/start"
            className="mt-4 inline-flex items-center gap-2 px-5 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
          >
            <Sparkles className="h-4 w-4" />
            Indítás
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </Layout>
  );
}
