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
  // Internal tier names retained for data accuracy; public labels used in UI.
  tiers: { weekly: 242, monthlyActive: 456, monthly: 626, rare: 39, dead: 64 },
  topCategories: [
    { name: "Társadalom és kultúra", pods: 265, eps: 28630 },
    { name: "Hírek és politika", pods: 124, eps: 14140 },
    { name: "Vallás és spiritualitás", pods: 126, eps: 12919 },
    { name: "Film, TV és popkultúra", pods: 102, eps: 11581 },
    { name: "Sport", pods: 67, eps: 8002 },
    { name: "Zene", pods: 78, eps: 7598 },
    { name: "Üzlet és pénzügy", pods: 103, eps: 6240 },
    { name: "Technológia", pods: 50, eps: 4819 },
    { name: "Könyvek és irodalom", pods: 41, eps: 4620 },
    { name: "Önfejlesztés", pods: 57, eps: 3300 },
    { name: "Oktatás", pods: 51, eps: 2424 },
    { name: "Egészség és életmód", pods: 49, eps: 1989 },
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
  // Top recurring voices — hostok + visszatérő vendégek együtt.
  topVoices: [
    { slug: "horvath-oszkar", name: "Horváth Oszkár", eps: 1400, pods: 10, wiki: false },
    { slug: "puzser-robert", name: "Puzsér Róbert", eps: 1383, pods: 35, wiki: true },
    { slug: "kovacs-gergely", name: "Kovács Gergely", eps: 585, pods: 18, wiki: true },
    { slug: "bochkor-gabor", name: "Bochkor Gábor", eps: 491, pods: 1, wiki: true },
    { slug: "magyar-david", name: "Magyar Dávid", eps: 393, pods: 6, wiki: false },
    { slug: "csunderlik-peter", name: "Csunderlik Péter", eps: 366, pods: 13, wiki: false },
    { slug: "orban-viktor", name: "Orbán Viktor", eps: 329, pods: 23, wiki: true },
    { slug: "tarjanyi-peter", name: "Tarjányi Péter", eps: 199, pods: 8, wiki: false },
    { slug: "spiro-gyorgy", name: "Spiró György", eps: 171, pods: 12, wiki: false },
    { slug: "magyar-peter", name: "Magyar Péter", eps: 141, pods: 27, wiki: true },
  ],
  topOrgs: [
    { slug: "tilos-radio", name: "Tilos Rádió", type: "Rádió", eps: 1607 },
    { slug: "inforadio", name: "InfoRádió", type: "Rádió", eps: 999 },
    { slug: "atv", name: "ATV", type: "Média", eps: 831 },
    { slug: "infostart-hu", name: "Infostart.hu", type: "Média", eps: 779 },
    { slug: "europai-unio", name: "Európai Unió", type: "Intézmény", eps: 745 },
    { slug: "nba", name: "NBA", type: "Sport liga", eps: 690 },
    { slug: "otp-bank", name: "OTP Bank", type: "Vállalat", eps: 606 },
    { slug: "kossuth-radio", name: "Kossuth Rádió", type: "Rádió", eps: 480 },
    { slug: "hvg", name: "HVG", type: "Média", eps: 468 },
    { slug: "klubradio", name: "Klubrádió", type: "Rádió", eps: 449 },
  ],
  topParties: [
    { slug: "fidesz", name: "Fidesz", eps: 1126 },
    { slug: "tisza-part", name: "Tisza Párt", eps: 718 },
    { slug: "dk", name: "DK", eps: 199 },
    { slug: "momentum", name: "Momentum", eps: 135 },
    { slug: "mszp", name: "MSZP", eps: 132 },
    { slug: "mi-hazank", name: "Mi Hazánk", eps: 114 },
  ],
  // dow rows Mon..Sun, columns: éjszaka(0-5), reggel(6-9), délelőtt(10-13), délután(14-17), este(18-21), késő(22-23)
  heatmap: {
    cols: ["0–5", "6–9", "10–13", "14–17", "18–21", "22–23"],
    rows: [
      { day: "Hét",  vals: [673, 1277, 861, 1212, 643, 89] },
      { day: "Kedd", vals: [480, 1215, 1088, 1276, 660, 110] },
      { day: "Szer", vals: [602, 1163, 840, 1134, 429, 123] },
      { day: "Csüt", vals: [620, 1361, 933, 1431, 566, 99] },
      { day: "Pén",  vals: [725, 1277, 884, 1041, 547, 45] },
      { day: "Szom", vals: [361, 609, 539, 544, 354, 78] },
      { day: "Vas",  vals: [394, 729, 587, 507, 477, 178] },
    ],
  },
  // Új podcastok első epizódja szerinti hónap (utolsó 24 hónap, HU feedek).
  newPodsByMonth: [
    { m: "2024-06", c: 11 }, { m: "2024-07", c: 7 }, { m: "2024-08", c: 6 }, { m: "2024-09", c: 15 },
    { m: "2024-10", c: 10 }, { m: "2024-11", c: 16 }, { m: "2024-12", c: 13 }, { m: "2025-01", c: 13 },
    { m: "2025-02", c: 17 }, { m: "2025-03", c: 20 }, { m: "2025-04", c: 17 }, { m: "2025-05", c: 16 },
    { m: "2025-06", c: 11 }, { m: "2025-07", c: 18 }, { m: "2025-08", c: 15 }, { m: "2025-09", c: 19 },
    { m: "2025-10", c: 30 }, { m: "2025-11", c: 18 }, { m: "2025-12", c: 18 }, { m: "2026-01", c: 17 },
    { m: "2026-02", c: 29 }, { m: "2026-03", c: 29 }, { m: "2026-04", c: 14 }, { m: "2026-05", c: 8 },
  ],
};

// derived
const growth10y = (STATS.episodesYear["2025"] / STATS.episodesYear["2015"]).toFixed(1);
const yoy2025 = (((STATS.episodesYear["2025"] - STATS.episodesYear["2024"]) / STATS.episodesYear["2024"]) * 100).toFixed(1);
const projected2026 = Math.round((STATS.episodesYear["2026 (eddig, 5 hó)"] / 147) * 365);
const top4CategoryShare = (((265 + 126 + 124 + 103) / STATS.podcastCount) * 100).toFixed(0);

const maxYear = Math.max(...Object.values(STATS.episodesYear));
const maxWeek = Math.max(...STATS.weekday.map((d) => d.eps));
const maxCat = STATS.topCategories[0].count;
const top10Topics = STATS.topTopics.slice(0, 10);
const maxTop10Topic = top10Topics[0].eps;

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

          {/* Hero metric cards */}
          <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-3">
            <HeroMetric value={STATS.podcastCount.toLocaleString("hu-HU")} label="aktív műsor" />
            <HeroMetric value={STATS.episodeCount.toLocaleString("hu-HU")} label="epizód" />
            <HeroMetric value={`${growth10y}×`} label="növekedés 2015 óta" />
            <HeroMetric value="~90" label="napi új epizód" />
          </div>
        </header>

        {/* NEW: Mit mutatnak az adatok? */}
        <section className="mb-12">
          <h2 className="mb-6 font-serif text-2xl md:text-3xl font-bold text-foreground">Mit mutatnak az adatok?</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InsightCard
              n={1}
              title="A magyar podcast már médiapiaci tényező"
              body={`Napi közel 90 új magyar epizód, ${STATS.episodeCount.toLocaleString("hu-HU")} indexelt adás.`}
            />
            <InsightCard
              n={2}
              title="A piac nő, de kevés műsor működik heti ritmusban"
              body={`${STATS.podcastCount.toLocaleString("hu-HU")} aktív podcastből ${STATS.tiers.weekly} jelenik meg heti vagy gyakoribb rendszerességgel.`}
            />
            <InsightCard
              n={3}
              title="A magyar podcast közéleti és kulturális fókuszú"
              body="A top témák között Biblia, választás, zene, mesterséges intelligencia és háború szerepel."
            />
            <InsightCard
              n={4}
              title="A podcast a hagyományos média vakfoltja"
              body="Sok fontos beszélgetés eddig nehezen kereshető és nehezen elemezhető volt a magyar nyilvánosságban."
            />
            <InsightCard
              n={5}
              title="A Podiverzum ezt a vakfoltot teszi kereshetővé"
              body="Epizódok, témák, közszereplők és szervezetek összekapcsolva — strukturált térkép a magyar podcastnyilvánosságról."
              wide
            />
          </div>
        </section>

        {/* Growth chart */}
        <section className="mb-12">
          <h2 className="mb-2 font-serif text-2xl font-bold text-foreground">Tíz év alatt {growth10y}-szeres növekedés</h2>
          <p className="mb-6 text-muted-foreground">
            A magyar podcast termelés 2015 óta minden évben nőtt. 2025-ben{" "}
            <strong className="text-foreground">+{yoy2025}%</strong> volt az éves növekedés, 2026-ban a jelenlegi ütem alapján{" "}
            <strong className="text-foreground">~{projected2026.toLocaleString("hu-HU")} új epizód</strong> várható.
          </p>
          <div className="space-y-2">
            {Object.entries(STATS.episodesYear).map(([year, eps]) => {
              const isBreak = year === "2020" || year === "2021";
              const is2026 = year.startsWith("2026");
              return (
                <div key={year} className="flex items-center gap-3">
                  <div className="w-32 shrink-0 text-sm text-muted-foreground">{year}</div>
                  <div className="flex-1 relative h-7 rounded bg-muted overflow-hidden">
                    <div
                      className={`h-full transition-all ${isBreak ? "bg-accent" : is2026 ? "bg-primary/50" : "bg-primary/80"}`}
                      style={{ width: `${(eps / maxYear) * 100}%` }}
                    />
                    <div className="absolute inset-0 flex items-center px-2 text-xs font-semibold text-foreground">
                      {eps.toLocaleString("hu-HU")}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <Callout title="2020–2021: áttörési pont">Járvány + Spotify HU launch — a termelés három év alatt megnégyszereződik.</Callout>
            <Callout title={`2026 várható: ~${projected2026.toLocaleString("hu-HU")} új epizód`}>Ha az első öt hónap üteme tartható, idén minden korábbi évet meghalad a magyar piac.</Callout>
          </div>
        </section>

        {/* Market pyramid */}
        <section className="mb-12">
          <h2 className="mb-2 font-serif text-2xl font-bold text-foreground">Kevés heti műsor, nagy hosszú farok</h2>
          <p className="mb-6 text-muted-foreground">
            A {STATS.podcastCount.toLocaleString("hu-HU")} aktív magyar podcastből mindössze{" "}
            <strong className="text-foreground">{STATS.tiers.weekly} jelenik meg heti vagy gyakoribb rendszerességgel</strong>.
            Ez a réteg adja a magyar podcastpiac rendszeresen frissülő, szerkesztett magját. Alattuk széles, havi és ritkább ritmusú „hosszú farok" húzódik.
          </p>
          <PyramidRow label="Heti+ műsorok" count={STATS.tiers.weekly} total={STATS.podcastCount} note="Heti vagy gyakoribb publikálás" emphasis />
          <PyramidRow label="Aktív havi műsorok" count={STATS.tiers.monthlyActive} total={STATS.podcastCount} note="Havi 2–4 epizód" />
          <PyramidRow label="Havi körüli műsorok" count={STATS.tiers.monthly} total={STATS.podcastCount} note="Havi 1 körüli ritmus" />
          <PyramidRow label="Ritkán frissülők" count={STATS.tiers.rare} total={STATS.podcastCount} note="Negyedéves vagy ritkább" />
          <PyramidRow label="Elhalt feedek" count={STATS.tiers.dead} total={STATS.podcastCount} note="12+ hónapja néma" muted />
        </section>

        {/* Topics — what we talk about */}
        <section className="mb-12">
          <h2 className="mb-2 font-serif text-2xl font-bold text-foreground">Miről beszél a magyar podcastnyilvánosság?</h2>
          <p className="mb-6 text-muted-foreground">
            Az AI által azonosított top 10 beszélgetési téma az elmúlt 12 hónap epizódjaiban.
          </p>
          <div className="space-y-2 mb-4">
            {top10Topics.map((t, i) => {
              const highlight = ["biblia", "valasztas", "mesterseges-intelligencia"].includes(t.slug);
              return (
                <Link
                  key={t.slug}
                  to={`/temak/${t.slug}`}
                  className="flex items-center gap-3 group"
                >
                  <div className="w-6 shrink-0 text-xs font-mono text-muted-foreground">{i + 1}.</div>
                  <div className="w-40 md:w-56 shrink-0 text-sm font-medium text-foreground group-hover:text-primary truncate">{t.name}</div>
                  <div className="flex-1 relative h-6 rounded bg-muted overflow-hidden">
                    <div
                      className={`h-full ${highlight ? "bg-primary/80" : "bg-accent/60"}`}
                      style={{ width: `${(t.eps / maxTop10Topic) * 100}%` }}
                    />
                    <div className="absolute inset-0 flex items-center px-2 text-xs font-semibold text-foreground">
                      {t.eps} ep
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
          <p className="text-sm italic text-muted-foreground border-l-2 border-primary pl-3">
            2026-ban a Biblia (130) és a választás (123) együtt több azonosított epizódtémát adtak, mint a mesterséges intelligencia (92).
          </p>
        </section>

        {/* Categories */}
        <section className="mb-12">
          <h2 className="mb-2 font-serif text-2xl font-bold text-foreground">Mit hallgatunk? — kategóriák</h2>
          <p className="mb-6 text-muted-foreground">
            A magyar podcast piac négy meghatározó pilléren áll: társadalom-kultúra, vallás, közélet és üzlet. Ez a négy adja a kínálat <strong className="text-foreground">{top4CategoryShare}%-át</strong>.
          </p>
          <div className="space-y-2">
            {STATS.topCategories.map((cat) => (
              <div key={cat.name} className="flex items-center gap-3">
                <div className="w-40 md:w-48 shrink-0 text-sm text-foreground">{cat.name}</div>
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

        {/* Publishing week */}
        <section className="mb-12">
          <h2 className="mb-2 font-serif text-2xl font-bold text-foreground">Mikor jelennek meg az új epizódok?</h2>
          <p className="mb-6 text-muted-foreground">
            A magyar podcast szerkesztőségek jellemzően <strong className="text-foreground">csütörtökön és hétfőn publikálnak</strong>. Hétvégén a frissítés visszaesik a felére.
          </p>
          <div className="space-y-2 mb-4">
            {STATS.weekday.map((d) => {
              const highlight = d.name === "Csütörtök" || d.name === "Hétfő";
              return (
                <div key={d.name} className="flex items-center gap-3">
                  <div className="w-24 shrink-0 text-sm text-foreground">{d.name}</div>
                  <div className="flex-1 relative h-6 rounded bg-muted overflow-hidden">
                    <div
                      className={`h-full ${highlight ? "bg-primary/80" : "bg-primary/40"}`}
                      style={{ width: `${(d.eps / maxWeek) * 100}%` }}
                    />
                    <div className="absolute inset-0 flex items-center px-2 text-xs font-semibold text-foreground">
                      {d.eps.toLocaleString("hu-HU")} ep (2025)
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-sm italic text-muted-foreground border-l-2 border-primary pl-3">
            A magyar podcastoknak már felismerhető heti szerkesztési ritmusa van.
          </p>
        </section>

        {/* Media map */}
        <section className="mb-12">
          <h2 className="mb-2 font-serif text-2xl font-bold text-foreground">A magyar podcastok rejtett médiatérképe</h2>
          <p className="mb-6 text-muted-foreground">
            A Podiverzum nemcsak epizódokat listáz, hanem kereshetővé teszi, kikről, miről és milyen összefüggésben beszélnek a magyar podcastok.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MapNode value={STATS.episodeCount.toLocaleString("hu-HU")} label="epizód" />
            <MapNode value={STATS.peopleIndexed.toLocaleString("hu-HU")} label="közszereplő" link="/szemelyek" />
            <MapNode value={STATS.organizationsIndexed.toLocaleString("hu-HU")} label="szervezet" link="/szervezetek" />
            <MapNode value={`${top10Topics.length}+`} label="top témák" link="/temak" />
          </div>
        </section>

        {/* Pullquote */}
        <section className="mb-12">
          <blockquote className="border-l-4 border-primary pl-6 py-4 font-serif text-xl md:text-2xl italic text-foreground leading-relaxed">
            „A magyar podcastpiac már nem hobbiműfaj, hanem gyorsan növekvő, de eddig alig mérhető nyilvánossági tér."
          </blockquote>
        </section>

        {/* What it means */}
        <section className="mb-12 rounded-lg bg-muted/40 p-6">
          <h2 className="mb-3 font-serif text-2xl font-bold text-foreground">Mit jelent mindez?</h2>
          <div className="space-y-3 text-foreground">
            <p>
              A magyar podcast piac <strong>nem hobbiműfaj többé</strong>: napi közel 90 új epizód, évi több mint 25 ezer adás, közel másfél ezer aktív műsor. A nyilvánosság jelentős része — különösen a 25–45 éves korosztály — már nem a televízióból, hanem a fülhallgatóból tájékozódik.
            </p>
            <p>
              Eközben a podcastok tartalma <strong>strukturálatlan, kereshetetlen, és láthatatlan a hagyományos médiában</strong>: nem kerülnek be a hírügynökségi archívumokba, nem indexeli őket a Google érdemben, és a közéleti viták egy nagy része kontroll nélkül zajlik a hallgatók fülében.
            </p>
            <p>
              A Podiverzum ezt az átláthatatlanságot bontja le: <strong>minden epizód szövegét AI elemzi</strong>, kinyeri a szereplőket, témákat, állításokat, és kereshetővé teszi.
            </p>
          </div>
        </section>

        {/* Press box */}
        <section className="mb-12 rounded-lg border-2 border-primary/40 bg-card p-6">
          <div className="text-xs uppercase tracking-widest text-primary mb-2">Sajtó / kutatás</div>
          <h2 className="font-serif text-xl font-bold text-foreground mb-3">Adatkérések és sajtómegkeresések</h2>
          <p className="text-muted-foreground mb-4">
            Adatkérések, interaktív elemzések és sajtómegkeresések: <a href="mailto:hello@podiverzum.hu" className="text-primary underline">hello@podiverzum.hu</a>
          </p>
          <a
            href="mailto:hello@podiverzum.hu?subject=Sajt%C3%B3megkeres%C3%A9s%20%E2%80%94%20Podiverzum%20jelent%C3%A9s%202026"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition"
          >
            Kapcsolatfelvétel →
          </a>
        </section>

        {/* Methodology */}
        <section className="mb-12 border-t border-border pt-8">
          <h2 className="mb-3 font-serif text-xl font-bold text-foreground">Módszertan</h2>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              <strong className="text-foreground">Adatforrás:</strong> A Podiverzum.hu folyamatosan figyeli a Podcast Index és az Apple Podcasts katalógusokat,
              valamint a YouTube magyar podcast csatornáit. „Magyar podcast" = a feed metaadataiban magyar nyelv jelölve (`language=hu*`), vagy AI nyelvazonosítás szerint dominánsan magyar tartalom.
            </p>
            <p>
              <strong className="text-foreground">Aktív műsor:</strong> {STATS.podcastCount} aktív magyar podcast = legalább 1 publikált epizóddal rendelkező, nyilvánosan elérhető RSS feed, 2026. május 27-i állapot szerint.
            </p>
            <p>
              <strong className="text-foreground">Kategorizálás:</strong> Az iTunes/Apple taxonómiát követjük, megerősítve egy belső AI besorolóval (Google Gemini 2.5 modell, 21-kategóriás magyar taxonómia).
            </p>
            <p>
              <strong className="text-foreground">Téma-azonosítás:</strong> Minden epizód transcript-ből kinyert beszélgetési témák, dedupolva és normalizálva. „Téma" ≠ kategória.
            </p>
            <p>
              <strong className="text-foreground">Publikálási ritmus szerinti csoportosítás:</strong> Belső pontrendszer, ami az adott podcast átlagos havi epizód-számát súlyozza a frissesség és aktivitás függvényében. A jelentésben szereplő nyilvános címkék (Heti+, Aktív havi, Havi körüli, Ritkán frissülő, Elhalt) ezen alapulnak. Részletek: <Link to="/modszertan" className="underline hover:text-foreground">módszertan</Link>.
            </p>
            <p>
              <strong className="text-foreground">Közszereplők és szervezetek:</strong> Az AI extraktor (Gemini 2.5) minden epizód clean-text átiratából kinyeri az említett embereket és szervezeteket. Wikipédia/Wikidata alapú azonosítás.
            </p>
            <p>
              <strong className="text-foreground">Korlátok:</strong> A katalógus nem teljes — kis kalózpodcastok, magán Discord-szerverek, YouTube-csak-streamek nem kerülnek be. Hallgatottsági (letöltés- / play-) adatokat ez a jelentés nem tartalmaz: a számok kínálati, nem keresleti oldalt mérnek.
            </p>
            <p className="pt-2 text-xs">
              Sajtó / kutatás kérések: <a href="mailto:hello@podiverzum.hu" className="text-primary underline">hello@podiverzum.hu</a>
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

function HeroMetric({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 text-center">
      <div className="text-2xl md:text-3xl font-bold text-foreground leading-tight">{value}</div>
      <div className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

function InsightCard({ n, title, body, wide }: { n: number; title: string; body: string; wide?: boolean }) {
  return (
    <div className={`rounded-lg border border-border bg-card p-5 ${wide ? "md:col-span-2" : ""}`}>
      <div className="text-xs font-mono text-primary mb-2">#{n.toString().padStart(2, "0")}</div>
      <h3 className="font-serif text-lg font-bold text-foreground mb-2 leading-snug">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}

function Callout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border-l-2 border-accent bg-muted/40 px-3 py-2">
      <div className="text-xs font-semibold text-foreground">{title}</div>
      <div className="text-xs text-muted-foreground mt-1">{children}</div>
    </div>
  );
}

function PyramidRow({ label, count, total, note, emphasis, muted }: { label: string; count: number; total: number; note: string; emphasis?: boolean; muted?: boolean }) {
  const widthPct = Math.max(8, (count / total) * 100 * 2.2); // visual amplification for pyramid feel
  return (
    <div className="mb-2 flex flex-col md:flex-row md:items-center gap-1 md:gap-3">
      <div className="md:w-48 shrink-0 text-sm font-medium text-foreground">
        {label}
        <span className="ml-2 text-xs text-muted-foreground font-normal">{note}</span>
      </div>
      <div className="flex-1 flex items-center gap-2">
        <div className="flex-1 relative h-8 rounded bg-muted overflow-hidden">
          <div
            className={`h-full mx-auto ${emphasis ? "bg-primary" : muted ? "bg-muted-foreground/30" : "bg-primary/50"}`}
            style={{ width: `${Math.min(100, widthPct)}%`, marginLeft: "auto", marginRight: "auto" }}
          />
          <div className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-foreground">
            {count.toLocaleString("hu-HU")} műsor
          </div>
        </div>
      </div>
    </div>
  );
}

function MapNode({ value, label, link }: { value: string; label: string; link?: string }) {
  const inner = (
    <div className="rounded-lg border border-border bg-card p-5 text-center h-full hover:border-primary transition">
      <div className="text-2xl md:text-3xl font-bold text-foreground">{value}</div>
      <div className="mt-2 text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
  return link ? <Link to={link}>{inner}</Link> : inner;
}
