import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import Layout from "@/components/Layout";
import { setSeo } from "@/lib/seo";

export default function NotFound() {
  const location = useLocation();

  useEffect(() => {
    setSeo({
      title: "Page not found — Podiverzum",
      description: "The page you're looking for doesn't exist on Podiverzum.",
      noindex: true,
    });
    console.warn("404:", location.pathname);
  }, [location.pathname]);

  return (
    <Layout>
      <div className="container mx-auto py-20 max-w-md text-center">
        <h1 className="text-5xl font-semibold mb-3">404</h1>
        <p className="text-muted-foreground mb-6">
          We can't find that page. It may have moved or never existed.
        </p>
        <div className="flex flex-wrap gap-3 justify-center text-sm">
          <Link to="/" className="px-4 py-2 rounded-md bg-primary text-primary-foreground">Go home</Link>
          <Link to="/categories" className="px-4 py-2 rounded-md border border-border hover:border-foreground/40">Browse categories</Link>
          <Link to="/search" className="px-4 py-2 rounded-md border border-border hover:border-foreground/40">Search episodes</Link>
        </div>
      </div>
    </Layout>
  );
}
