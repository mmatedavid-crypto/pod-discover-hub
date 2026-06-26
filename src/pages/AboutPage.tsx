import Layout from "@/components/Layout";
import { Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
import { setSeo } from "@/lib/seo";
import { publisherAddressLine, SITE_PUBLISHER, sitePublisherJsonLd } from "@/lib/sitePublisher";
import introVideo from "@/assets/podiverzum-intro.mp4.asset.json";
import introPoster from "@/assets/podiverzum-intro-poster.jpg.asset.json";

export default function AboutPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [needsPlay, setNeedsPlay] = useState(false);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const promise = v.play();
    if (promise !== undefined) {
      promise
        .then(() => setIsPlaying(true))
        .catch(() => setNeedsPlay(true));
    }
  }, []);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play()
        .then(() => {
          setIsPlaying(true);
          setNeedsPlay(false);
        })
        .catch(() => {});
    } else {
      v.pause();
      setIsPlaying(false);
    }
  };

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
        publisher: sitePublisherJsonLd(),
        sameAs: [],
      },
    });
  }, []);

  return (
    <Layout>
      <article className="container mx-auto py-12 max-w-2xl prose prose-invert prose-sm sm:prose-base">
        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">Rólunk</div>
        <h1 className="text-3xl font-semibold mb-2">Találd meg. Hallgasd meg.</h1>

        <figure className="not-prose my-6 mx-auto max-w-[360px]">
          <div className="relative overflow-hidden rounded-2xl ring-1 ring-white/10 bg-black shadow-[0_20px_60px_-20px_hsl(var(--brand-red)/0.45)]">
            <video
              ref={videoRef}
              src={introVideo.url}
              poster={introPoster.url}
              autoPlay
              loop
              playsInline
              preload="metadata"
              aria-label="Podiverzum márkaintro"
              className="block w-full h-auto cursor-pointer"
              onClick={togglePlay}
              onPlay={() => {
                setIsPlaying(true);
                setNeedsPlay(false);
              }}
              onPause={() => setIsPlaying(false)}
            />
            {needsPlay && (
              <button
                type="button"
                onClick={togglePlay}
                aria-label="Intro lejátszása"
                className="absolute inset-0 flex items-center justify-center bg-black/40 text-white transition-colors hover:bg-black/50"
              >
                <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-black/60 backdrop-blur ring-1 ring-white/20 text-sm font-medium">
                  <Play className="h-4 w-4 fill-current" />
                  Lejátszás
                </span>
              </button>
            )}
            {!needsPlay && (
              <button
                type="button"
                onClick={togglePlay}
                aria-label={isPlaying ? "Szünet" : "Lejátszás"}
                className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-black/60 backdrop-blur text-white text-xs ring-1 ring-white/20 hover:bg-black/80 transition-colors"
              >
                {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 fill-current" />}
                <span>{isPlaying ? "Szünet" : "Lejátszás"}</span>
              </button>
            )}
          </div>
        </figure>
        <p className="text-muted-foreground !mt-2">
          A Podiverzum egy MI-alapú kereső, amellyel a magyar podcastok világa kereshetővé,
          érthetővé és könnyen áttekinthetővé válik.
        </p>
        <p>
          Nem tárolunk hanganyagot, de a hallgatást saját lejátszóval tesszük kényelmesebbé. Nyilvános podcastokat
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
            Saját playerrel indítjuk a hallgatást, miközben a hanganyag továbbra is az eredeti
            kiadói forrásból érkezik.
          </li>
        </ul>

        <h2 className="mt-10 text-xl font-semibold">Mit nem csinálunk</h2>
        <ul className="list-disc pl-5">
          <li>Nem tárolunk hangfájlokat. A hang az alkotóké és a kiadóké.</li>
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

        <h2 className="mt-10 text-xl font-semibold">Sajtó</h2>
        <p>
          A magyar podcastpiac alakulásáról és a Podiverzumról az MTI is beszámolt.
        </p>
        <a
          href="/sajto"
          className="inline-block mt-2 text-sm text-primary hover:underline"
        >
          Megnézem a sajtómegjelenéseket →
        </a>

        <h2 className="mt-10 text-xl font-semibold">Kiadó</h2>
        <p>
          A Podiverzum kiadója: <strong>{SITE_PUBLISHER.displayName}</strong>.
          Jogi név: {SITE_PUBLISHER.legalName}. Székhely: {publisherAddressLine()}.
          Cégjegyzékszám: {SITE_PUBLISHER.companyRegisterNumber}. Adószám: {SITE_PUBLISHER.taxId}.
        </p>

        <div className="not-prose mt-12 flex flex-wrap gap-3">
          <Link
            to="/modszertan"
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Módszertan →
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
