import Layout from "@/components/Layout";
import { Link } from "react-router-dom";
import { useEffect } from "react";
import { setSeo } from "@/lib/seo";
import { sitePublisherJsonLd } from "@/lib/sitePublisher";
import { Newspaper, ExternalLink } from "lucide-react";

const PRESS_ITEMS = [
  {
    source: "MTI",
    sourceUrl: "https://mti.hu/nemzeti-kozlemenytar/2026/06/19/valasztas-utan-64-szazalekkal-kevesebb-haborus-epizod-temat",
    title: "A választás után 64 százalékkal kevesebb háborús epizód — témát váltottak a magyar podcastok",
    date: "2026. 06. 19.",
    quote:
      "A Podiverzum.hu friss elemzése szerint a 2026. április 12-i magyar országgyűlési választást követő 65 napban 64 százalékkal esett a háborúval foglalkozó epizódok aránya a magyar podcast-kínálatban, miközben a teljes epizódszám gyakorlatilag változatlan maradt.",
    type: "Hírközlemény",
  },
  {
    source: "M1 / MédiaKlikk",
    sourceUrl: "https://mediaklikk.hu/kozelet/video/2026/06/17/ma-delutan-2026-06-17-i-adas-1425",
    title: "Ma délután 2026.06.17-i adás, 14:25",
    date: "2026. 06. 17.",
    quote:
      "A Podiverzum podcastfigyelő az M1 Ma délután című műsorában szerepelt, ahol a magyar podcastpiac aktuális trendjeiről és a Podiverzum.hu adatalapú elemzéseiről esett szó.",
    type: "TV-szereplés",
  },
  {
    source: "PestCentrum",
    sourceUrl: "https://pestcentrum.hu/2026/06/15/tiz-ev-alatt-tobb-mint-30-szorosara-nott-a-magyar-podcastpiac/",
    title: "Tíz év alatt több mint 30-szorosára nőtt a magyar podcastpiac",
    date: "2026. 06. 15.",
    quote:
      "A magyar podcastpiac tíz év alatt több mint 30-szorosára nőtt — derül ki a Podiverzum.hu első átfogó piaci elemzéséből. Naponta átlagosan 73 új epizód jelenik meg, idén pedig várhatóan több mint 34 ezer új adás készül.",
    type: "Hír",
  },
  {
    source: "Manager Magazin",
    sourceUrl: "https://www.managermagazin.hu/harmincszoros-novekedes-rekordevet-hozhat-a-magyar-podcastpiac.htm",
    title: "Harmincszoros növekedés — rekordévet hozhat a magyar podcastpiac",
    date: "2026. 06. 15.",
    quote:
      "A Podiverzum.hu első átfogó piaci elemzése szerint a magyar podcastpiac tíz év alatt 30,2-szeresére bővült, és 2026 minden korábbi rekordot megdönthet.",
    type: "Hír",
  },
  {
    source: "hír6.hu",
    sourceUrl: "https://hir6.hu/cikk/182293/tiz_ev_alatt_tobb_mint_harmincszorosara_nott_a_magyar_podcastpiac",
    title: "Tíz év alatt több mint harmincszorosára nőtt a magyar podcastpiac",
    date: "2026. 06. 15.",
    quote:
      "A magyar podcastpiac több mint harmincszorosára nőtt az elmúlt évtizedben — derül ki a Podiverzum.hu első átfogó piaci elemzéséből. Naponta átlagosan 73 új epizód jelenik meg.",
    type: "Hír",
  },
  {
    source: "ma7.sk",
    sourceUrl: "https://ma7.sk/kavezo/tiz-ev-alatt-tobb-mint-30-szorosara-nott-a-magyar-podcastpiac",
    title: "Tíz év alatt több mint 30-szorosára nőtt a magyar podcastpiac",
    date: "2026. 06. 15.",
    quote:
      "A felvidéki magyar olvasóknak is bemutatja a ma7.sk a Podiverzum.hu első átfogó piaci elemzését: a magyar podcastpiac tíz év alatt több mint harmincszorosára nőtt.",
    type: "Hír",
  },
  {
    source: "GS+",
    sourceUrl: "https://www.gsplus.hu/hir/harmincszorosara-nott-a-magyar-podcastpiac-383688.html",
    title: "Harmincszorosára nőtt a magyar podcastpiac",
    date: "2026. 06. 15.",
    quote:
      "Néhány éve még rétegműfajnak számított, mára viszont a magyar digitális média egyik leggyorsabban növekvő területévé vált a podcast. A Podiverzum.hu friss, adatalapú elemzése szerint a hazai podcastpiac tíz év alatt 30,2-szeresére bővült, és ha az idei lendület kitart, 2026 minden korábbi rekordot megdönthet.",
    type: "Hír",
  },
  {
    source: "Profitline",
    sourceUrl: "https://profitline.hu/tiz-ev-alatt-tobb-mint-30-szorosara-nott-a-magyar-podcastpiac-487908",
    title: "Tíz év alatt több mint 30-szorosára nőtt a magyar podcastpiac",
    date: "2026. 06. 14.",
    quote:
      "Amit néhány évvel ezelőtt még kevesek hobbijának tartottak, mára a magyar digitális média egyik legdinamikusabban fejlődő területévé vált: a Podiverzum.hu friss elemzése szerint a magyar podcastpiac tíz év alatt 30,2-szeresére bővült, és az idei év minden korábbi rekordot megdönthet.",
    type: "Hír",
  },
  {
    source: "MTI",
    sourceUrl: "https://mti.hu/nemzeti-kozlemenytar/2026/06/14/tiz-ev-alatt-tobb-mint-30-szorosara-nott-magyar-podcastpiac",
    title: "Tíz év alatt több mint 30-szorosára nőtt a magyar podcastpiac",
    date: "2026. 06. 14.",
    quote:
      "A magyar podcastpiac több mint harmincszorosára nőtt az elmúlt évtizedben: míg 2015-ben mintegy ezer műsor volt elérhető, addig május végére már több mint 36 500 műsor kínálta a műfajra épülő tartalmakat.",
    type: "Hírközlemény",
  },
  {
    source: "Híradó",
    sourceUrl: "https://hirado.hu/belfold/cikk/2026/06/14/tiz-ev-alatt-tobb-mint-harmincszorosara-nott-a-magyar-podcastpiac",
    title: "Tíz év alatt több mint harmincszorosára nőtt a magyar podcastpiac",
    date: "2026. 06. 14.",
    quote:
      "A magyar podcastpiac tíz év alatt több mint 30-szorosára nőtt – derül ki a Podiverzum.hu első átfogó piaci elemzéséből. Naponta átlagosan 73 új epizód jelenik meg, idén pedig várhatóan több mint 34 ezer új adás készül.",
    type: "Hír",
  },
];

export default function PressPage() {
  useEffect(() => {
    setSeo({
      title: "Rólunk a sajtóban — Podiverzum",
      description:
        "A Podiverzumról írt cikkek, hírek és sajtómegjelenések.",
      canonical: "https://podiverzum.hu/sajto",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "Rólunk a sajtóban — Podiverzum",
        url: "https://podiverzum.hu/sajto",
        description:
          "A Podiverzumról írt cikkek, hírek és sajtómegjelenések.",
        publisher: sitePublisherJsonLd(),
        hasPart: PRESS_ITEMS.map((item) => ({
          "@type": "NewsArticle",
          headline: item.title,
          url: item.sourceUrl,
          datePublished: "2026-06-14",
          inLanguage: "hu-HU",
          author: {
            "@type": "Organization",
            name: item.source,
          },
        })),
      },
    });
  }, []);

  return (
    <Layout>
      <article className="container mx-auto py-12 max-w-2xl">
        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">
          Sajtó
        </div>
        <h1 className="text-3xl font-semibold mb-3">Rólunk a sajtóban</h1>
        <p className="text-muted-foreground max-w-xl">
          Cikkek, hírek és megjelenések, amelyekben a Podiverzumról írtak.
        </p>

        <div className="mt-10 space-y-6">
          {PRESS_ITEMS.map((item) => (
            <a
              key={item.sourceUrl}
              href={item.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-xl border border-border bg-card/40 p-6 sm:p-7 hover:bg-card/70 transition-colors group"
            >
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                <Newspaper className="h-3.5 w-3.5" />
                <span className="uppercase tracking-wider font-medium text-foreground/80">
                  {item.source}
                </span>
                <span>·</span>
                <span>{item.date}</span>
                <span>·</span>
                <span>{item.type}</span>
              </div>

              <h2 className="text-lg font-semibold leading-snug group-hover:text-primary transition-colors">
                {item.title}
              </h2>

              <blockquote className="mt-4 text-sm text-muted-foreground leading-relaxed border-l-2 border-primary/50 pl-4 italic">
                {item.quote}
              </blockquote>

              <div className="mt-5 inline-flex items-center gap-1.5 text-sm text-primary font-medium">
                Elolvasom
                <ExternalLink className="h-3.5 w-3.5" />
              </div>
            </a>
          ))}
        </div>

        <div className="mt-12 pt-8 border-t border-border/70">
          <p className="text-sm text-muted-foreground">
            Sajtókapcsolat: {" "}
            <a
              href="mailto:sajto@podiverzum.hu"
              className="text-primary hover:underline"
            >
              sajto@podiverzum.hu
            </a>
          </p>
          <div className="not-prose mt-6 flex flex-wrap gap-3">
            <Link
              to="/rolunk"
              className="px-4 py-2 rounded-md bg-secondary text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              Rólunk →
            </Link>
            <Link
              to="/"
              className="px-4 py-2 rounded-md bg-secondary text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              Főoldal →
            </Link>
          </div>
        </div>
      </article>
    </Layout>
  );
}
