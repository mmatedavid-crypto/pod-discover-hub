import { useEffect } from "react";
import { Link } from "react-router-dom";
import Layout from "@/components/Layout";
import { setSeo } from "@/lib/seo";

const CANONICAL = "https://podiverzum.hu/mr6";
const SOURCE_URL =
  "https://www.worldsbk.com/en/news/2022/05/27/der-zweifache-worldsbk-champion-max-biaggi-wird-zur-motogp-legende/971652";
const YT_ID = "gpLI-NSGK3Y";
const APPLE_URL =
  "https://podcasts.apple.com/it/podcast/live-io-ricordo-max-biaggi-io-e-rossi-siamo-stati-due-cretini/id1498123517?i=1000608603732";
const APPLE_EMBED = "https://embed.podcasts.apple.com/it/episode/1000608603732";

// Catalog search (title + RSS description) found a single Hungarian episode naming Biaggi; it is a short segment, not an episode about him.
const HU_MENTIONS = [
  {
    href: "/podcast/orak-kerdese/az-iwc-az-uj-hublot-orak-a-foci-vb-edzoinek-csukloirol-ok025-19565478",
    title: "Az IWC az új Hublot??? Órák a foci vb edzőinek csuklóiról | OK025",
    show: "Órák Kérdése",
    date: "2026. július 28.",
    dateIso: "2026-07-28",
    note: "Nem Biaggiról szóló adás: a műsorleírás szerint 01:30:30-tól egy rövid „CelebCsuklóCsekk” szakasz Max Biaggi órájáról (Casio DW-5600) szól.",
  },
];

export default function Mr6Page() {
  useEffect(() => {
    setSeo({
      title: "Mr. Six – Max Biaggi",
      description:
        "A Podiverzum podcastválogatása Max Biaggiról: négy 250 cm³-es vb-cím (1994–1997), két Superbike-vb-cím (2010, 2012), eredeti interjúk.",
      canonical: CANONICAL,
    });
  }, []);

  return (
    <Layout>
      <div className="container mx-auto max-w-3xl py-10">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Podiverzum-válogatás</p>
        <h1 className="mt-1 text-3xl font-semibold">Mr. Six – Max Biaggi</h1>
        <p className="mt-4 leading-relaxed text-muted-foreground">
          A „Mr. Six” a Podiverzum saját címe ehhez a rajongói, szerkesztőségi válogatáshoz. A „Six” (hat) Max Biaggi
          hat világbajnoki címére utal: 1994 és 1997 között négy egymást követő 250 cm³-es vb-címet nyert, majd 2010-ben
          és 2012-ben a Superbike-világbajnokságot is megnyerte.{" "}
          <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">
            Forrás: WorldSBK
          </a>
          . Az oldal nem áll kapcsolatban Max Biaggival, a MotoGP-vel vagy a podcastok kiadóival.
        </p>

        <section className="mt-10">
          <h2 className="text-xl font-semibold">Eredeti interjú angolul</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Max Biaggi: Normal Childhood to National Icon – The Official MotoGP Podcast · kiadó:{" "}
            <a href={`https://www.youtube.com/watch?v=${YT_ID}`} target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">
              MotoGP (YouTube)
            </a>
          </p>
          <div className="mt-3 aspect-video overflow-hidden rounded-lg border border-border bg-card">
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${YT_ID}`}
              title="Max Biaggi: Normal Childhood to National Icon | The Official MotoGP Podcast"
              className="h-full w-full"
              loading="lazy"
              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-xl font-semibold">Eredeti interjú olaszul</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            LIVE, IO RICORDO: Max Biaggi, io e Rossi? siamo stati due cretini · GPOne.com Podcast ·{" "}
            <a href={APPLE_URL} target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">
              Apple Podcasts
            </a>
          </p>
          <iframe
            src={APPLE_EMBED}
            title="LIVE, IO RICORDO: Max Biaggi, io e Rossi? siamo stati due cretini"
            className="mt-3 h-[175px] w-full overflow-hidden rounded-lg border border-border bg-card"
            loading="lazy"
            allow="autoplay *; encrypted-media *; clipboard-write"
            sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-top-navigation-by-user-activation"
          />
        </section>

        <section className="mt-10">
          <h2 className="text-xl font-semibold">A magyar Podiverzum-katalógusban</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Magyar adás, amely kifejezetten Max Biaggiról szólna, jelenleg nincs a katalógusban. Egy műsorleírás említi a nevét:
          </p>
          <ul className="mt-3 space-y-3">
            {HU_MENTIONS.map((it) => (
              <li key={it.href}>
                <Link to={it.href} className="group block rounded-lg border border-border/70 bg-card/80 p-3 transition-colors hover:border-primary/50 sm:p-4">
                  <h3 className="font-semibold leading-snug group-hover:underline">{it.title}</h3>
                  <div className="mt-1 text-xs text-muted-foreground">
                    <span>{it.show}</span>
                    <span className="mx-1.5 opacity-60">·</span>
                    <time dateTime={it.dateIso}>{it.date}</time>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{it.note}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Layout>
  );
}
