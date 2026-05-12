import Layout from "@/components/Layout";
import { Link } from "react-router-dom";
import { useEffect } from "react";
import { setSeo } from "@/lib/seo";

export default function AboutPage() {
  useEffect(() => {
    setSeo({
      title: "Rólunk — Podiverzum, magyar podcast felfedező",
      description:
        "A Podiverzum MI-vezérelt magyar podcast felfedező. Több ezer nyilvános podcast feedet indexelünk, hogy könnyen megtaláld azokat az epizódokat, amelyek valóban érdekelnek.",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: "Podiverzum",
        url: "https://podiverzum.hu",
        description:
          "MI-vezérelt magyar podcast felfedező. Keress epizódokat témák, személyek, cégek vagy ötletek alapján.",
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
          A Podiverzum egy MI-vezérelt podcast felfedező, amely a magyar podcast univerzum
          legjavát teszi kereshetővé, érthetővé és könnyen bejárhatóvá.
        </p>
        <p>
          Nem hosztolunk hangot. Nem helyettesítjük a podcast appokat. Nyilvános podcast
          feedeket indexelünk, és segítünk megtalálni az epizódokat aszerint, hogy miről
          szólnak valójában — emberekről, cégekről, piacokról, technológiákról, ötletekről,
          helyekről, egészségi témákról, kulturális trendekről és sok másról.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Miért létezik a Podiverzum</h2>
        <p>
          A legtöbb podcast app az általad már követett műsorok köré épül. Ez akkor jó,
          amikor pontosan tudod, mit akarsz hallgatni.
        </p>
        <p>De a felfedezés még mindig széttöredezett.</p>
        <p>
          Ha friss epizódokat keresnél a magyar gazdaságról, az MNB kamatdöntésről, a Hold
          Alapkezelő elemzéseiről, a mesterséges intelligenciáról, az egészséges életmódról,
          a hazai politikáról vagy a vállalkozói történetekről, általában cím szerint kell
          keresgélned, végig kell görgetned az egyes feedeket, vagy reménykedned kell, hogy
          a megfelelő epizód feltűnik valamelyik chartban.
        </p>
        <p>A Podiverzum erre a hiányzó rétegre épül.</p>
        <p>
          A podcasteket inkább úgy kezeljük, mint a webet: kereshető, rangsorolt index
          epizódokról, műsorokról, témákról, emberekről, cégekről és ötletekről.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Mit csinálunk</h2>
        <ul className="list-disc pl-5">
          <li>Folyamatosan indexelünk több ezer nyilvános magyar podcast RSS feedet.</li>
          <li>
            MI segítségével megértjük, miről szólnak valójában az epizódok — emberek,
            cégek, részvények, technológiák, helyek, témák és gondolatok mentén.
          </li>
          <li>
            Frissesség, következetesség, minőség, relevancia és feed-egészség alapján
            rangsorolunk podcasteket és epizódokat.
          </li>
          <li>
            Felfedező felületeket építünk: felkapott epizódok, időtálló válogatások,
            kategóriaoldalak, hangulatkollekciók és entitásoldalak.
          </li>
          <li>
            A hallgatókat visszaküldjük az eredeti kiadóhoz — Apple Podcasts, Spotify,
            YouTube, a műsor saját oldala, vagy ahol az alkotó publikál.
          </li>
        </ul>

        <h2 className="mt-10 text-xl font-semibold">Mit nem csinálunk</h2>
        <ul className="list-disc pl-5">
          <li>Nem hosztolunk és nem streamelünk hangot. A hang az alkotóké és kiadóké.</li>
          <li>
            Nem adjuk el a személyes adataidat. Lásd:{" "}
            <Link to="/adatvedelem" className="text-primary hover:underline">Adatvédelem</Link>.
          </li>
          <li>
            Nem árulunk megjelenést. A rangsor képletalapú, minőségvezérelt és arra szolgál,
            hogy a hasznos találatok kerüljenek előre. Lásd:{" "}
            <Link to="/modszertan" className="text-primary hover:underline">Hogyan rangsorolunk</Link>.
          </li>
          <li>Nem futtatunk harmadik féltől származó hirdetéskövetőket.</li>
        </ul>

        <h2 className="mt-10 text-xl font-semibold">Komoly hallgatóknak építjük</h2>
        <p>
          A Podiverzum azoknak készül, akik a podcasteket tanulásra, kutatásra,
          gondolkodásra és felfedezésre használják.
        </p>
        <p>
          Azoknak szól, akik többet akarnak a chartoknál, feliratkozásoknál és algoritmikus
          ajánlóknál. Akik át akarnak nézni több ezer epizódot, és gyorsan szeretnék tudni,
          melyik éri meg az idejüket.
        </p>
        <p>
          A célunk egyszerű: gyorsabbá, okosabbá és kevésbé zajossá tenni a minőségi
          podcast felfedezést.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Státusz</h2>
        <p>A Podiverzum jelenleg <strong>zárt bétában</strong> van.</p>
        <p>
          A katalógus napról napra bővül. A kereső, a rangsor, az entitásoldalak és a
          felfedező felületek folyamatosan javulnak, ahogy egyre több epizód kerül
          indexelésre, gazdagításra és összekapcsolásra.
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
