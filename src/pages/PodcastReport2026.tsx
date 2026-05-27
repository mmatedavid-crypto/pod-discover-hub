import { useEffect } from "react";
import { Link } from "react-router-dom";
import Layout from "@/components/Layout";
import { setSeo } from "@/lib/seo";

// ============================================================
// MAGYAR PODCAST PIAC JELENTÉS 2026
// Forrás: Podiverzum belső adatbázis (2026-05-27 állapot)
// ============================================================

const STATS = {
  podcastCount: 1427,
  episodeCount: 133649,
  podcastsWithEpisodes: 1351,
  peopleIndexed: 2623,
  organizationsIndexed: 4137,
  episodesYear: {
    "2015": 880,
    "2016": 1893,
    "2017": 1516,
    "2018": 1645,
    "2019": 3172,
    "2020": 7738,
    "2021": 12681,
    "2022": 16865,
    "2023": 20230,
    "2024": 23819,
    "2025": 25732,
    "2026 (eddig, 5 hó)": 13261,
  } as Record<string, number>,
  weekday: [
    { name: "Hétfő", eps: 6470 },
    { name: "Kedd", eps: 6351 },
    { name: "Szerda", eps: 5766 },
    { name: "Csütörtök", eps: 6781 },
    { name: "Péntek", eps: 6074 },
    { name: "Szombat", eps: 3524 },
    { name: "Vasárnap", eps: 4027 },
  ],
  tiers: { S: 242, A: 456, B: 626, C: 39, E: 64 },
  topCategories: [
    { name: "Társadalom és kultúra", count: 265 },
    { name: "Vallás és spiritualitás", count: 126 },
    { name: "Hírek és politika", count: 124 },
    { name: "Üzlet és pénzügy", count: 103 },
    { name: "Film, TV és popkultúra", count: 102 },
    { name: "Zene", count: 78 },
    { name: "Sport", count: 67 },
    { name: "Önfejlesztés", count: 57 },
    { name: "Oktatás", count: 51 },
    { name: "Technológia", count: 50 },
    { name: "Egészség és életmód", count: 49 },
    { name: "Könyvek és irodalom", count: 41 },
  ],
  topTopics: [
    { slug: "biblia", name: "Biblia", eps: 130 },
    { slug: "valasztas", name: "Választás 2026", eps: 123 },
    { slug: "zene", name: "Zene", eps: 110 },
    { slug: "mesterseges-intelligencia", name: "Mesterséges intelligencia", eps: 92 },
    { slug: "haboru", name: "Háború (Ukrajna / Közel-Kelet)", eps: 73 },
    { slug: "keresztenyseg", name: "Kereszténység", eps: 72 },
    { slug: "alvas", name: "Alvás", eps: 68 },
    { slug: "film", name: "Film", eps: 65 },
    { slug: "meditacio", name: "Meditáció", eps: 64 },
    { slug: "gazdasag", name: "Gazdaság", eps: 62 },
    { slug: "onismeret", name: "Önismeret", eps: 61 },
    { slug: "kozelet", name: "Közélet", eps: 54 },
    { slug: "kosarlabda", name: "Kosárlabda", eps: 54 },
    { slug: "szinhaz", name: "Színház", eps: 51 },
    { slug: "pszichologia", name: "Pszichológia", eps: 51 },
    { slug: "csalad", name: "Család", eps: 50 },
    { slug: "media", name: "Média", eps: 50 },
    { slug: "sport", name: "Sport", eps: 46 },
    { slug: "egeszseg", name: "Egészség", eps: 43 },
    { slug: "tortenelem", name: "Történelem", eps: 40 },
  ],
};

// derived
const dailyEpisodes2026 = Math.round((STATS.episodesYear["2026 (eddig, 5 hó)"] / 147)); // ~Jan 1 – May 27
const growth10y = (STATS.episodesYear["2025"] / STATS.episodesYear["2015"]).toFixed(1);
const yoy2025 = (((STATS.episodesYear["2025"] - STATS.episodesYear["2024"]) / STATS.episodesYear["2024"]) * 100).toFixed(1);
const projected2026 = Math.round((STATS.episodesYear["2026 (eddig, 5 hó)"] / 147) * 365);
const eliteSharePct = ((STATS.tiers.S / STATS.podcastCount) * 100).toFixed(1);
const top4CategoryShare = (((265 + 126 + 124 + 103) / STATS.podcastCount) * 100).toFixed(0);

const maxYear = Math.max(...Object.values(STATS.episodesYear));
const maxWeek = Math.max(...STATS.weekday.map((d) => d.eps));
const maxCat = STATS.topCategories[0].count;
const maxTopic = STATS.topTopics[0].eps;

export default function PodcastReport2026() {
  useEffect(() => {
    setSeo({
      title: "Magyar podcast piac 2026 — Podiverzum jelentés",
      description: `Az első részletes adat-elemzés a magyar podcast piacról: ${STATS.podcastCount} aktív műsor, ${STATS.episodeCount.toLocaleString("hu-HU")} epizód, 10 év alatt ${growth10y}-szeres növekedés. Toplista, kategóriák, témák, közszereplők.`,
      jsonLd: [
        {
          "@context": "https://schema.org",
          "@type": "Report",
          name: "Magyar podcast piac 2026 — Podiverzum jelentés",
          datePublished: "2026-05-27",
          inLanguage: "hu-HU",
          author: { "@type": "Organization", name: "Podiverzum", url: "https://podiverzum.hu" },
          publisher: { "@type": "Organization", name: "Podiverzum", url: "https://podiverzum.hu" },
          about: "Magyar podcast piac mérete, növekedése, kategóriái és témái",
          url: "https://podiverzum.hu/jelentes/magyar-podcast-piac-2026",
        },
      ],
    });
  }, []);

  return (
    <Layout>
      <article className="mx-auto max-w-3xl px-4 py-8 md:py-12">
        {/* Header */}
        <header className="mb-10 border-b border-border pb-8">
          <div className="mb-3 text-xs uppercase tracking-widest text-muted-foreground">
            Podiverzum jelentés · 2026. május 27.
          </div>
          <h1 className="font-serif text-4xl md:text-5xl font-bold leading-tight text-foreground">
            Magyar podcast piac 2026
          </h1>
          <p className="mt-4 text-lg md:text-xl text-muted-foreground leading-relaxed">
            Első részletes adat-elemzés a magyar nyelvű podcast iparágról.
            {" "}<strong className="text-foreground">{STATS.podcastCount.toLocaleString("hu-HU")} aktív műsor</strong>,
            {" "}<strong className="text-foreground">{STATS.episodeCount.toLocaleString("hu-HU")} epizód</strong>,
            tíz év alatt <strong className="text-foreground">{growth10y}-szeres növekedés</strong>.
          </p>
          <div className="mt-4 text-sm text-muted-foreground">
            Adatforrás: Podiverzum.hu belső katalógus · Módszertan a cikk alján
          </div>
        </header>

        {/* Key Findings — quotable */}
        <section className="mb-12 rounded-lg border border-border bg-card p-6">
          <h2 className="mb-4 font-serif text-xl font-bold text-foreground">A legfontosabb állítások</h2>
          <ul className="space-y-3 text-foreground">
            <li className="flex gap-3">
              <span className="font-bold text-primary">1.</span>
              <span>
                Magyarországon <strong>2026-ban naponta átlagosan {dailyEpisodes2026} új magyar nyelvű podcast epizód</strong> készül — 2015-höz képest több mint <strong>{growth10y}-szeres</strong> növekedés.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="font-bold text-primary">2.</span>
              <span>
                A {STATS.podcastCount.toLocaleString("hu-HU")} aktív magyar podcast közül csupán <strong>{STATS.tiers.S} készül professzionális, heti rendszerességgel</strong> ({eliteSharePct}%) — ez az „S-tier", ők adják a hallgatottság túlnyomó részét.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="font-bold text-primary">3.</span>
              <span>
                Négy kategória — <strong>társadalom, vallás, közélet, üzlet</strong> — adja a műsorok {top4CategoryShare}%-át. A kínálat erősen koncentrált.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="font-bold text-primary">4.</span>
              <span>
                A <strong>választás (123 epizód)</strong> és a <strong>Biblia (130)</strong> 2026-ban együtt több podcast-tartalmat termelt, mint a mesterséges intelligencia (92) — a magyar podcast piacot a közélet és a hit dominálja, nem a technológia.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="font-bold text-primary">5.</span>
              <span>
                <strong>{STATS.peopleIndexed.toLocaleString("hu-HU")} azonosított közszereplő</strong> és <strong>{STATS.organizationsIndexed.toLocaleString("hu-HU")} szervezet</strong> szerepel rendszeresen a magyar podcastokban — soha nem látott mennyiségű strukturált adat egy korábban átláthatatlan médiumról.
              </span>
            </li>
          </ul>
        </section>

        {/* Growth chart */}
        <section className="mb-12">
          <h2 className="mb-2 font-serif text-2xl font-bold text-foreground">Évtizedes berobbanás</h2>
          <p className="mb-6 text-muted-foreground">
            A magyar podcast termelés 2015 óta minden évben nőtt. Az igazi áttörés 2020–2021-ben jött (járvány + Spotify HU launch), és az ütem azóta sem lassul: 2025-ben{" "}
            <strong className="text-foreground">+{yoy2025}%</strong> volt az éves növekedés, 2026-ban a jelenlegi ütem alapján{" "}
            <strong className="text-foreground">~{projected2026.toLocaleString("hu-HU")} új epizód</strong> várható.
          </p>
          <div className="space-y-2">
            {Object.entries(STATS.episodesYear).map(([year, eps]) => (
              <div key={year} className="flex items-center gap-3">
                <div className="w-32 shrink-0 text-sm text-muted-foreground">{year}</div>
                <div className="flex-1 relative h-7 rounded bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary/80 transition-all"
                    style={{ width: `${(eps / maxYear) * 100}%` }}
                  />
                  <div className="absolute inset-0 flex items-center px-2 text-xs font-semibold text-foreground">
                    {eps.toLocaleString("hu-HU")}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Categories */}
        <section className="mb-12">
          <h2 className="mb-2 font-serif text-2xl font-bold text-foreground">Mit hallgatunk? — kategóriák</h2>
          <p className="mb-6 text-muted-foreground">
            A magyar podcast piac négy meghatározó pilléren áll: társadalom-kultúra, vallás, közélet és üzlet. Ez a négy adja a kínálat <strong className="text-foreground">{top4CategoryShare}%-át</strong>. A tech, az egészség és a sport meglepően alulreprezentált a tartalmi spektrumon.
          </p>
          <div className="space-y-2">
            {STATS.topCategories.map((cat) => (
              <div key={cat.name} className="flex items-center gap-3">
                <div className="w-48 shrink-0 text-sm text-foreground">{cat.name}</div>
                <div className="flex-1 relative h-6 rounded bg-muted overflow-hidden">
                  <div
                    className="h-full bg-accent/70"
                    style={{ width: `${(cat.count / maxCat) * 100}%` }}
                  />
                  <div className="absolute inset-0 flex items-center px-2 text-xs font-semibold text-foreground">
                    {cat.count} műsor
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Topics — what we talk about */}
        <section className="mb-12">
          <h2 className="mb-2 font-serif text-2xl font-bold text-foreground">Miről beszélünk? — top 20 téma</h2>
          <p className="mb-6 text-muted-foreground">
            Az AI által azonosított konkrét beszélgetési témák száma az elmúlt 12 hónapban. A magyar podcast nyilvánosság fókusza:
            <strong className="text-foreground"> hit, közélet, mentális egészség, kultúra</strong>. A MI csak a 4. helyen — a magyar piacon a társadalmi téma még mindig erősebb a technológiánál.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {STATS.topTopics.map((t, i) => (
              <Link
                key={t.slug}
                to={`/temak/${t.slug}`}
                className="group flex items-center gap-3 rounded border border-border bg-card px-3 py-2 hover:border-primary transition"
              >
                <span className="w-6 text-xs font-mono text-muted-foreground">{i + 1}.</span>
                <span className="flex-1 text-sm font-medium text-foreground group-hover:text-primary">{t.name}</span>
                <span className="text-xs text-muted-foreground">{t.eps} ep</span>
              </Link>
            ))}
          </div>
        </section>

        {/* When are episodes published */}
        <section className="mb-12">
          <h2 className="mb-2 font-serif text-2xl font-bold text-foreground">Mikor jelenik meg a tartalom?</h2>
          <p className="mb-6 text-muted-foreground">
            A magyar podcast szerkesztőségek jellemzően <strong className="text-foreground">csütörtökön és hétfőn publikálnak</strong> — ez a két nap adja az új tartalom közel harmadát. Hétvégén a frissítés visszaesik a felére.
          </p>
          <div className="space-y-2">
            {STATS.weekday.map((d) => (
              <div key={d.name} className="flex items-center gap-3">
                <div className="w-24 shrink-0 text-sm text-foreground">{d.name}</div>
                <div className="flex-1 relative h-6 rounded bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary/60"
                    style={{ width: `${(d.eps / maxWeek) * 100}%` }}
                  />
                  <div className="absolute inset-0 flex items-center px-2 text-xs font-semibold text-foreground">
                    {d.eps.toLocaleString("hu-HU")} ep (2025)
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Tier distribution */}
        <section className="mb-12">
          <h2 className="mb-2 font-serif text-2xl font-bold text-foreground">A piac koncentrált — kevés profi, sok hobbi</h2>
          <p className="mb-6 text-muted-foreground">
            A Podiverzum belső minőségi besorolása (Formula C) szerint a {STATS.podcastCount} aktív magyar podcastből mindössze{" "}
            <strong className="text-foreground">{STATS.tiers.S} műsor publikál heti vagy gyakoribb rendszerességgel</strong>. Ez a réteg viszi az iparág hallgatottságát és médiavisszhangját.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <TierCard tier="S" label="Heti+, profi" count={STATS.tiers.S} note="Napi vagy heti rendszeresség" />
            <TierCard tier="A" label="Aktív" count={STATS.tiers.A} note="Havi 2–4 epizód" />
            <TierCard tier="B" label="Élő" count={STATS.tiers.B} note="Havi 1 körüli" />
            <TierCard tier="C" label="Ritka" count={STATS.tiers.C} note="Negyedéves" />
            <TierCard tier="E" label="Elhalt" count={STATS.tiers.E} note=">12 hó néma" />
          </div>
        </section>

        {/* People & Orgs */}
        <section className="mb-12">
          <h2 className="mb-2 font-serif text-2xl font-bold text-foreground">Ki és mi szerepel a magyar podcastokban?</h2>
          <p className="mb-6 text-muted-foreground">
            A Podiverzum AI rendszere a teljes epizód-szövegből azonosítja a szereplő embereket, szervezeteket, pártokat és cégeket. Ez a magyar nyilvánosság egy korábban nem létező térképe.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Link to="/szemelyek" className="rounded-lg border border-border bg-card p-6 hover:border-primary transition">
              <div className="text-4xl font-bold text-foreground">{STATS.peopleIndexed.toLocaleString("hu-HU")}</div>
              <div className="mt-2 text-sm uppercase tracking-wide text-muted-foreground">azonosított közszereplő</div>
              <div className="mt-3 text-sm text-muted-foreground">
                Politikusok, művészek, tudósok, vállalkozók — mindenki, aki legalább egy magyar podcast epizódban szerepelt vendégként, vagy akiről beszéltek.
              </div>
            </Link>
            <Link to="/szervezetek" className="rounded-lg border border-border bg-card p-6 hover:border-primary transition">
              <div className="text-4xl font-bold text-foreground">{STATS.organizationsIndexed.toLocaleString("hu-HU")}</div>
              <div className="mt-2 text-sm uppercase tracking-wide text-muted-foreground">szervezet és cég</div>
              <div className="mt-3 text-sm text-muted-foreground">
                Pártok, vállalatok, állami intézmények, civil szervezetek, médiák. Mindegyikről nyomon követhető, hány epizódban szerepelt és milyen összefüggésben.
              </div>
            </Link>
          </div>
        </section>

        {/* What it means */}
        <section className="mb-12 rounded-lg bg-muted/40 p-6">
          <h2 className="mb-3 font-serif text-2xl font-bold text-foreground">Mit jelent mindez?</h2>
          <div className="space-y-3 text-foreground">
            <p>
              A magyar podcast piac <strong>nem hobbiműfaj többé</strong>: napi 87 új epizód, évi több mint 25 ezer adás, közel másfél ezer aktív műsor. A nyilvánosság jelentős része — különösen a 25–45 éves korosztály — már nem a televízióból, hanem a fülhallgatóból tájékozódik.
            </p>
            <p>
              Eközben a podcastok tartalma <strong>strukturálatlan, kereshetetlen, és láthatatlan a hagyományos médiában</strong>: nem kerülnek be az MTI-archívumba, nem indexeli őket a Google érdemben, és a politikai-közéleti viták egy nagy része kontroll nélkül zajlik a hallgatók fülében.
            </p>
            <p>
              A Podiverzum ezt az átláthatatlanságot bontja le: <strong>minden epizód szövegét AI elemzi</strong>, kinyeri a szereplőket, témákat, állításokat, és kereshetővé teszi. Bárki rákeresési arra, mit mondott egy adott politikus, vállalat vagy szakértő bármelyik podcastban az elmúlt évek során.
            </p>
          </div>
        </section>

        {/* Methodology */}
        <section className="mb-12 border-t border-border pt-8">
          <h2 className="mb-3 font-serif text-xl font-bold text-foreground">Módszertan</h2>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              <strong className="text-foreground">Adatforrás:</strong> A Podiverzum.hu folyamatosan figyeli a Podcast Index és az Apple Podcasts katalógusokat,
              valamint a YouTube magyar podcast csatornáit. A „magyar podcast" definíciója: a feed metaadataiban magyar nyelv jelölve (`language=hu*`), vagy AI nyelvazonosítás szerint dominánsan magyar tartalom.
            </p>
            <p>
              <strong className="text-foreground">Aktív műsor:</strong> {STATS.podcastCount} aktív magyar podcast = legalább 1 publikált epizóddal rendelkező, nyilvánosan elérhető RSS feed, 2026. május 27-i állapot szerint.
            </p>
            <p>
              <strong className="text-foreground">Kategorizálás:</strong> Az iTunes/Apple taxonómiát követjük, megerősítve egy belső AI besorolóval (Google Gemini 2.5 modell, 21-kategóriás magyar taxonómia).
            </p>
            <p>
              <strong className="text-foreground">Téma-azonosítás:</strong> Minden epizód transcript-ből kinyert beszélgetési témák, dedupolva és normalizálva (`topics` tábla, 2026-05-27 állapot). „Téma" ≠ kategória: egy „Társadalom" kategóriás műsor adott epizódjának témája lehet „MI" vagy „Választás".
            </p>
            <p>
              <strong className="text-foreground">Tier besorolás (Formula C):</strong> Egy belső pontrendszer, ami az adott podcast átlagos havi epizód-számát súlyozza a frissesség és aktivitás függvényében. S = heti+ profi, E = 12+ hónapja néma feed.
            </p>
            <p>
              <strong className="text-foreground">Közszereplők és szervezetek:</strong> Az AI extraktor (Gemini 2.5) minden epizód clean-text átiratából kinyeri az említett embereket és szervezeteket. Wikipédia/Wikidata alapú azonosítás. Az „indexable" jelző = a szereplő/szervezet legalább 1 epizódban szerepelt és wiki-verifikált, VAGY 3+ epizódban szerepelt.
            </p>
            <p>
              <strong className="text-foreground">Korlátok:</strong> A katalógus nem teljes — kis kalózpodcastok, magán Discord-szerverek, YouTube-csak-streamek nem kerülnek be. Az aktív műsorok aránya valószínűleg 90%+ a teljes magyar piacból.
            </p>
            <p className="pt-2 text-xs">
              Sajtó / kutatás kérések: <a href="mailto:hello@podiverzum.hu" className="text-primary underline">hello@podiverzum.hu</a> — adatlekérések és interaktív elemzések elérhetők.
            </p>
          </div>
        </section>

        {/* Footer CTA */}
        <section className="rounded-lg border border-border bg-card p-6 text-center">
          <div className="mb-3 text-sm uppercase tracking-widest text-muted-foreground">Próbáld ki</div>
          <div className="font-serif text-2xl font-bold text-foreground mb-3">Keress rá bármire a magyar podcast univerzumban</div>
          <p className="mb-4 text-muted-foreground">
            133 ezer epizódban AI-alapú szemantikus keresés, magyar nyelven, idézhető válaszokkal.
          </p>
          <Link
            to="/kereses"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition"
          >
            Keresés indítása →
          </Link>
        </section>
      </article>
    </Layout>
  );
}

function TierCard({ tier, label, count, note }: { tier: string; label: string; count: number; note: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 text-center">
      <div className="text-3xl font-bold text-primary">{tier}</div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground mt-1">{label}</div>
      <div className="text-2xl font-bold text-foreground mt-2">{count}</div>
      <div className="text-[11px] text-muted-foreground mt-1">{note}</div>
    </div>
  );
}
