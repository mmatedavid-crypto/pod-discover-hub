import Layout from "@/components/Layout";
import { useEffect } from "react";
import { setSeo } from "@/lib/seo";
import { publisherAddressLine, SITE_PUBLISHER, sitePublisherJsonLd } from "@/lib/sitePublisher";

export default function TermsPage() {
  useEffect(() => {
    setSeo({
      title: "Felhasználási feltételek — Podiverzum",
      description: "A Podiverzum használati feltételei. A szolgáltatás magyar podcast epizódok keresését teszi lehetővé nyilvános RSS-hírcsatornák alapján.",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: "Felhasználási feltételek",
        url: "https://podiverzum.hu/feltetelek",
        publisher: sitePublisherJsonLd(),
      },
    });
  }, []);

  return (
    <Layout>
      <article className="container mx-auto py-12 max-w-2xl prose prose-invert prose-sm sm:prose-base">
        <h1 className="text-3xl font-semibold mb-2">Felhasználási feltételek</h1>
        <p className="text-xs text-muted-foreground mb-8">Utoljára frissítve: {new Date().toLocaleDateString("hu-HU")}</p>

        <p>A Podiverzum egy kereső magyar podcast epizódokhoz. Az oldal használatával elfogadod az alábbi feltételeket.</p>

        <h2 className="mt-8 text-xl font-semibold">Kiadó</h2>
        <p>
          A szolgáltatás kiadója: <strong>{SITE_PUBLISHER.displayName}</strong>.
          Jogi név: {SITE_PUBLISHER.legalName}. Székhely: {publisherAddressLine()}.
          Cégjegyzékszám: {SITE_PUBLISHER.companyRegisterNumber}. Adószám: {SITE_PUBLISHER.taxId}.
        </p>

        <h2 className="mt-8 text-xl font-semibold">A szolgáltatásról</h2>
        <p>A Podiverzum segít releváns podcast epizódokat találni témák, személyek, cégek és más kifejezések alapján. A podcasttartalom – beleértve a hanganyagot, a leírásokat és a borítóképeket – az eredeti alkotók és kiadók tulajdona. A Podiverzum <strong>nyilvánosan elérhető RSS-hírcsatornákat</strong> indexel, és ahol technikailag lehetséges, saját lejátszóban indítja el az epizódot az eredeti kiadói hangforrás használatával.</p>

        <h2 className="mt-8 text-xl font-semibold">Az adatok pontossága</h2>
        <p>A keresési találatok, az összefoglalók, a rangsorok és a témacímkék automatikusan jönnek létre. Emiatt lehetnek hiányosak, elavultak vagy pontatlanok. Tekintsd a Podiverzumot kiindulópontnak, ne pedig hiteles forrásnak.</p>

        <h2 className="mt-8 text-xl font-semibold">Podcast epizódok meghallgatása</h2>
        <p>A meghallgatás általában a Podiverzum saját lejátszójában indul, de a hangfájl forrása továbbra is az eredeti kiadó vagy egy harmadik fél (pl. Apple, Spotify, YouTube, a műsor saját oldala). Ha a beágyazott lejátszás nem működik, külső megnyitási lehetőséget adunk. A külső platformokra a saját felhasználási feltételeik és adatvédelmi szabályzatuk vonatkozik.</p>

        <h2 className="mt-8 text-xl font-semibold">Elfogadható használat</h2>
        <ul className="list-disc pl-5">
          <li>Tilos a szolgáltatás működését zavaró automatizált adatgyűjtés (scraping).</li>
          <li>Tilos az oldalt mások zaklatására vagy podcastok megtévesztő bemutatására használni.</li>
          <li>Tilos a platform feltörése, működésének megzavarása vagy a szolgáltatással való visszaélés.</li>
        </ul>

        <h2 className="mt-8 text-xl font-semibold">Folyamatos fejlesztés</h2>
        <p>A Podiverzumot folyamatosan fejlesztjük. A szolgáltatás funkciói, a megjelenített adatok és a rangsorok előzetes értesítés nélkül változhatnak.</p>

        <h2 className="mt-8 text-xl font-semibold">Kapcsolat</h2>
        <p>Kérdés vagy hibajelentés esetén használd az oldalon található visszajelzés gombot.</p>
      </article>
    </Layout>
  );
}
