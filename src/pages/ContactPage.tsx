import Layout from "@/components/Layout";
import { useEffect } from "react";
import { setSeo } from "@/lib/seo";
import { Mail } from "lucide-react";

const EMAIL = "hello@podiverzum.hu";

function MailItem({ subject, label, description }: { subject: string; label: string; description: string }) {
  const href = `mailto:${EMAIL}?subject=${encodeURIComponent(subject)}`;
  return (
    <div className="rounded-xl border border-border/70 bg-card/60 p-4 sm:p-5">
      <h2 className="font-semibold">{label}</h2>
      <p className="text-sm text-muted-foreground mt-1">{description}</p>
      <a href={href} className="inline-flex items-center gap-1.5 mt-3 text-sm text-primary hover:underline">
        <Mail className="h-3.5 w-3.5" /> {EMAIL}
      </a>
    </div>
  );
}

export default function ContactPage() {
  useEffect(() => {
    setSeo({
      title: "Kapcsolat — Podiverzum",
      description:
        "Írj a Podiverzum csapatának: hallgatói visszajelzés, podcast-kiadói kérés vagy üzleti megkeresés.",
    });
  }, []);

  return (
    <Layout>
      <article className="container mx-auto py-12 max-w-2xl">
        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">Kapcsolat</div>
        <h1 className="text-3xl font-semibold mb-2">Írj nekünk</h1>
        <p className="text-muted-foreground">
          Visszajelzéssel, kiadói kéréssel vagy üzleti megkereséssel itt érsz el minket:{" "}
          <a href={`mailto:${EMAIL}`} className="text-primary hover:underline">{EMAIL}</a>.
        </p>

        <div className="mt-8 grid gap-3 sm:gap-4">
          <MailItem
            label="Hallgatói visszajelzés"
            description="Keresési hibák, hiányzó műsorok, törött linkek vagy általános termékvisszajelzés."
            subject="Podiverzum visszajelzés"
          />
          <MailItem
            label="Podcastkészítők és kiadók"
            description="Metaadat-javítás, feed-frissítés, eltávolítási kérés vagy tulajdonosi kérdés."
            subject="Podcast tulajdonosi kérés"
          />
          <MailItem
            label="Üzleti és sajtó"
            description="Együttműködés, médiamegkeresés vagy egyéb kérés."
            subject="Üzleti megkeresés"
          />
        </div>
      </article>
    </Layout>
  );
}
