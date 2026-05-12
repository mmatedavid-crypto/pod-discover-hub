import Layout from "@/components/Layout";
import { useEffect } from "react";
import { setSeo } from "@/lib/seo";

export default function PrivacyPage() {
  useEffect(() => {
    setSeo({
      title: "Adatvédelem — Podiverzum",
      description: "A Podiverzum adatkezelési elvei: anonim analitika, opcionális visszajelzés, az IP-címek rögzítése és a személyes adatok továbbadása nélkül.",
    });
  }, []);

  return (
    <Layout>
      <article className="container mx-auto py-12 max-w-2xl prose prose-invert prose-sm sm:prose-base">
        <h1 className="text-3xl font-semibold mb-2">Adatvédelem</h1>
        <p className="text-xs text-muted-foreground mb-8">Utolsó frissítés: {new Date().toLocaleDateString("hu-HU")}</p>

        <p>A Podiverzum egy podcastkereső. Célunk, hogy a lehető legkevesebb személyes adatot gyűjtsük. Ezen az oldalon bemutatjuk, mit és miért rögzítünk.</p>

        <h2 className="mt-8 text-xl font-semibold">Mit indexelünk</h2>
        <p>A Podiverzum <strong>nyilvános podcast RSS-hírcsatornákat</strong> indexel. Hangfájlokat nem tárolunk. Az eredeti hanganyagok és adatok a podcasterek és szolgáltatóik tulajdona.</p>

        <h2 className="mt-8 text-xl font-semibold">Visszajelzés</h2>
        <p>Ha visszajelzést küldesz, az üzenetedet a szolgáltatás fejlesztése érdekében eltároljuk. A beküldött visszajelzés a következő adatokat tartalmazhatja:</p>
        <ul className="list-disc pl-5">
          <li>az üzeneted</li>
          <li>az e-mail címed (ha megadod)</li>
          <li>az oldal címe (URL), ahonnan visszajelzést küldtél</li>
          <li>a böngészőablak mérete és a böngésző azonosítója (user agent), amely a felületi hibák javítását segíti</li>
          <li>az utolsó keresőkifejezés, ha a keresőoldalról küldted a visszajelzést</li>
        </ul>
        <p>A visszajelzéseket csak a Podiverzum fejlesztői látják.</p>

        <h2 className="mt-8 text-xl font-semibold">Keresési analitika</h2>
        <p>A keresőnk minőségének javítása érdekében minden keresést anonim módon rögzítünk. A rögzített adatok:</p>
        <ul className="list-disc pl-5">
          <li>a keresett kifejezés</li>
          <li>a visszaadott találatok száma</li>
          <li>hogy történt-e automatikus, tágabb keresés</li>
          <li>a böngészőablak szélessége</li>
          <li>a keresés időpontja</li>
        </ul>

        <h2 className="mt-8 text-xl font-semibold">Oldalanalitika</h2>
        <p>A szolgáltatás használatáról anonim statisztikát készítünk. Ehhez rögzítjük a megtekintett oldal címét, a hivatkozó oldalt, a böngészőablak méretét, az időpontot és az esetleges kampányparamétereket.</p>

        <h2 className="mt-8 text-xl font-semibold">Amit soha nem teszünk</h2>
        <ul className="list-disc pl-5">
          <li>Nem rögzítjük a látogatók IP-címét.</li>
          <li>Személyes adatokat soha nem adunk tovább harmadik félnek.</li>
          <li>Nem használunk külső hirdetési és követőkódokat (pl. Google Analytics, Facebook Pixel).</li>
        </ul>

        <h2 className="mt-8 text-xl font-semibold">Kapcsolat</h2>
        <p>Ha kérdésed van, legkönnyebben a visszajelzés gombbal tudsz nekünk írni. Ha választ szeretnél kapni, ne felejtsd el megadni az e-mail címedet.</p>
      </article>
    </Layout>
  );
}