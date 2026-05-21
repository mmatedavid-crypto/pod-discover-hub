import Layout from "@/components/Layout";
import { Link } from "react-router-dom";
import { useEffect } from "react";
import { setSeo } from "@/lib/seo";

export default function MethodologyPage() {
  useEffect(() => {
    setSeo({
      title: "Módszertan | Hogyan működik a Podiverzum?",
      description:
        "Ismerd meg, hogyan segít a Podiverzum megtalálni a magyar podcastok közül azokat az epizódokat, amelyek valóban érdekelnek — jelentésalapú kereséssel, témák és kapcsolódó tartalmak mentén.",
    });
  }, []);

  return (
    <Layout>
      <article className="container mx-auto py-12 max-w-2xl prose prose-invert prose-sm sm:prose-base">
        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">Módszertan</div>
        <h1 className="text-3xl font-semibold mb-2">Hogyan működik a Podiverzum?</h1>
        <p className="text-muted-foreground !mt-2">
          A Podiverzum azért készült, hogy a magyar podcastokat ne csak műsorcímek és kategóriák alapján
          lehessen megtalálni. Az epizódok témáit, szereplőit és összefüggéseit is figyeljük, hogy akkor is
          releváns beszélgetéseket találj, ha nem tudod pontosan, melyik műsort keresed.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Nem katalógus, hanem felfedezőfelület</h2>
        <p>
          A legtöbb podcastfelület abból indul ki, hogy tudod, melyik műsort keresed. A Podiverzum
          abból indul ki, hogy tudod, mi érdekel. Lehet ez egy személy, egy gazdasági kérdés, egy
          filmes téma, egy élethelyzet vagy akár csak egy hangulat.
        </p>
        <p>
          Nem baj, ha nem ismered az összes magyar podcastot név szerint. A Podiverzum célja, hogy
          az érdeklődésedből indulva megtaláld azokat az epizódokat, amelyek valóban szólnak
          arról, amit hallgatnál.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Jelentésalapú keresés</h2>
        <p>
          A keresés nem áll meg annál, hogy egy szó szerepel-e a címben. A Podiverzum az epizódok
          leírásai, összefoglalói és kapcsolódásai alapján azt is figyeli, miről szólhat egy
          beszélgetés. Így olyan epizódok is előkerülhetnek, amelyeket egy sima kulcsszavas keresés
          könnyen elrejtene.
        </p>
        <p>
          Kereshetsz témákra, személyekre, kérdésekre, cégekre vagy akár ötletekre. A rendszer a
          jelentést keresi — nem csak az egyező betűket.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Személyek, témák, kapcsolódó epizódok</h2>
        <p>
          Egy jó podcastkereső nem ér véget az első találatnál. Ha megtalálsz egy epizódot, a
          Podiverzum segít továbbindulni: hasonló témájú beszélgetéseket, kapcsolódó podcastokat,
          személyeket és témákat mutat.
        </p>
        <p>
          A személyek oldalain a releváns epizódok gyűlnek össze egy-egy szereplő köré. A témaoldalak
          segítenek egy adott témát több műsoron keresztül megismerni. A kapcsolódó epizódok és a
          hasonló podcastok pedig azt a célt szolgálják, hogy a felfedezés ne álljon meg egyetlen
          találatnál.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Magyar tartalomra hangolva</h2>
        <p>
          A magyar podcastvilág adatai nem mindig rendezettek. Sok műsor kevés leírást ad, eltérő
          kategóriákat használ, vagy hiányosan tölti ki az adatait. A Podiverzum célja, hogy ebből
          mégis használható, kereshető és felfedezhető magyar podcast-univerzumot építsen.
        </p>
        <p>
          A rendszer a magyar nyelvű tartalmakra fókuszál. A külföldi, nem magyar vagy zajos
          forrásokat szűrjük, hogy a találatok valóban a magyar podcastkínálatból származzanak.
        </p>

        <h2 className="mt-10 text-xl font-semibold">MI, de kontrollal</h2>
        <p>
          MI-t használunk arra, hogy az epizódok könnyebben kereshetők, összefoglalhatók és
          összekapcsolhatók legyenek. De a cél nem az, hogy az MI helyettünk döntsön mindenről.
          A személyeknél, témáknál és ajánlóknál külön minőségi szabályokat és ellenőrzéseket
          használunk.
        </p>
        <p>
          Az MI segít a rendszerezésben és a rendszer skálázhatóságában. A végső élmény azonban
          emberi értékelésre és folyamatos finomhangolásra épül.
        </p>


        <h2 className="mt-10 text-xl font-semibold">Honnan származnak az adatok?</h2>
        <p>
          A Podiverzum nyilvános RSS-csatornákból és publikus podcast-metaadatokból dolgozik. Az
          epizódok címeit, leírásait, műsoradatait és elérhető összefoglalóit használjuk a kereséshez
          és a rendszerezéshez.
        </p>
        <p>
          A hanganyagot nem tároljuk és nem streameljük. A podcastok az eredeti kiadóikhoz
          tartoznak; mi az adataikat dolgozzuk fel a felfedezhetőség érdekében.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Mit nem állítunk?</h2>
        <p>
          A Podiverzum nem hivatalos podcast-rangsor, és nem állítja, hogy minden adat minden
          pillanatban tökéletes. Nyilvános podcastadatokból dolgozunk, amelyek minősége műsoronként
          eltérő lehet.
        </p>
        <p>
          A rendszer folyamatosan javul, és a hibás találatok kiszűrése a működés fontos része.
          Ha valami nem stimmel, számítunk a visszajelzésedre.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Visszajelzés</h2>
        <p>
          Ha hibás találatot, rossz személykapcsolatot, pontatlan adatot vagy hiányzó magyar
          podcastot látsz, írj nekünk:{" "}
          <a
            href="mailto:hello@podiverzum.hu?subject=Podiverzum%20visszajelzes"
            className="text-primary hover:underline"
          >
            hello@podiverzum.hu
          </a>
          .
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
