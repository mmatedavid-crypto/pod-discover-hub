import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useNoindex } from "@/lib/useNoindex";
import Layout from "@/components/Layout";
import { Loader2, Send, Eye, ExternalLink, RefreshCcw } from "lucide-react";

const TEMP_ADMIN_USER_ID = "7b92654a-2b5d-438c-ad67-7ad5f6709483";

type SocialPost = {
  id: string;
  platform: string;
  status: string;
  content: string;
  ai_model: string | null;
  platform_post_url: string | null;
  error: string | null;
  trigger: string;
  created_at: string;
  metadata: any;
};

export default function AdminSocialPostsPage() {
  useNoindex("Social Posts — Podiverzum Admin");
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [posting, setPosting] = useState(false);
  const [msg, setMsg] = useState<string>("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) { nav("/auth"); return; }
      const { data: hasAdmin } = await (supabase as any).rpc("has_role", { _user_id: uid, _role: "admin" });
      const admin = hasAdmin === true || uid === TEMP_ADMIN_USER_ID;
      setIsAdmin(admin);
      setReady(true);
      if (admin) loadPosts();
    })();
  }, [nav]);

  const loadPosts = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("social_posts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    setPosts((data || []) as SocialPost[]);
    setLoading(false);
  };

  const runPreview = async () => {
    setMsg(""); setPreview(null); setPosting(true);
    const { data, error } = await supabase.functions.invoke("daily-social-post", {
      body: { dry_run: true, trigger: "manual_preview" },
    });
    setPosting(false);
    if (error) { setMsg(`Error: ${error.message}`); return; }
    setPreview(data);
  };

  const postNow = async () => {
    if (!confirm("Post to X right now?")) return;
    setMsg(""); setPosting(true);
    const { data, error } = await supabase.functions.invoke("daily-social-post", {
      body: { dry_run: false, trigger: "manual" },
    });
    setPosting(false);
    if (error) { setMsg(`Error: ${error.message}`); return; }
    setMsg(data?.ok ? `Posted! ${data.post_url || ""}` : `Failed: ${data?.error || "unknown"}`);
    setPreview(null);
    loadPosts();
  };

  if (!ready) return <Layout><div className="container mx-auto py-20 text-muted-foreground">Loading…</div></Layout>;
  if (!isAdmin) return <Layout><div className="container mx-auto py-20">Not authorized</div></Layout>;

  return (
    <Layout>
      <div className="container mx-auto py-8 space-y-6 max-w-4xl">
        <header>
          <h1 className="text-2xl sm:text-3xl font-semibold">Daily Social Posts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Auto-posts to X daily at 14:00 UTC (9 AM ET). Picks 2-3 fresh S/A-tier episodes from the last 24h.
          </p>
        </header>

        <section className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={runPreview}
              disabled={posting}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-secondary hover:bg-secondary/80 text-sm disabled:opacity-50"
            >
              {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
              Preview (dry run)
            </button>
            <button
              onClick={postNow}
              disabled={posting}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-brand text-brand-foreground hover:bg-brand/90 text-sm disabled:opacity-50"
            >
              {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Post now
            </button>
            <button
              onClick={loadPosts}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border text-sm"
            >
              <RefreshCcw className="h-4 w-4" /> Reload
            </button>
          </div>
          {msg && <div className="text-sm text-muted-foreground">{msg}</div>}
          {preview && (
            <div className="rounded-md border border-border bg-background p-3 space-y-2">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Preview · {preview.char_count} chars · {preview.model}
              </div>
              <pre className="whitespace-pre-wrap text-sm font-mono">{preview.generated_text}</pre>
              {preview.cover_image_url && (
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Attached image:</div>
                  <img
                    src={preview.cover_image_url}
                    alt="Tweet cover"
                    className="rounded border border-border max-h-48 object-cover"
                  />
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                Episodes used: {preview.episodes?.length || 0}
              </div>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm uppercase tracking-wider text-muted-foreground">Recent posts</h2>
          {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
          {!loading && posts.length === 0 && (
            <div className="text-sm text-muted-foreground">No posts yet.</div>
          )}
          <div className="space-y-2">
            {posts.map((p) => (
              <div key={p.id} className="rounded-md border border-border bg-card p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 rounded bg-secondary uppercase">{p.platform}</span>
                    <span className={`px-1.5 py-0.5 rounded ${
                      p.status === "success" ? "bg-green-500/15 text-green-600" :
                      p.status === "failed" ? "bg-destructive/15 text-destructive" :
                      "bg-secondary text-muted-foreground"
                    }`}>{p.status}</span>
                    <span className="text-muted-foreground">{p.trigger}</span>
                  </div>
                  <span className="text-muted-foreground">{new Date(p.created_at).toLocaleString()}</span>
                </div>
                {p.content && (
                  <pre className="whitespace-pre-wrap text-sm font-mono">{p.content}</pre>
                )}
                {p.error && (
                  <div className="text-xs text-destructive break-words">{p.error}</div>
                )}
                {p.platform_post_url && (
                  <a
                    href={p.platform_post_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-brand hover:underline"
                  >
                    View on X <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </Layout>
  );
}
