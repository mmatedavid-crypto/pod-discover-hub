import Layout from "@/components/Layout";
import { Link } from "react-router-dom";
import { useEffect } from "react";
import { setSeo } from "@/lib/seo";

export default function NotFoundState({ title = "Nincs ilyen oldal", message = "A keresett oldal nem létezik." }: { title?: string; message?: string }) {
  useEffect(() => {
    setSeo({ title: `${title} — Podiverzum`, description: message, noindex: true });
  }, [title, message]);
  return (
    <Layout>
      <div className="container mx-auto py-20 max-w-lg text-center">
        <h1 className="text-3xl font-semibold">{title}</h1>
        <p className="text-muted-foreground mt-2">{message}</p>
        <Link to="/" className="inline-block mt-6 text-accent">← Vissza a kezdőlapra</Link>
      </div>
    </Layout>
  );
}