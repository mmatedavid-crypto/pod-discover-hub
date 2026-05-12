import Layout from "@/components/Layout";
import { Link } from "react-router-dom";
import { useEffect } from "react";
import { setSeo } from "@/lib/seo";

export default function MethodologyPage() {
  useEffect(() => {
    setSeo({
      title: "Hogyan rangsorolunk — Podiverzum módszertan",
      description:
        "Minőségvezérelt podcast felfedezés. A Podiverzum MI-t, strukturált elemzést és szerkesztői jelzéseket kombinál — fizetett megjelenés nélkül.",
    });
  }, []);

  return (
    <Layout>
      <article className="container mx-auto py-12 max-w-2xl prose prose-invert prose-sm sm:prose-base">
        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">Módszertan</div>
        <h1 className="text-3xl font-semibold mb-2">Minőségvezérelt podcast felfedezés</h1>
        <p className="text-muted-foreground !mt-2">
          A Podiverzum úgy rangsorolja a podcasteket és epizódokat, hogy a hallgatók
          gyorsabban találják meg a leghasznosabb, legrelevánsabb és legmegbízhatóbb
          tartalmakat.
        </p>
        <p>
          A rangsorrendszerünk mesterséges intelligenciát, strukturált metaadat-elemzést
          és minőségközpontú felfedezési jelzéseket kombinál. A cél nem az, hogy a
          leghangosabb műsorok vagy a legagresszívebben promotált tartalmak kerüljenek
          előre — hanem hogy olyan epizódokat találjunk, amelyek valóban megérik a
          hallgató idejét.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Nincs fizetett megjelenés</h2>
        <p>
          A Podiverzum nem árul rangsort, láthatóságot vagy kiemelt megjelenést.
        </p>
        <p>
          Egyetlen podcast sem fizethet azért, hogy előrébb kerüljön a kereső találatai,
          kategóriaoldalai, felkapott szekciói vagy felfedezési kollekciói között. Az
          üzleti kapcsolatok nem befolyásolják a rangsort.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Mit értékel a rendszerünk</h2>
        <p>
          A Podiverzum több dimenzió mentén elemzi a podcasteket és epizódokat:
          tartalmi minőség, frissesség, relevancia, következetesség, felfedezhetőség és
          technikai megbízhatóság.
        </p>
        <p>
          MI-t használunk, hogy jobban megértsük, miről szólnak az epizódok — beleértve
          a tárgyalt témákat, embereket, cégeket, iparágakat, gondolatokat és ötleteket.
        </p>
        <p>
          Így a Podiverzum túl tud lépni az egyszerű címbeli egyezésen, és gazdagabb
          felfedezési réteget építhet az epizódok lényegére.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Podcast minőségi jelzések</h2>
        <p>A podcasteket egy saját minőségi modell értékeli.</p>
        <p>
          A modell figyelembe veszi, hogy egy műsor aktív-e, jól strukturált-e,
          felfedezhető-e, rendszeresen jelenik-e meg, és mennyire hasznos a hallgatók
          számára. Azt is nézi, hogy a feed elegendő megbízható információt szolgáltat-e
          a kereséshez, az összefoglaláshoz és az ajánláshoz.
        </p>
        <p>
          A modell pontos képletét, súlyait és küszöbeit nem hozzuk nyilvánosságra. Ez
          védi a rangsorrendszer integritását és segít megelőzni a manipulációt.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Epizódrangsor</h2>
        <p>Az epizódok rangsora kontextusfüggő.</p>
        <p>
          Egy friss epizód jól szerepelhet a felkapott felületeken. Egy mélyebb, régebbi
          epizód jól szerepelhet az időtálló felfedezésben. Egy nagyon specifikus epizód
          előtérbe kerülhet egy szűk keresésnél vagy entitásoldalon, akkor is, ha a
          kezdőlapon nem jelenik meg.
        </p>
        <p>
          A rangsor figyelembe veszi a relevanciát, frissességet, minőséget, témakörhöz
          illeszkedést és sokszínűséget. A cél, hogy ne legyenek ismétlődő találatok, és
          szélesebb spektrumú erős epizódokat lehessen felfedezni.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Keresési rangsor</h2>
        <p>
          A Podiverzum keresője a jelentést érti, nem csak a kulcsszavakat.
        </p>
        <p>
          Amikor valaki egy emberre, cégre, piaci témára, egészségügyi területre,
          technológiára vagy kulturális trendre keres, olyan epizódokat keresünk, amelyek
          érdemben foglalkoznak az adott témával — még akkor is, ha pontos szóhasználat
          nem egyezik.
        </p>
        <p>
          A keresési találatok kombinálják a címben szereplő relevanciát, az epizód
          kontextusát, az MI által megértett jelentést, a podcast minőségét és a
          frissességet.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Entitás- és témaoldalak</h2>
        <p>
          A Podiverzum felfedező oldalakat épít visszatérő emberek, cégek, témák,
          részvények, iparágak és ötletek köré.
        </p>
        <p>
          Ezek az oldalak az indexelt podcasttartalom strukturált elemzéséből születnek.
          Segítenek egy témát több műsoron át bejárni, ahelyett, hogy egyetlen kiadóra
          vagy feedre lennénk korlátozva.
        </p>
        <p>
          Csak akkor jelenítünk meg ilyen oldalakat, ha elég hasznos anyag van a mögötte.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Mit kerülünk</h2>
        <p>
          A Podiverzum kizárhatja vagy csökkentheti azoknak a tartalmaknak a láthatóságát,
          amelyek hibásnak, duplikáltnak, félrevezetőnek, spamszerűnek, inaktívnak,
          biztonságtalannak vagy az alapértelmezett felületeken nem megfelelőnek tűnnek.
        </p>
        <p>
          Jelenleg a Podiverzum kifejezetten magyar nyelvű felfedezésre épül. A nem
          magyar nyelvű tartalmak a nyilvános felületeken nem jelennek meg.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Miért változik a rangsor</h2>
        <p>A rangsor dinamikus.</p>
        <p>
          Egy podcast vagy epizód helyezése változhat, ha új tartalom jelenik meg, bővül
          a katalógus, javul a metaadat, változik a feed, vagy a rendszer jobban megérti
          a tartalmat.
        </p>
        <p>
          Ez szándékos. A podcast felfedezésnek tükröznie kell a hosszú távú minőséget
          és azt is, ami éppen aktuális.
        </p>

        <h2 className="mt-10 text-xl font-semibold">MI és emberi felügyelet</h2>
        <p>
          Az MI segít a Podiverzumnak megérteni és rendszerezni a podcasttartalmat
          nagyságrendekkel.
        </p>
        <p>
          Az emberi felügyelet segít fejleszteni a rendszert, áttekinteni a
          visszajelzéseket és kijavítani azokat a hibákat, amelyeket az automatikus
          elemzés elrontott.
        </p>
        <p>
          Ha hiányzó podcastet, duplikált feedet, gyenge találatot, rosszul besorolt
          témát vagy oda nem illő epizódot látsz, használd az alkalmazáson belüli
          visszajelzés gombot.
        </p>

        <h2 className="mt-10 text-xl font-semibold">A rangsor alapelve</h2>
        <p>A Podiverzum a hasznos, minőségi podcasttartalmat jutalmazza.</p>
        <p className="!mb-1">Nem a hype-ot.</p>
        <p className="!my-1">Nem a fizetést.</p>
        <p className="!mt-1">Nem a manipulációt.</p>
        <p>
          A cél egyszerű: segítsünk megtalálni az epizódokat, amelyek megérik az időt.
        </p>

        <div className="not-prose mt-12 flex flex-wrap gap-3">
          <Link
            to="/rolunk"
            className="px-4 py-2 rounded-md bg-secondary text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            ← Rólunk
          </Link>
        </div>
      </article>
    </Layout>
  );
}
