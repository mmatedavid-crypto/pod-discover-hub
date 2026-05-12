import Layout from "@/components/Layout";
import { useEffect } from "react";
import { setSeo } from "@/lib/seo";

export default function PrivacyPage() {
  useEffect(() => {
    setSeo({
      title: "Adatvédelem — Podiverzum",
      description: "Hogyan kezeli a Podiverzum az adataidat: opcionális visszajelzés, keresési analitika, IP-követés nélkül, személyes adatok eladása nélkül.",
    });
  }, []);

  return (
    <Layout>
      <article className="container mx-auto py-12 max-w-2xl prose prose-invert prose-sm sm:prose-base">
        <h1 className="text-3xl font-semibold mb-2">Adatvédelem</h1>
        <p className="text-xs text-muted-foreground mb-8">Utoljára frissítve: {new Date().toLocaleDateString("hu-HU")}</p>

        <p>A Podiverzum egy podcast felfedező. Igyekszünk a lehető legkevesebb személyes adatot gyűjteni. Ez az oldal elmagyarázza, mit gyűjtünk és miért.</p>

        <h2 className="mt-8 text-xl font-semibold">Mit indexelünk</h2>
        <p>A Podiverzum <strong>nyilvános podcast RSS feedeket</strong> indexel. Hangot nem hosztolunk. Az eredeti hang és metaadat azoké a podcasteké és platformoké, amelyek közzéteszik.</p>

        <h2 className="mt-8 text-xl font-semibold">Visszajelzés</h2>
        <p>Ha használod az alkalmazáson belüli visszajelzés gombot, eltároljuk amit beküldesz, hogy fejleszthessük a terméket. Egy visszajelzés rekord tartalmazhatja:</p>
        <ul className="list-disc pl-5">
          <li>az üzeneted</li>
          <li>opcionális e-mail címet (csak ha megadtad)</li>
          <li>az oldal URL-jét, ahonnan a visszajelzést küldted</li>
          <li>a viewport méretét és a böngésző user-agent stringjét (UI hibák reprodukálásához)</li>
          <li>a legutóbbi keresési kifejezést, ha a keresőoldalon voltál</li>
        </ul>
        <p>A visszajelzések csak a Podiverzum adminisztrátorai számára láthatók.</p>

        <h2 className="mt-8 text-xl font-semibold">Keresési analitika</h2>
        <p>A keresési minőség javítása érdekében minden keresést rögzítünk a következőkkel:</p>
        <ul className="list-disc pl-5">
          <li>a keresési szöveg</li>
          <li>a visszaadott találatok száma</li>
          <li>használtunk-e tágabb fallback keresést</li>
          <li>a viewport szélessége</li>
          <li>időbélyeg</li>
        </ul>

        <h2 className="mt-8 text-xl font-semibold">Oldal analitika</h2>
        <p>Alapvető oldalmegtekintéseket naplózunk: útvonal, hivatkozó, viewport méret, időbélyeg és UTM kampányparaméterek (ha vannak).</p>

        <h2 className="mt-8 text-xl font-semibold">Mit nem csinálunk</h2>
        <ul className="list-disc pl-5">
          <li>Szándékosan nem tárolunk IP-címeket.</li>
          <li>Nem adjuk el a személyes adatokat.</li>
          <li>Nem használunk harmadik féltől származó hirdetéskövetőket.</li>
        </ul>

        <h2 className="mt-8 text-xl font-semibold">Kapcsolat</h2>
        <p>A leggyorsabb módja az elérésünknek az alkalmazáson belüli visszajelzés gomb. Ha választ szeretnél, megadhatsz egy e-mail címet is.</p>
      </article>
    </Layout>
  );
}
