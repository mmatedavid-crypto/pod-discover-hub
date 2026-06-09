import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import Layout from "@/components/Layout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Sparkles, Heart, Bookmark, Bell, Settings, Trash2, Copy, ExternalLink, Wind, Loader2, Pencil, Check, X } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { setSeo } from "@/lib/seo";
import RecommendedForYou from "@/components/taste/RecommendedForYou";
import { imageSrcSet, optimizedImageUrl } from "@/lib/image";
import { categoryLabel } from "@/lib/categoryLabels";

const MOOD_OPTIONS = [
  "Reggel fókusz",
  "Munka közben",
  "Edzés alatt energikus",
  "Utazás közben",
  "Este lazítás",
  "Lefekvés előtt",
];

type EpRow = {
  id: string;
  title: string;
  display_title: string | null;
  slug: string;
  published_at: string | null;
  podcasts: { slug: string; title: string; display_title: string | null; image_url: string | null } | null;
};

type PodRow = {
  id: string;
  title: string;
  display_title: string | null;
  slug: string;
  image_url: string | null;
  category: string | null;
};

export default function EnPodiverzumomPage() {
  const { user, profile, loading: authLoading, signOut, refreshProfile } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "profil";

  useEffect(() => {
    setSeo({ title: "Az én Podiverzumom", noindex: true });
  }, []);

  useEffect(() => {
    if (!authLoading && !user) nav("/belepes?redirect=/en-podiverzumom", { replace: true });
  }, [authLoading, user, nav]);

  // Persist pending archetype from /te-podiverzumod after Google sign-in redirect
  useEffect(() => {
    if (!user) return;
    if (profile?.archetype_slug) {
      try { sessionStorage.removeItem("podiverzum_pending_archetype"); } catch { /* ignore */ }
      return;
    }
    let pending: { slug?: string; result?: any } | null = null;
    try {
      const raw = sessionStorage.getItem("podiverzum_pending_archetype");
      if (raw) pending = JSON.parse(raw);
    } catch { /* ignore */ }
    if (!pending?.slug) return;
    (async () => {
      const { error } = await supabase
        .from("profiles")
        .update({ archetype_slug: pending!.slug, archetype_result: pending!.result ?? null })
        .eq("user_id", user.id);
      if (!error) {
        try { sessionStorage.removeItem("podiverzum_pending_archetype"); } catch { /* ignore */ }
        try {
          const { trackLandingEvent } = await import("@/lib/landingEvents");
          trackLandingEvent("RegistrationCompleted");
        } catch { /* ignore */ }
        refreshProfile();
        toast.success("Podiverzumod elmentve");
      }
    })();
  }, [user, profile?.archetype_slug, refreshProfile]);

  if (authLoading || !user) {
    return (
      <Layout>
        <div className="container mx-auto py-20 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto max-w-4xl py-8 sm:py-12">
        <header className="flex items-center gap-4 mb-8">
          {profile?.avatar_url ? (
            <img
              src={optimizedImageUrl(profile.avatar_url, { width: 80, height: 80 }) || profile.avatar_url}
              srcSet={imageSrcSet(profile.avatar_url, [56, 80, 112])}
              sizes="56px"
              alt=""
              loading="eager"
              decoding="async"
              width={80}
              height={80}
              className="h-14 w-14 rounded-full object-cover ring-2 ring-primary/30"
            />
          ) : (
            <div className="h-14 w-14 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xl font-semibold ring-2 ring-primary/30">
              {(profile?.display_name || user.email || "?").charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Az én Podiverzumom</div>
            <EditableDisplayName
              userId={user.id}
              displayName={profile?.display_name || null}
              fallbackEmail={user.email || ""}
              onSaved={refreshProfile}
            />
            {(!profile?.display_name || profile?.username) && (
              <div className="text-sm text-muted-foreground mt-0.5 truncate">
                {!profile?.display_name && user.email}
                {profile?.username && <span className={!profile?.display_name ? "ml-2" : ""}>@{profile.username}</span>}
              </div>
            )}
          </div>
        </header>

        <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
          <TabsList className="flex flex-wrap h-auto justify-start gap-1 bg-transparent p-0 border-b border-border rounded-none">
            <TabTrigger value="profil" icon={Sparkles}>Profilom</TabTrigger>
            <TabTrigger value="kedvencek" icon={Heart}>Kedvencek</TabTrigger>
            <TabTrigger value="meghallgatando" icon={Bookmark}>Meghallgatandó</TabTrigger>
            <TabTrigger value="kovetett" icon={Bell}>Követett</TabTrigger>
            <TabTrigger value="hangulatok" icon={Wind}>Helyzetek</TabTrigger>
            <TabTrigger value="beallitasok" icon={Settings}>Beállítások</TabTrigger>
          </TabsList>

          <TabsContent value="profil" className="mt-6"><ProfilTab profile={profile} /></TabsContent>
          <TabsContent value="kedvencek" className="mt-6"><MarksList type="favorite" empty="Még nincs kedvenc epizódod. Hallgass körbe és tegyél ❤-ot, ami tetszett!" /></TabsContent>
          <TabsContent value="meghallgatando" className="mt-6"><MarksList type="listen_later" empty="Még nincs meghallgatandó epizódod. Jelölj 🔖-tal epizódokat amiket később hallgatnál." /></TabsContent>
          <TabsContent value="kovetett" className="mt-6"><FollowedPodcasts /></TabsContent>
          <TabsContent value="hangulatok" className="mt-6"><MoodsTab profile={profile} onChange={refreshProfile} /></TabsContent>
          <TabsContent value="beallitasok" className="mt-6"><SettingsTab profile={profile} onChange={refreshProfile} onSignOut={async () => { await signOut(); nav("/"); }} /></TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}

function TabTrigger({ value, icon: Icon, children }: { value: string; icon: any; children: React.ReactNode }) {
  return (
    <TabsTrigger
      value={value}
      className="px-3 py-2 text-sm rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:bg-transparent text-muted-foreground hover:text-foreground gap-1.5"
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </TabsTrigger>
  );
}

function ProfilTab({ profile }: { profile: any }) {
  const archetype = profile?.archetype_result;
  if (!archetype) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center">
        <h2 className="text-lg font-semibold">Még nincs Podiverzum-profilod</h2>
        <p className="text-sm text-muted-foreground mt-2">
          Csináld meg a kártya-felmérést és kiderítjük milyen hallgató vagy.
        </p>
        <Link
          to="/te-podiverzumod"
          className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
        >
          <Sparkles className="h-4 w-4" />
          Te Podiverzumod
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <RecommendedForYou />
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">A te archetípusod</div>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">{archetype.result_title || profile.archetype_slug}</h2>
        {archetype.result_subtitle && (
          <div className="text-sm text-muted-foreground mt-1">{archetype.result_subtitle}</div>
        )}
        {archetype.result_description && (
          <p className="mt-4 text-sm leading-relaxed">{archetype.result_description}</p>
        )}
        {Array.isArray(archetype.tags) && archetype.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4">
            {archetype.tags.map((t: string) => (
              <span key={t} className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">{t}</span>
            ))}
          </div>
        )}
        <Link
          to="/te-podiverzumod"
          className="mt-5 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          Újragondolnám →
        </Link>
      </div>
    </div>
  );
}

function MarksList({ type, empty }: { type: "favorite" | "listen_later"; empty: string }) {
  const { user } = useAuth();
  const [items, setItems] = useState<EpRow[] | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: marks } = await supabase
        .from("user_episode_marks")
        .select("episode_id, created_at")
        .eq("user_id", user.id)
        .eq("mark_type", type)
        .order("created_at", { ascending: false });
      const ids = (marks || []).map((m: any) => m.episode_id);
      if (ids.length === 0) { setItems([]); return; }
      const { data: eps } = await supabase
        .from("episodes")
        .select("id,title,display_title,slug,published_at,podcasts(slug,title,display_title,image_url)")
        .in("id", ids);
      // Re-sort by mark created_at
      const order = new Map(ids.map((id, i) => [id, i]));
      const sorted = (eps || []).sort((a: any, b: any) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
      setItems(sorted as any);
    })();
  }, [user, type]);

  if (items === null) return <div className="text-muted-foreground text-sm p-4"><Loader2 className="h-4 w-4 animate-spin inline" /></div>;
  if (items.length === 0) return <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">{empty}</div>;
  return (
    <ul className="divide-y divide-border/70 border border-border/70 rounded-xl bg-card/60 overflow-hidden">
      {items.map((e) => (
        <li key={e.id}>
          <Link to={`/podcast/${e.podcasts?.slug}/${e.slug}`} className="flex items-center gap-3 p-3 hover:bg-secondary/40 transition-colors">
            {e.podcasts?.image_url && (
              <img
                src={optimizedImageUrl(e.podcasts.image_url, { width: 64, height: 64 }) || e.podcasts.image_url}
                srcSet={imageSrcSet(e.podcasts.image_url, [48, 64, 96])}
                sizes="48px"
                alt=""
                loading="lazy"
                fetchPriority="low"
                decoding="async"
                width={64}
                height={64}
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
  );
}

function FollowedPodcasts() {
  const { user } = useAuth();
  const [items, setItems] = useState<PodRow[] | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: follows } = await supabase
        .from("user_podcast_follows")
        .select("podcast_id, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      const ids = (follows || []).map((f: any) => f.podcast_id);
      if (ids.length === 0) { setItems([]); return; }
      const { data: pods } = await supabase
        .from("podcasts")
        .select("id,title,display_title,slug,image_url,category")
        .in("id", ids);
      setItems((pods || []) as any);
    })();
  }, [user]);

  if (items === null) return <div className="text-muted-foreground text-sm p-4"><Loader2 className="h-4 w-4 animate-spin inline" /></div>;
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Bell className="h-4 w-4" />
        </div>
        <div className="font-medium text-foreground">Még nem követsz podcastot.</div>
        <p className="mt-1">
          Nyiss meg egy műsort, és kapcsold be a követést, hogy itt gyűljenek a kedvenceid.
        </p>
      </div>
    );
  }
  return (
    <ul className="grid sm:grid-cols-2 gap-3">
      {items.map((p) => {
        const displayCategory = categoryLabel(p.category);
        return (
          <li key={p.id}>
            <Link to={`/podcast/${p.slug}`} className="flex gap-3 p-3 rounded-xl border border-border bg-card hover:border-primary/40 transition-colors">
              {p.image_url && (
                <img
                  src={optimizedImageUrl(p.image_url, { width: 80, height: 80 }) || p.image_url}
                  srcSet={imageSrcSet(p.image_url, [56, 80, 112])}
                  sizes="56px"
                  alt=""
                  loading="lazy"
                  fetchPriority="low"
                  decoding="async"
                  width={80}
                  height={80}
                  className="h-14 w-14 rounded-md object-cover shrink-0"
                />
              )}
              <div className="min-w-0">
                <div className="text-sm font-medium line-clamp-1">{p.display_title || p.title}</div>
                {displayCategory && (
                  <div className="text-xs text-muted-foreground mt-0.5">{displayCategory}</div>
                )}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function MoodsTab({ profile, onChange }: { profile: any; onChange: () => void }) {
  const { user } = useAuth();
  const selected: string[] = profile?.mood_preferences || [];
  const toggle = async (m: string) => {
    if (!user) return;
    let next: string[];
    if (selected.includes(m)) next = selected.filter((x) => x !== m);
    else if (selected.length >= 3) { toast.info("Maximum 3 hangulat."); return; }
    else next = [...selected, m];
    await supabase.from("profiles").update({ mood_preferences: next }).eq("user_id", user.id);
    onChange();
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <h2 className="text-lg font-semibold">Hangulat-preferenciák</h2>
      <p className="text-sm text-muted-foreground mt-1">
        Válassz max. 3 hangulatot — ezek alapján emelünk ki neked ajánlókat a kezdőlapon.
      </p>
      <div className="flex flex-wrap gap-2 mt-5">
        {MOOD_OPTIONS.map((m) => {
          const on = selected.includes(m);
          return (
            <button
              key={m}
              onClick={() => toggle(m)}
              className={`px-3 py-1.5 rounded-full border text-sm transition-colors ${
                on
                  ? "border-primary/50 bg-primary/15 text-primary"
                  : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40"
              }`}
            >
              {m}
            </button>
          );
        })}
      </div>
      <div className="text-xs text-muted-foreground mt-4">{selected.length} / 3 kiválasztva</div>
    </div>
  );
}

function SettingsTab({
  profile, onChange, onSignOut,
}: { profile: any; onChange: () => void; onSignOut: () => void }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const [deleting, setDeleting] = useState(false);
  const publicUrl = useMemo(
    () => profile?.username ? `${window.location.origin}/p/${profile.username}` : null,
    [profile?.username]
  );

  const togglePublic = async (v: boolean) => {
    if (!user) return;
    await supabase.from("profiles").update({ is_public_profile: v }).eq("user_id", user.id);
    onChange();
  };
  const toggleEmail = async (v: boolean) => {
    if (!user) return;
    await supabase.from("profiles").update({ email_notifications_enabled: v }).eq("user_id", user.id);
    onChange();
  };

  const copyLink = () => {
    if (!publicUrl) return;
    navigator.clipboard.writeText(publicUrl).then(() => toast.success("Link másolva"));
  };

  const deleteAccount = async () => {
    if (!confirm("Biztosan törlöd a fiókodat? Minden adatod (profil, kedvencek, követések, történet) végleg törlődik.")) return;
    setDeleting(true);
    const { error } = await supabase.rpc("delete_my_account");
    if (error) {
      toast.error("Nem sikerült a törlés: " + error.message);
      setDeleting(false);
      return;
    }
    await supabase.auth.signOut();
    toast.success("Fiókod és minden adatod véglegesen törölve.");
    nav("/");
  };

  return (
    <div className="space-y-4">
      <SettingRow
        title="Publikus profil"
        desc={publicUrl ? `${publicUrl} — bárki megnézheti az archetípusod és a publikus kedvenceidet.` : "Engedélyezd hogy mások is láthassák a Podiverzumodat."}
        right={<Switch checked={!!profile?.is_public_profile} onCheckedChange={togglePublic} />}
      >
        {profile?.is_public_profile && publicUrl && (
          <div className="flex gap-2 mt-3">
            <button onClick={copyLink} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-card text-xs hover:border-primary/40">
              <Copy className="h-3 w-3" /> Link másolása
            </button>
            <a href={publicUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-card text-xs hover:border-primary/40">
              <ExternalLink className="h-3 w-3" /> Megnyitás
            </a>
          </div>
        )}
      </SettingRow>

      <SettingRow
        title="Email értesítések"
        desc="Heti összefoglaló az új epizódokról a követett podcastjaidnál."
        right={<Switch checked={!!profile?.email_notifications_enabled} onCheckedChange={toggleEmail} />}
      />

      <SettingRow
        title="Kijelentkezés"
        desc="A fiókod megmarad, csak ezen az eszközön lépsz ki."
        right={
          <button onClick={onSignOut} className="px-3 py-1.5 rounded-md border border-border bg-card text-sm hover:border-primary/40">
            Kijelentkezés
          </button>
        }
      />

      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
        <h3 className="text-sm font-semibold text-destructive">Fiók törlése</h3>
        <p className="text-xs text-muted-foreground mt-1">
          GDPR cikk 17 — minden adatod (profil, jelölések, követések, történet) véglegesen törlődik.
        </p>
        <button
          onClick={deleteAccount}
          disabled={deleting}
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-destructive/50 bg-destructive/10 text-destructive text-sm hover:bg-destructive/20 disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {deleting ? "Törlés…" : "Végleg törölöm a fiókomat"}
        </button>
      </div>
    </div>
  );
}

function SettingRow({
  title, desc, right, children,
}: { title: string; desc: string; right: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{title}</div>
          <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{desc}</div>
        </div>
        <div className="shrink-0">{right}</div>
      </div>
      {children}
    </div>
  );
}

function EditableDisplayName({
  userId, displayName, fallbackEmail, onSaved,
}: {
  userId: string;
  displayName: string | null;
  fallbackEmail: string;
  onSaved: () => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(displayName || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(displayName || "");
  }, [displayName]);

  const start = () => {
    setValue(displayName || "");
    setEditing(true);
  };

  const cancel = () => {
    setValue(displayName || "");
    setEditing(false);
  };

  const save = async () => {
    const trimmed = value.trim().slice(0, 80);
    if (trimmed === (displayName || "")) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .upsert({ user_id: userId, display_name: trimmed || null }, { onConflict: "user_id" });
    setSaving(false);
    if (error) {
      toast.error("Nem sikerült menteni a nevet.");
      return;
    }
    toast.success("Név frissítve.");
    setEditing(false);
    await onSaved();
  };

  if (editing) {
    return (
      <div className="mt-0.5 flex items-center gap-2">
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") cancel();
          }}
          maxLength={80}
          placeholder="Pl. Anna"
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-2xl sm:text-3xl font-semibold tracking-tight outline-none focus:border-primary"
        />
        <button
          type="button"
          onClick={save}
          disabled={saving}
          aria-label="Mentés"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-primary/40 bg-primary/10 text-primary hover:bg-primary/15 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={saving}
          aria-label="Mégse"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  const shown = displayName || fallbackEmail;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight truncate">
        {shown}
      </h1>
      <button
        type="button"
        onClick={start}
        aria-label="Név szerkesztése"
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
        title={displayName ? "Név szerkesztése" : "Adj meg egy nevet"}
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
