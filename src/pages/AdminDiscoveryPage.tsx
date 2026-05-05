import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import Layout from "@/components/Layout";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const TEMP_ADMIN_USER_ID = "7b92654a-2b5d-438c-ad67-7ad5f6709483";

export default function AdminDiscoveryPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [query, setQuery] = useState(params.get("title") || "");
  const podcastId = params.get("podcast_id");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) { nav("/auth"); return; }
      const { data: hasAdmin } = await (supabase as any).rpc("has_role", { _user_id: uid, _role: "admin" });
      setIsAdmin(hasAdmin === true || uid === TEMP_ADMIN_USER_ID);
      setReady(true);
    })();
  }, [nav]);

  const applyManual = async (rss: string) => {
    if (!podcastId) return toast.error("No podcast selected");
    if (!rss) return;
    const { error } = await supabase.from("podcasts").update({
      rss_url: rss, rss_status: "not_checked", last_fetch_error: null,
    }).eq("id", podcastId);
    if (error) return toast.error(error.message);
    toast.success("RSS updated. Run Fetch from admin.");
    nav("/admin");
  };

  if (!ready) return <Layout><div className="container mx-auto py-20 text-muted-foreground">Loading…</div></Layout>;
  if (!isAdmin) return <Layout><div className="container mx-auto py-20">Not authorized.</div></Layout>;

  return (
    <Layout>
      <div className="container mx-auto py-10 max-w-2xl space-y-6">
        <div>
          <h1 className="text-3xl font-semibold">Discover RSS</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Find a working RSS feed for a podcast. Podcast Index API integration coming next — for now, search manually and paste a URL.
          </p>
        </div>

        <div className="p-4 rounded-lg border border-border bg-card space-y-3">
          <label className="block text-sm">
            <span className="text-xs text-muted-foreground">Podcast title</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-md border border-border bg-background"
              placeholder="Search query"
            />
          </label>
          <div className="flex flex-wrap gap-2 text-sm">
            <a className="px-3 py-1.5 rounded-md bg-secondary" target="_blank" rel="noopener noreferrer"
              href={`https://podcastindex.org/search?q=${encodeURIComponent(query)}&type=all`}>Search Podcast Index</a>
            <a className="px-3 py-1.5 rounded-md bg-secondary" target="_blank" rel="noopener noreferrer"
              href={`https://podcasts.apple.com/search?term=${encodeURIComponent(query)}`}>Search Apple Podcasts</a>
            <a className="px-3 py-1.5 rounded-md bg-secondary" target="_blank" rel="noopener noreferrer"
              href={`https://www.google.com/search?q=${encodeURIComponent(query + " rss feed")}`}>Google "rss feed"</a>
          </div>
        </div>

        {podcastId && (
          <div className="p-4 rounded-lg border border-border bg-card">
            <div className="text-sm font-medium">Replace RSS for this podcast</div>
            <p className="text-xs text-muted-foreground mt-1">Paste a working feed URL below.</p>
            <ManualReplace onApply={applyManual} />
          </div>
        )}

        <div className="text-xs text-muted-foreground">
          Pending: Podcast Index API integration (requires <code>PODCAST_INDEX_API_KEY</code> + <code>PODCAST_INDEX_API_SECRET</code>).
        </div>
      </div>
    </Layout>
  );
}

function ManualReplace({ onApply }: { onApply: (rss: string) => void }) {
  const [url, setUrl] = useState("");
  return (
    <div className="mt-2 flex gap-2">
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/feed.xml"
        className="flex-1 px-3 py-2 rounded-md border border-border bg-background text-sm" />
      <button onClick={() => onApply(url.trim())} className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm">Apply</button>
    </div>
  );
}
