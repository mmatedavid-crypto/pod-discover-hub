import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Layout from "@/components/Layout";
import { setSeo } from "@/lib/seo";
import { supabase } from "@/integrations/supabase/client";
import { Sparkles, ArrowRight } from "lucide-react";

export default function HuStubPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setSeo({
      title: "Podiverzum magyar — hamarosan",
      description: "A Podiverzum hamarosan magyar podcastokkal is. Iratkozz fel, hogy elsőként értesülj.",
    });
    // hreflang for the HU page
    upsertHreflang("hu-HU", `${window.location.origin}/hu`);
    upsertHreflang("en", `${window.location.origin}/`);
    upsertHreflang("x-default", `${window.location.origin}/`);
    document.documentElement.setAttribute("lang", "hu");
    return () => {
      document.documentElement.setAttribute("lang", "en");
    };
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    await supabase.from("beta_feedback").insert({
      email: email.trim().slice(0, 200),
      message: "[HU waitlist signup]",
      page_url: window.location.href,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      user_agent: navigator.userAgent.slice(0, 300),
    });
    setSubmitting(false);
    setSubmitted(true);
  };

  return (
    <Layout>
      <div className="container mx-auto py-20 max-w-2xl">
        <div className="rounded-2xl border border-border bg-card/70 p-8 sm:p-12">
          <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-primary mb-3">
            <Sparkles className="h-3 w-3" /> Magyar verzió
          </div>
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight">Hamarosan magyarul.</h1>
          <p className="text-muted-foreground mt-4 text-base sm:text-lg leading-relaxed">
            A Podiverzum jelenleg angol nyelvű podcastokkal indul.
            A magyar tartalom külön kurálással érkezik, hogy ugyanolyan
            minőségben kapd, mint az angolt.
          </p>

          {submitted ? (
            <div className="mt-8 p-4 rounded-lg border border-primary/30 bg-primary/10 text-sm">
              Köszi! Szólunk, amint élesedik a magyar verzió.
            </div>
          ) : (
            <form onSubmit={onSubmit} className="mt-8 flex flex-col sm:flex-row gap-3">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="te@email.hu"
                className="flex-1 px-4 py-3 rounded-lg bg-card border border-border focus:border-primary/60 outline-none"
              />
              <button
                disabled={submitting}
                className="btn-brand px-5 py-3 rounded-lg text-sm font-semibold inline-flex items-center justify-center gap-1 disabled:opacity-50"
              >
                {submitting ? "Küldés…" : "Értesítést kérek"} <ArrowRight className="h-4 w-4" />
              </button>
            </form>
          )}

          <div className="mt-10 text-sm text-muted-foreground">
            Addig is böngészd az angol katalógust:{" "}
            <Link to="/" className="text-foreground underline hover:no-underline">
              podiverzum.com
            </Link>
          </div>
        </div>
      </div>
    </Layout>
  );
}

function upsertHreflang(lang: string, href: string) {
  let el = document.head.querySelector(`link[rel="alternate"][hreflang="${lang}"]`) as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "alternate");
    el.setAttribute("hreflang", lang);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}
