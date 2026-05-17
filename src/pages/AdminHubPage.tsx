import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useNoindex } from "@/lib/useNoindex";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import {
  Activity,
  Database,
  Globe,
  Inbox,
  LineChart,
  ListChecks,
  LogOut,
  MessageSquare,
  Search as SearchIcon,
  Settings,
  Shield,
  Sparkles,
  Radio,
  Send,
  Users,
} from "lucide-react";

const TEMP_ADMIN_USER_ID = "7b92654a-2b5d-438c-ad67-7ad5f6709483";

type Counts = {
  podcasts?: number;
  episodes?: number;
  feedbackUnhandled?: number;
  searchToday?: number;
  zeroResultToday?: number;
  queuePending?: number;
};

type Tool = {
  to: string;
  title: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string | number | null;
  badgeTone?: "default" | "warn" | "danger";
};

export default function AdminHubPage() {
  useNoindex("Admin Hub — Podiverzum");
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [fallback, setFallback] = useState(false);
  const [counts, setCounts] = useState<Counts>({});

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) { nav("/auth"); return; }
      setUserId(uid);
      const { data: hasAdmin } = await (supabase as any).rpc("has_role", { _user_id: uid, _role: "admin" });
      const fb = hasAdmin !== true && uid === TEMP_ADMIN_USER_ID;
      const admin = hasAdmin === true || fb;
      setFallback(fb);
      setIsAdmin(admin);
      setReady(true);
      if (admin) loadCounts();
    })();
  }, [nav]);

  const loadCounts = async () => {
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const sinceDay = startOfDay.toISOString();
    const [pods, eps, fb, search, zero, queue] = await Promise.all([
      supabase.from("podcasts").select("*", { count: "exact", head: true }),
      supabase.from("episodes").select("*", { count: "estimated", head: true }),
      supabase.from("beta_feedback").select("*", { count: "exact", head: true }).eq("handled", false),
      supabase.from("search_events").select("*", { count: "exact", head: true }).gte("created_at", sinceDay),
      supabase.from("search_events").select("*", { count: "exact", head: true }).gte("created_at", sinceDay).eq("result_count", 0),
      supabase.from("discovery_queue").select("*", { count: "exact", head: true }).eq("status", "pending"),
    ]);
    setCounts({
      podcasts: pods.count ?? 0,
      episodes: eps.count ?? 0,
      feedbackUnhandled: fb.count ?? 0,
      searchToday: search.count ?? 0,
      zeroResultToday: zero.count ?? 0,
      queuePending: queue.count ?? 0,
    });
  };

  const signOut = async () => { await supabase.auth.signOut(); nav("/"); };

  if (!ready) return <Layout><div className="container mx-auto py-20 text-muted-foreground">Loading…</div></Layout>;
  if (!isAdmin) return (
    <Layout>
      <div className="container mx-auto py-20 max-w-md">
        <h1 className="text-2xl font-semibold">Not authorized</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Signed in as <code>{userId}</code> but no admin role.
        </p>
        <button onClick={signOut} className="mt-4 text-sm text-accent">Sign out</button>
      </div>
    </Layout>
  );

  const sections: { title: string; tools: Tool[] }[] = [
    {
      title: "Growth & Indexing",
      tools: [
        { to: "/admin/autopilot", title: "Growth Autopilot", desc: "Cloud-driven podcast growth. Start/pause from your phone.", icon: Activity, badge: "new", badgeTone: "warn" },
        { to: "/admin/growth", title: "Autonomous Growth", desc: "Daily growth runs, AI controls, schedules.", icon: Sparkles },
        { to: "/admin/queue", title: "Approval Queue", desc: "Review and approve discovered podcasts.", icon: ListChecks, badge: counts.queuePending, badgeTone: counts.queuePending ? "warn" : "default" },
        { to: "/admin/discovery", title: "Discovery", desc: "Find new podcasts and replacement feeds.", icon: SearchIcon },
        { to: "/admin/podcasts", title: "Podcasts & RSS", desc: "Manage podcasts, bulk refresh, deep hydration.", icon: Database, badge: counts.podcasts },
        { to: "/growth-status", title: "Growth Status", desc: "Public status of recent growth runs.", icon: Activity },
        { to: "/admin/ai-enrichment", title: "AI Enrichment", desc: "SEO meta + ai_summary. Budget, scope, pause/resume.", icon: Sparkles },
      ],
    },
    {
      title: "Analytics",
      tools: [
        { to: "/admin/live", title: "Live Visitors", desc: "Active visitors right now + today's totals.", icon: Activity, badge: "live", badgeTone: "warn" },
        { to: "/admin/analytics", title: "Page Analytics", desc: "Page views, routes, referrers, UTM.", icon: LineChart },
        { to: "/admin/search-insights", title: "Search Insights", desc: "Top queries, zero-results, fallback usage.", icon: SearchIcon, badge: counts.zeroResultToday ? `${counts.zeroResultToday} zero today` : counts.searchToday ? `${counts.searchToday} today` : null, badgeTone: counts.zeroResultToday ? "warn" : "default" },
      ],
    },
    {
      title: "Marketing",
      tools: [
        { to: "/admin/social", title: "Daily Social Posts", desc: "Auto-generated X posts about today's fresh episodes. Preview, post now, history.", icon: Send, badge: "new", badgeTone: "warn" },
      ],
    },
    {
      title: "Feedback",
      tools: [
        { to: "/admin/feedback", title: "Beta Feedback", desc: "User-submitted feedback and reports.", icon: MessageSquare, badge: counts.feedbackUnhandled, badgeTone: counts.feedbackUnhandled ? "danger" : "default" },
      ],
    },
    {
      title: "Quality & Safety",
      tools: [
        { to: "/admin/language-gate", title: "Language Gate", desc: "Foreign podcast audit, review queue, cleanup.", icon: Shield, badge: "new", badgeTone: "warn" },
        { to: "/admin/vector-search", title: "Vector Search & Moods", desc: "Mood diagnostics, recommendation test, personalized card preview.", icon: Sparkles, badge: "new", badgeTone: "warn" },
        { to: "/admin/hosts", title: "Hosts", desc: "Host management and verification.", icon: Users },
      ],
    },
    {
      title: "System",
      tools: [
        { to: "/admin/cron-status", title: "Cron Status", desc: "Active jobs, recent runs, durations, failures.", icon: Activity },
        { to: "/admin/pi-backfill", title: "PI Backfill", desc: "Podcast Index bulk backfill controls.", icon: Globe },
        { to: "/admin/archive-backfill", title: "HU Archive Backfill", desc: "Deep HU archive ingestion: RSS exhaustion + PI sweep, budget-aware.", icon: Database, badge: "new", badgeTone: "warn" },
        { to: "/admin-bootstrap", title: "Admin Bootstrap", desc: "Temporary admin grant utility.", icon: Settings },
      ],
    },
  ];

  return (
    <Layout>
      <div className="container mx-auto py-8 sm:py-10 space-y-8 max-w-6xl">
        <header className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-md bg-brand/15 text-brand flex items-center justify-center">
              <Radio className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-semibold">Admin Hub</h1>
              <p className="text-xs text-muted-foreground">Central control for Podiverzum.</p>
            </div>
          </div>
          <button
            onClick={signOut}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-card hover:bg-secondary text-sm"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </header>

        {fallback && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Temporary admin fallback active.
          </div>
        )}

        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
          <Stat label="Podcasts" value={counts.podcasts} />
          <Stat label="Episodes" value={counts.episodes} />
          <Stat label="Queue pending" value={counts.queuePending} tone={counts.queuePending ? "warn" : "default"} />
          <Stat label="Feedback open" value={counts.feedbackUnhandled} tone={counts.feedbackUnhandled ? "danger" : "default"} />
          <Stat label="Searches today" value={counts.searchToday} />
          <Stat label="Zero results" value={counts.zeroResultToday} tone={counts.zeroResultToday ? "warn" : "default"} />
        </section>

        {sections.map((s) => (
          <section key={s.title} className="space-y-3">
            <h2 className="text-sm uppercase tracking-wider text-muted-foreground">{s.title}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {s.tools.map((t) => <ToolCard key={t.to} tool={t} />)}
            </div>
          </section>
        ))}
      </div>
    </Layout>
  );
}

function Stat({ label, value, tone = "default" }: { label: string; value?: number; tone?: "default" | "warn" | "danger" }) {
  const toneClass = tone === "danger" ? "text-destructive" : tone === "warn" ? "text-brand" : "text-foreground";
  return (
    <div className="p-3 rounded-lg border border-border bg-card">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold mt-1 ${toneClass}`}>{value ?? "—"}</div>
    </div>
  );
}

function ToolCard({ tool }: { tool: Tool }) {
  const Icon = tool.icon;
  const showBadge = tool.badge !== null && tool.badge !== undefined && tool.badge !== 0 && tool.badge !== "";
  const badgeClass =
    tool.badgeTone === "danger" ? "bg-destructive/15 text-destructive border-destructive/30"
    : tool.badgeTone === "warn" ? "bg-brand/15 text-brand border-brand/30"
    : "bg-secondary text-secondary-foreground border-border";
  return (
    <Link
      to={tool.to}
      className="group p-4 rounded-lg border border-border bg-card hover:border-brand/50 hover:bg-card/80 transition-colors flex flex-col gap-2"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="h-9 w-9 rounded-md bg-secondary text-foreground/80 group-hover:text-brand flex items-center justify-center transition-colors">
          <Icon className="h-4 w-4" />
        </div>
        {showBadge && (
          <span className={`text-[11px] px-2 py-0.5 rounded-full border ${badgeClass}`}>
            {tool.badge}
          </span>
        )}
      </div>
      <div className="font-semibold leading-tight">{tool.title}</div>
      <p className="text-xs text-muted-foreground leading-relaxed">{tool.desc}</p>
    </Link>
  );
}
