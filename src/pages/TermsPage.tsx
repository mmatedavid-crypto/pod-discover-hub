import Layout from "@/components/Layout";
import { useEffect } from "react";
import { setSeo } from "@/lib/seo";

export default function TermsPage() {
  useEffect(() => {
    setSeo({
      title: "Felhasználási feltételek — Podiverzum",
      description: "A Podiverzum használati feltételei — egy magyar podcast epizód kereső és felfedező nyilvános RSS feedek alapján.",
    });
  }, []);

  return (
    <Layout>
      <article className="container mx-auto py-12 max-w-2xl prose prose-invert prose-sm sm:prose-base">
        <h1 className="text-3xl font-semibold mb-2">Felhasználási feltételek</h1>
        <p className="text-xs text-muted-foreground mb-8">Utoljára frissítve: {new Date().toLocaleDateString("hu-HU")}</p>

        <p>A Podiverzum egy podcast epizód kereső és felfedező. Az oldal használatával elfogadod az alábbiakat.</p>

        <h2 className="mt-8 text-xl font-semibold">Mi a Podiverzum</h2>
        <p>A Podiverzum segít megtalálni a podcast epizódokat témák, személyek, cégek, részvények, hozzávalók és más ötletek alapján. Maga a podcasttartalom — beleértve a hangot, leírásokat és borítóképeket — az eredeti alkotóké és kiadóké. A Podiverzum <strong>nyilvános RSS feedeket</strong> indexel és visszairányít az eredeti podcasthez vagy platformhoz.</p>

        <h2 className="mt-8 text-xl font-semibold">Nincs garancia a pontosságra</h2>
        <p>A keresési találatok, összefoglalók, rangsorok és entitás-címkék automatikusan generálódnak. Lehetnek hiányosak, elavultak vagy tökéletlenek. Használd a Podiverzumot kiindulópontként, ne forrásként.</p>

        <h2 className="mt-8 text-xl font-semibold">Podcast hallgatás</h2>
        <p>Amikor átkattintasz hallgatni, az eredeti podcast kiadót vagy egy harmadik fél platformját használod (Apple, Spotify, YouTube, a műsor saját oldala stb.). Ezek saját feltételei és adatvédelmi szabályai érvényesek.</p>

        <h2 className="mt-8 text-xl font-semibold">Elfogadható használat</h2>
        <ul className="list-disc pl-5">
          <li>Ne scrape-eld a Podiverzumot úgy, hogy a szolgáltatást zavarja.</li>
          <li>Ne használd az oldalt más felhasználók zaklatására vagy podcastek hamis bemutatására.</li>
          <li>Ne próbáld feltörni, kifürkészni vagy visszaélni a platformmal.</li>
        </ul>

        <h2 className="mt-8 text-xl font-semibold">Béta</h2>
        <p>A Podiverzum jelenleg zárt bétában van. A funkciók, adatok és rangsorok előzetes értesítés nélkül változhatnak.</p>

        <h2 className="mt-8 text-xl font-semibold">Kapcsolat</h2>
        <p>Kérdéseidet vagy hibajelentéseidet az alkalmazáson belüli visszajelzés gombbal jelezheted.</p>
      </article>
    </Layout>
  );
}
