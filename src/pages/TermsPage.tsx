import Layout from "@/components/Layout";
import { useEffect } from "react";
import { setSeo } from "@/lib/seo";

export default function TermsPage() {
  useEffect(() => {
    setSeo({
      title: "Felhasználási feltételek — Podiverzum",
      description: "A Podiverzum használati feltételei. A szolgáltatás magyar podcast epizódok keresését teszi lehetővé nyilvános RSS-hírcsatornák alapján.",
    });
  }, []);

  return (
    <Layout>
      <article className="container mx-auto py-12 max-w-2xl prose prose-invert prose-sm sm:prose-base">
        <h1 className="text-3xl font-semibold mb-2">Felhasználási feltételek</h1>
        <p className="text-xs text-muted-foreground mb-8">Utoljára frissítve: {new Date().toLocaleDateString("hu-HU")}</p>

        <p>A Podiverzum egy magyar podcast epizód kereső. Az oldal használata az alábbi feltételek elfogadását jelenti.</p>

        <h2 className="mt-8 text-xl font-semibold">A szolgáltatásról</h2>
        <p>A Podiverzum segít releváns podcast epizódokat találni témák, személyek, cégek és egyéb kifejezések alapján. A podcasttartalom maga – beleértve a hanganyagot, a leírásokat és a borítóképeket – az eredeti alkotók és kiadók tulajdonát képezi. A Podiverzum <strong>nyilvánosan elérhető RSS-hírcsatornákat</strong> indexel, és a lejátszáshoz visszairányít az eredeti műsorhoz vagy platformra.</p>

        <h2 className="mt-8 text-xl font-semibold">Az adatok pontossága</h2>
        <p>A keresési találatok, az összefoglalók, a rangsorok és a témacímkék automatikusan jönnek létre. Emiatt lehetnek hiányosak, elavultak vagy pontatlanok. Tekintsd a Podiverzumot kiindulópontnak, ne pedig hiteles forrásnak.</p>

        <h2 className="mt-8 text-xl font-semibold">Podcast epizódok meghallgatása</h2>
        <p>A meghallgatáshoz a Podiverzum az eredeti kiadó vagy egy harmadik fél (pl. Apple, Spotify, YouTube, a műsor saját oldala) felületére irányít át. Ezekre a platformokra a saját felhasználási feltételeik és adatvédelmi szabályzatuk vonatkozik.</p>

        <h2 className="mt-8 text-xl font-semibold">Elfogadható használat</h2>
        <ul className="list-disc pl-5">
          <li>Tilos a szolgáltatás működését zavaró automatizált adatgyűjtés (scraping).</li>
          <li>Tilos az oldalt mások zaklatására vagy podcastok megtévesztő bemutatására használni.</li>
          <li>Tilos a platform feltörése, működésének megzavarása vagy a szolgáltatással való visszaélés.</li>
        </ul>

        <h2 className="mt-8 text-xl font-semibold">Béta verzió</h2>
        <p>A Podiverzum jelenleg béta verzióként működik. A szolgáltatás funkciói, a megjelenített adatok és rangsorok előzetes értesítés nélkül változhatnak.</p>

        <h2 className="mt-8 text-xl font-semibold">Kapcsolat</h2>
        <p>Kérdés vagy hibajelentés esetén használd az oldalon található visszajelzés gombot.</p>
      </article>
    </Layout>
  );
}