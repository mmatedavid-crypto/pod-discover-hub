import Layout from "@/components/Layout";
import { Link } from "react-router-dom";
import { useEffect } from "react";
import { setSeo } from "@/lib/seo";

export default function AboutPage() {
  useEffect(() => {
    setSeo({
      title: "Rólunk — Podiverzum, magyar podcastkereső",
      description:
        "A Podiverzum egy MI-alapú magyar podcastkereső. Több ezer podcastot dolgozunk fel, hogy könnyen megtaláld az epizódokat, amelyek igazán érdekelnek.",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: "Podiverzum",
        url: "https://podiverzum.hu",
        description:
          "MI-alapú magyar podcastkereső. Keress epizódokat témák, személyek, cégek vagy ötletek alapján.",
        sameAs: [],
      },
    });
  }, []);

  return (
    <Layout>
      <article className="container mx-auto py-12 max-w-2xl prose prose-invert prose-sm sm:prose-base">
        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">Rólunk</div>
        <h1 className="text-3xl font-semibold mb-2">Találd meg. Hallgasd meg.</h1>
        <p className="text-muted-foreground !mt-2">
          A Podiverzum egy MI-alapú kereső, amellyel a magyar podcastok világa kereshetővé,
          érthetővé és könnyen áttekinthetővé válik.
        </p>
        <p>
          Nem tárolunk hanganyagot. Nem helyettesítjük a podcastlejátszókat. Nyilvános podcastokat
          indexelünk, és segítünk megtalálni az epizódokat a tényleges tartalmuk alapján — személyekről,
          cégekről, piacokról, technológiákról, ötletekről, helyekről, egészségről,
          kulturális trendekről és sok másról.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Miért létezik a Podiverzum</h2>
        <p>
          A legtöbb podcastalkalmazás az általad már követett műsorok köré épül. Ez akkor jó,
          amikor pontosan tudod, mit akarsz hallgatni.
        </p>
        <p>Új podcastokat találni azonban még mindig nehézkes.</p>
        <p>
          Ha friss epizódokat keresnél a magyar gazdaságról, az MNB kamatdöntéséről, a Hold
          Alapkezelő elemzéseiről, a mesterséges intelligenciáról, az egészséges életmódról,
          a hazai politikáról vagy vállalkozói történetekről, általában cím szerint kell
          keresgélned, végig kell görgetned az egyes hírfolyamokat, vagy reménykedned kell, hogy
          a megfelelő epizód feltűnik valamelyik toplistán.
        </p>
        <p>Ezt a hiányt pótolja a Podiverzum.</p>
        <p>
          A podcasteket a webhez hasonlóan kezeljük: egy kereshető és rangsorolt indexet építünk
          epizódokból, műsorokból, témákból, személyekből, cégekből és ötletekből.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Mit csinálunk</h2>
        <ul className="list-disc pl-5">
          <li>Folyamatosan indexelünk több ezer nyilvános magyar podcastot.</li>
          <li>
            Mesterséges intelligencia segítségével feltárjuk, miről szólnak valójában a podcast epizódok —
            személyek, cégek, részvények, technológiák, helyek, témák és gondolatok mentén.
          </li>
          <li>
            A podcastokat és epizódokat frissesség, relevancia, minőség és a forrás
            megbízhatósága alapján rangsoroljuk.
          </li>
          <li>
            Különféle nézetekkel segítjük a felfedezést: felkapott epizódok, időtálló
            hallgatási ajánlók, kategóriák és tematikus oldalak.
          </li>
          <li>
            A hallgatókat visszairányítjuk az eredeti kiadóhoz — az Apple Podcasts, a Spotify,
            a YouTube vagy a műsor saját oldala felé.
          </li>
        </ul>

        <h2 className="mt-10 text-xl font-semibold">Mit nem csinálunk</h2>
        <ul className="list-disc pl-5">
          <li>Nem tárolunk és nem streamelünk hangfájlokat. A hang az alkotóké és a kiadóké.</li>
          <li>
            Nem adjuk el a személyes adataidat. Részletek:{" "}
            <Link to="/adatvedelem" className="text-primary hover:underline">Adatvédelem</Link>.
          </li>
          <li>
            Nem árulunk megjelenést. A rangsorolás algoritmikus és minőségelvű, célja,
            hogy a leghasznosabb találatok kerüljenek előre. Részletek:{" "}
            <Link to="/modszertan" className="text-primary hover:underline">Hogyan rangsorolunk</Link>.
          </li>
          <li>Nem futtatunk harmadik féltől származó hirdetéskövetőket.</li>
        </ul>

        <h2 className="mt-10 text-xl font-semibold">Tudatos hallgatóknak építjük</h2>
        <p>
          A Podiverzum azoknak készül, akik a podcasteket tanulásra, kutatásra,
          gondolkodásra és felfedezésre használják.
        </p>
        <p>
          Azoknak szól, akik többet akarnak a toplistáknál, a feliratkozásoknál és az algoritmikus
          ajánlásoknál. Akik át akarják tekinteni a teljes kínálatot, és gyorsan szeretnék tudni,
          melyik epizód éri meg az idejüket.
        </p>
        <p>
          A célunk egyszerű: gyorsabbá, okosabbá és kevésbé zajossá tenni a minőségi
          podcastok felfedezését.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Státusz</h2>
        <p>
          A Podiverzum jelenleg <strong>nyilvános bétában</strong> működik — bárki
          szabadon használhatja, de még aktív fejlesztés alatt áll.
        </p>
        <p>
          A katalógus napról napra bővül. A kereső, a rangsorolás és a tematikus oldalak
          folyamatosan javulnak, ahogy egyre több podcast epizód kerül az indexünkbe,
          melyeket részletesen feldolgozunk és összekapcsolunk.
        </p>

        <div className="not-prose mt-12 flex flex-wrap gap-3">
          <Link
            to="/modszertan"
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Hogyan rangsorolunk →
          </Link>
          <Link
            to="/adatvedelem"
            className="px-4 py-2 rounded-md bg-secondary text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            Adatvédelem →
          </Link>
          <a
            href="mailto:hello@podiverzum.hu?subject=Podiverzum%20visszajelzes"
            className="px-4 py-2 rounded-md bg-secondary text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            Visszajelzés küldése →
          </a>
        </div>
      </article>
    </Layout>
  );
}