import Layout from "@/components/Layout";
import { Link } from "react-router-dom";
import { useEffect } from "react";
import { setSeo } from "@/lib/seo";

export default function MethodologyPage() {
  useEffect(() => {
    setSeo({
      title: "A rangsorolás működése — A Podiverzum módszertana",
      description:
        "Minőségközpontú podcastfelfedezés. A Podiverzum mesterséges intelligencia, adatelemzés és emberi szempontok alapján rangsorol — fizetett megjelenés nélkül.",
    });
  }, []);

  return (
    <Layout>
      <article className="container mx-auto py-12 max-w-2xl prose prose-invert prose-sm sm:prose-base">
        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">Módszertan</div>
        <h1 className="text-3xl font-semibold mb-2">Minőségközpontú podcastfelfedezés</h1>
        <p className="text-muted-foreground !mt-2">
          A Podiverzum abban segít, hogy gyorsan megtaláld a legértékesebb, legrelevánsabb és
          legmegbízhatóbb podcast epizódokat.
        </p>
        <p>
          A rangsorolás mesterséges intelligenciát, részletes adatelemzést és minőségi
          szempontokat ötvöz. A cél nem az, hogy a leghangosabb vagy legagresszívebben
          hirdetett műsorok kerüljenek előre — hanem hogy olyan epizódokat emeljünk ki,
          amelyek valóban megérik az idődet.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Nincs fizetett megjelenés</h2>
        <p>
          A Podiverzum nem árul rangsort, láthatóságot vagy kiemelt megjelenést.
        </p>
        <p>
          Egyetlen podcast sem fizethet azért, hogy előrébb kerüljön a kereső találatai,
          a kategóriaoldalak, a felkapott listák vagy a hallgatási ajánlók között. Az
          üzleti kapcsolatok nem befolyásolják a rangsort.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Mit értékel a rendszerünk</h2>
        <p>
          A Podiverzum több szempont alapján elemzi a podcasteket és epizódokat:
          tartalmi minőség, frissesség, relevancia, következetesség, felfedezhetőség és
          technikai megbízhatóság.
        </p>
        <p>
          Mesterséges intelligencia segít megérteni, miről szólnak valójában az epizódok:
          a tárgyalt témákról, személyekről, cégekről, iparágakról, gondolatokról és
          ötletekről.
        </p>
        <p>
          Így a kereső nemcsak a címek egyezésére hagyatkozik, hanem az epizódok valódi
          tartalmát tárja fel.
        </p>

        <h2 className="mt-10 text-xl font-semibold">A podcastok minőségi mutatói</h2>
        <p>A podcastok értékelését egy saját minőségi modell végzi.</p>
        <p>
          A modell figyelembe veszi, hogy egy műsor aktív-e, jól strukturált-e, könnyen
          felfedezhető-e, rendszeresen frissül-e, és mennyire értékes a hallgatóknak.
          Azt is vizsgálja, hogy a podcast feedje elegendő megbízható információt
          szolgáltat-e a kereséshez, az összefoglaláshoz és az ajánláshoz.
        </p>
        <p>
          A modell pontos képletét, súlyozását és küszöbértékeit nem hozzuk
          nyilvánosságra. Ez védi a rangsorolás megbízhatóságát és segít megelőzni a
          manipulációt.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Epizódrangsor</h2>
        <p>Az epizódok rangsora kontextusfüggő.</p>
        <p>
          Egy friss epizód a felkapott listákon kaphat helyet. Egy mélyebb, régebbi epizód
          az időtálló tartalmak között jelenhet meg. Egy nagyon specifikus téma pedig
          előtérbe kerülhet egy célzott keresésnél vagy egy témaoldalon, még ha a
          kezdőlapra nem is kerül ki.
        </p>
        <p>
          A rangsorolás figyelembe veszi a relevanciát, a frissességet, a minőséget, a
          tematikus illeszkedést és a sokszínűséget. A cél, hogy a találatok
          változatosak legyenek, és minél több különböző, értékes epizódra lehessen
          rátalálni.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Keresési rangsor</h2>
        <p>
          A Podiverzum keresője a jelentést érti, nem csak a kulcsszavakat.
        </p>
        <p>
          Amikor egy személyre, cégre, piaci témára, egészségügyi területre vagy
          technológiai trendre keresel, olyan epizódokat keresünk, amelyek érdemben
          foglalkoznak az adott témával – még akkor is, ha a pontos kulcsszavak nem
          szerepelnek bennük.
        </p>
        <p>
          A keresési találatok rangsorolása ötvözi a cím relevanciáját, az epizód
          kontextusát, a mesterséges intelligencia által értelmezett jelentést, a
          podcast minőségi besorolását és az epizód frissességét.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Témaoldalak</h2>
        <p>
          A Podiverzum gyűjtőoldalakat hoz létre gyakran tárgyalt személyek, cégek,
          témák, részvények, iparágak és ötletek köré.
        </p>
        <p>
          Ezek az oldalak a podcastok tartalmának elemzése alapján jönnek létre.
          Segítenek egy témát több különböző műsoron keresztül megismerni, nem csak egyetlen
          podcast alapján.
        </p>
        <p>
          Csak akkor hozunk létre ilyen oldalakat, ha elegendő kapcsolódó epizód
          tartozik hozzájuk.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Mit kerülünk</h2>
        <p>
          A Podiverzum kizárhatja vagy hátrébb sorolhatja azokat a tartalmakat, amelyek
          hibásnak, duplikáltnak, félrevezetőnek, kéretlennek, elavultnak vagy más
          okból nemkívánatosnak minősülnek.
        </p>
        <p>
          A Podiverzum jelenleg a magyar nyelvű podcastok felfedezését szolgálja. Más
          nyelvű tartalmak nem jelennek meg a felületen.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Miért változik a rangsor</h2>
        <p>A rangsor dinamikus.</p>
        <p>
          Egy podcast vagy epizód helyezése változhat, ha új tartalom jelenik meg, bővül
          a kínálat, javulnak az adatai, megváltozik a forrása (feed), vagy ha
          rendszerünk mélyebben megérti a tartalmat.
        </p>
        <p>
          Ez szándékos. Egy jó podcastkeresőnek egyszerre kell tükröznie a hosszú távú
          minőséget és az aktualitásokat.
        </p>

        <h2 className="mt-10 text-xl font-semibold">MI és emberi felügyelet</h2>
        <p>
          A mesterséges intelligencia segít nagy mennyiségű podcasttartalmat gyorsan
          megérteni és rendszerezni.
        </p>
        <p>
          Az emberi felügyelet segít fejleszteni a rendszert, áttekinteni a
          visszajelzéseket, és javítani az automatikus elemzés hibáit.
        </p>
        <p>
          Ha hiányzó podcastot, duplikált feedet, pontatlan találatot, rosszul
          besorolt témát vagy oda nem illő epizódot találsz, jelezd nekünk az oldalon
          található visszajelzés gombbal.
        </p>

        <h2 className="mt-10 text-xl font-semibold">A rangsor alapelve</h2>
        <p>A Podiverzum az értékes, minőségi podcasttartalmat emeli ki.</p>
        <p className="!mb-1">Nem a hype-ot.</p>
        <p className="!my-1">Nem a fizetést.</p>
        <p className="!mt-1">Nem a manipulációt.</p>
        <p>
          A cél egyszerű: segítünk megtalálni azokat az epizódokat, amelyek valóban
          megérik az idődet.
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