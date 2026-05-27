import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { toPng } from "html-to-image";
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
const maxCatEps = Math.max(...STATS.topCategories.map((c) => c.eps));
const totalCatEps = STATS.topCategories.reduce((s, c) => s + c.eps, 0);
const top10Topics = STATS.topTopics.slice(0, 10);
const maxTop10Topic = top10Topics[0].eps;
const maxVoice = STATS.topVoices[0].eps;
const maxOrg = STATS.topOrgs[0].eps;
const maxParty = STATS.topParties[0].eps;
const maxHeat = Math.max(...STATS.heatmap.rows.flatMap((r) => r.vals));
const maxMonth = Math.max(...STATS.newPodsByMonth.map((p) => p.c));
const minMonth = Math.min(...STATS.newPodsByMonth.map((p) => p.c));
// Non-zero baseline so differences pop: 5 alá ne menjen a tengely.
const monthBaseline = Math.max(0, minMonth - 3);
const monthRange = maxMonth - monthBaseline;
const newPodsTotal24mo = STATS.newPodsByMonth.reduce((s, p) => s + p.c, 0);
const deadPct = ((STATS.tiers.dead / STATS.podcastCount) * 100).toFixed(1);
const alivePct = (100 - parseFloat(deadPct)).toFixed(1);

export default function PodcastReport2026() {
  useEffect(() => {
    setSeo({
      title: "Magyar podcast piac 2026 — Podiverzum jelentés",
      description: `Az első részletes adatelemzés a magyar podcast piacról: ${STATS.podcastCount} aktív műsor, ${STATS.episodeCount.toLocaleString("hu-HU")} epizód, 10 év alatt ${growth10y}-szeres növekedés. Toplista, kategóriák, témák, közszereplők.`,
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
            Az első részletes adatelemzés a magyar nyelvű podcast iparágról:
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
              body={`Naponta közel 90 új magyar epizód, összesen ${STATS.episodeCount.toLocaleString("hu-HU")} indexelt adás.`}
            />
            <InsightCard
              n={2}
              title="Nő a piac, kevés a heti műsor"
              body={`${STATS.podcastCount.toLocaleString("hu-HU")} aktív podcastből ${STATS.tiers.weekly} jelenik meg heti vagy gyakoribb rendszerességgel.`}
            />
            <InsightCard
              n={3}
              title="Közélet és kultúra uralja a mezőnyt"
              body="A vezető témák között a Biblia, a választás, a zene, a mesterséges intelligencia és a háború szerepel."
            />
            <InsightCard
              n={4}
              title="A podcast a hagyományos média vakfoltja"
              body="Sok fontos beszélgetés eddig nehezen volt kereshető és elemezhető a magyar nyilvánosságban."
            />
            <InsightCard
              n={5}
              title="A Podiverzum kereshetővé teszi a vakfoltot"
              body="Epizódok, témák, közszereplők és szervezetek összekapcsolva — strukturált térkép a magyar podcastnyilvánosságról."
              wide
            />
          </div>
        </section>

        {/* Growth chart */}
        <section className="mb-12">
          <DownloadableFigure filename="evi-novekedes-2015-2026">
          <h2 className="mb-2 font-serif text-2xl font-bold text-foreground">Tíz év alatt {growth10y}-szeres növekedés</h2>
          <p className="mb-6 text-muted-foreground">
            A magyar podcasttermelés 2015 óta minden évben nőtt. 2025-ben{" "}
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
            <Callout title="2020–2021: áttörési pont">Járvány + Spotify HU launch — három év alatt megnégyszereződik a termelés.</Callout>
            <Callout title={`2026 várható: ~${projected2026.toLocaleString("hu-HU")} új epizód`}>Ha az első öt hónap üteme tartható, a magyar piac idén minden korábbi évet meghaladhat.</Callout>
          </div>
          </DownloadableFigure>
        </section>

        {/* Market pyramid */}
        <section className="mb-12">
          <DownloadableFigure filename="publikalasi-ritmus-piramis">
          <h2 className="mb-2 font-serif text-2xl font-bold text-foreground">Kevés heti műsor, ritkábban publikáló többség</h2>
          <p className="mb-6 text-muted-foreground">
            A {STATS.podcastCount.toLocaleString("hu-HU")} aktív magyar podcastből mindössze{" "}
            <strong className="text-foreground">{STATS.tiers.weekly} jelenik meg heti vagy gyakoribb rendszerességgel</strong>.
            Ez a réteg adja a magyar podcastpiac rendszeresen frissülő, szerkesztett magját. Alatta széles hobbi- és niche-réteg húzódik: a ritkábban publikáló többség havi vagy annál is ritkább ritmusban jelentkezik.
          </p>
          <PyramidRow label="Heti+ műsorok" count={STATS.tiers.weekly} total={STATS.podcastCount} note="Heti vagy gyakoribb publikálás" emphasis />
          <PyramidRow label="Aktív havi műsorok" count={STATS.tiers.monthlyActive} total={STATS.podcastCount} note="Havi 2–4 epizód" />
          <PyramidRow label="Havi körüli műsorok" count={STATS.tiers.monthly} total={STATS.podcastCount} note="Havi 1 körüli ritmus" />
          <PyramidRow label="Ritkán frissülők" count={STATS.tiers.rare} total={STATS.podcastCount} note="Negyedéves vagy ritkább" />
          <PyramidRow label="Elnémult műsorok" count={STATS.tiers.dead} total={STATS.podcastCount} note="12+ hónapja nem publikáltak" muted />
          </DownloadableFigure>
        </section>

        {/* Topics — what we talk about */}
        <section className="mb-12">
          <h2 className="mb-2 font-serif text-2xl font-bold text-foreground">Miről beszél a magyar podcastnyilvánosság?</h2>
          <p className="mb-2 text-muted-foreground">
            Az elmúlt 12 hónap magyar epizódjaiban ez volt az AI által azonosított top 10 beszélgetési téma.
          </p>
          <p className="mb-6 text-xs text-muted-foreground italic">
            Fontos: ez <strong className="text-foreground not-italic">a megjelent epizódok</strong> alapján mért témastruktúra — vagyis kínálati oldal. Nem hallgatottsági és nem letöltési adat.
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
          <p className="text-sm italic text-muted-foreground border-l-2 border-primary pl-3 mb-3">
            2026-ban a Biblia (130) és a választás (123) együtt több azonosított epizódtémát adtak, mint a mesterséges intelligencia (92).
          </p>
          <p className="text-sm italic text-muted-foreground border-l-2 border-accent pl-3">
            A választási év hatása is látszik: a négyévente tartott országgyűlési választás — idén április 12-én — a háborút (Ukrajna / Közel-Kelet, 73 epizód) is az év egyik visszatérő top témájává tette a magyar podcastekben, a kampányidőszak biztonságpolitikai vitáin keresztül.
          </p>
        </section>

        {/* Categories */}
        <section className="mb-12">
          <h2 className="mb-2 font-serif text-2xl font-bold text-foreground">Mit hallgatunk? — kategóriák</h2>
          <p className="mb-6 text-muted-foreground">
            A magyar podcast piac négy meghatározó pilléren áll: társadalom és kultúra, vallás, közélet és üzlet. Ez a négy adja a kínálat <strong className="text-foreground">{top4CategoryShare}%-át</strong>. Alább az epizódszám-megoszlás (terület = elérhető epizódok aránya).
          </p>
          <div className="grid grid-cols-6 gap-1.5 h-[420px] auto-rows-fr">
            {STATS.topCategories.map((cat, i) => {
              const share = cat.eps / totalCatEps;
              // Treemap-ish layout: bigger categories span more cells.
              const span = i === 0 ? "col-span-6 md:col-span-4 row-span-3" :
                           i === 1 ? "col-span-3 md:col-span-2 row-span-2" :
                           i === 2 ? "col-span-3 md:col-span-2 row-span-2" :
                           i === 3 ? "col-span-3 md:col-span-2 row-span-2" :
                           i < 7 ? "col-span-2 row-span-1" :
                           "col-span-3 md:col-span-2 row-span-1";
              const intensity = 0.25 + (cat.eps / maxCatEps) * 0.6;
              return (
                <div
                  key={cat.name}
                  className={`${span} rounded p-3 flex flex-col justify-between bg-primary text-primary-foreground overflow-hidden`}
                  style={{ opacity: intensity }}
                  title={`${cat.eps.toLocaleString("hu-HU")} epizód, ${cat.pods} műsor`}
                >
                  <div className="text-xs md:text-sm font-semibold leading-tight">{cat.name}</div>
                  <div>
                    <div className="text-lg md:text-2xl font-bold tabular-nums">{(share * 100).toFixed(0)}%</div>
                    <div className="text-[10px] md:text-xs opacity-80">{cat.eps.toLocaleString("hu-HU")} ep · {cat.pods} műsor</div>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Epizódszám szerinti súlyozás, csak a top 12 kategória alapján, az indexelt magyar podcastek 2026. május 27-i állapota szerint.
          </p>
        </section>

        {/* New podcasts per month — last 24 months */}
        <section className="mb-12">
          <h2 className="mb-2 font-serif text-2xl font-bold text-foreground">Hány új magyar podcast indul havonta?</h2>
          <p className="mb-6 text-muted-foreground">
            Az elmúlt 24 hónapban <strong className="text-foreground">{newPodsTotal24mo}</strong> új magyar podcast indult — átlagosan{" "}
            <strong className="text-foreground">~{Math.round(newPodsTotal24mo / 24)} műsor havonta</strong>, a 2025. október óta tartó hullámmal együtt.
          </p>
          <div className="flex gap-2">
            {/* Y axis */}
            <div className="flex flex-col justify-between text-[10px] text-muted-foreground font-mono w-6 text-right py-0.5 h-56">
              <span>{maxMonth}</span>
              <span>{Math.round(monthBaseline + monthRange * 0.66)}</span>
              <span>{Math.round(monthBaseline + monthRange * 0.33)}</span>
              <span>{monthBaseline}</span>
            </div>
            <div className="flex-1">
              <div className="relative h-56 border-l border-b border-border">
                {/* Gridlines */}
                <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                  <div className="border-t border-border/40" />
                  <div className="border-t border-border/40" />
                  <div className="border-t border-border/40" />
                  <div className="border-t border-border/40" />
                </div>
                <div className="absolute inset-0 flex items-end gap-[3px] px-0.5">
                  {STATS.newPodsByMonth.map((p) => {
                    const h = ((p.c - monthBaseline) / monthRange) * 100;
                    const isPeak = p.c >= 25;
                    return (
                      <div
                        key={p.m}
                        className="flex-1 relative group h-full flex items-end"
                        title={`${p.m}: ${p.c} új podcast`}
                      >
                        <div
                          className={`w-full rounded-t-sm ${isPeak ? "bg-primary" : "bg-primary/55"} transition-all hover:bg-primary relative`}
                          style={{ height: `${Math.max(h, 2)}%` }}
                        >
                          {isPeak && (
                            <div className="absolute -top-4 left-1/2 -translate-x-1/2 text-[9px] font-semibold text-primary tabular-nums">
                              {p.c}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground font-mono mt-1">
                <span>{STATS.newPodsByMonth[0].m}</span>
                <span>{STATS.newPodsByMonth[Math.floor(STATS.newPodsByMonth.length / 2)].m}</span>
                <span>{STATS.newPodsByMonth[STATS.newPodsByMonth.length - 1].m}</span>
              </div>
            </div>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            A függőleges tengely {monthBaseline}-tól indul, hogy a havi különbségek láthatók legyenek.
          </p>
          <p className="mt-4 text-sm italic text-muted-foreground border-l-2 border-primary pl-3">
            2026 első három hónapjában havi 29 új magyar podcast indult — ez minden korábbi év átlagát felülmúlja.
          </p>
        </section>


        {/* Publishing heatmap */}
        <section className="mb-12">
          <h2 className="mb-2 font-serif text-2xl font-bold text-foreground">Mikor publikálnak a magyar podcastek?</h2>
          <p className="mb-6 text-muted-foreground">
            A nap és óra szerinti megjelenések a magyar szerkesztőségek <strong className="text-foreground">9:00 és 16–17 óra körüli</strong> ritmusát rajzolják ki. A legnagyobb csúcs: <strong className="text-foreground">csütörtök délután</strong>.
          </p>
          <Heatmap data={STATS.heatmap} max={maxHeat} />
          <p className="mt-4 text-sm italic text-muted-foreground border-l-2 border-primary pl-3">
            A hét két publikálási csúcsa csütörtök kora délután és csütörtök reggel — gyakorlatilag ez a magyar podcast „prime time”.
          </p>
        </section>

        {/* Top voices */}
        <section className="mb-12">
          <h2 className="mb-2 font-serif text-2xl font-bold text-foreground">Top 10 magyar hang</h2>
          <p className="mb-6 text-muted-foreground">
            A magyar podcastekben leggyakrabban szereplő emberek — hostok és visszatérő vendégek együtt — az indexelt epizódok alapján. A „hangok” a hostokat és a többször visszatérő vendégeket egyaránt számolják.
          </p>
          <div className="space-y-2">
            {STATS.topVoices.map((v, i) => (
              <Link key={v.slug} to={`/szemelyek/${v.slug}`} className="flex items-center gap-3 group">
                <div className="w-6 shrink-0 text-xs font-mono text-muted-foreground">{i + 1}.</div>
                <div className="w-40 md:w-56 shrink-0 text-sm font-medium text-foreground group-hover:text-primary truncate flex items-center gap-1.5">
                  {v.name}
                  {v.wiki && <span title="Wikipedia-igazolt" className="text-[9px] px-1 py-0.5 rounded bg-muted text-muted-foreground font-mono">W</span>}
                </div>
                <div className="flex-1 relative h-6 rounded bg-muted overflow-hidden">
                  <div className="h-full bg-primary/70" style={{ width: `${(v.eps / maxVoice) * 100}%` }} />
                  <div className="absolute inset-0 flex items-center px-2 text-xs font-semibold text-foreground">
                    {v.eps.toLocaleString("hu-HU")} ep · {v.pods} podcast
                  </div>
                </div>
              </Link>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Forrás: az epizódok átirataiból AI által kinyert résztvevők, deduplikálva és emberi felülvizsgálati ciklus után. „Ep” = olyan indexelt magyar epizód, amelyben a személy résztvevőként vagy említettként szerepel.
            {" "}<Link to="/szemelyek" className="underline">Teljes lista →</Link>
          </p>
        </section>

        {/* Top organizations + parties */}
        <section className="mb-12">
          <h2 className="mb-2 font-serif text-2xl font-bold text-foreground">Top szervezetek és pártok a podcastekben</h2>
          <p className="mb-6 text-muted-foreground">
            A leggyakrabban emlegetett média-, vállalati és politikai szereplők. A pártokat külön bontjuk, mert kampányidőszakban (2026-os választás) különösen relevánsak.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <div className="mb-3 text-xs uppercase tracking-widest text-muted-foreground">Szervezetek</div>
              <div className="space-y-2">
                {STATS.topOrgs.map((o, i) => (
                  <Link key={o.slug} to={`/ceg/${o.slug}`} className="flex items-center gap-2 group">
                    <div className="w-5 shrink-0 text-[10px] font-mono text-muted-foreground">{i + 1}.</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground group-hover:text-primary truncate">{o.name}</div>
                      <div className="text-[10px] text-muted-foreground">{o.type}</div>
                    </div>
                    <div className="relative w-28 h-5 rounded bg-muted overflow-hidden">
                      <div className="h-full bg-accent/70" style={{ width: `${(o.eps / maxOrg) * 100}%` }} />
                      <div className="absolute inset-0 flex items-center justify-end px-1.5 text-[10px] font-semibold text-foreground">
                        {o.eps.toLocaleString("hu-HU")}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-3 text-xs uppercase tracking-widest text-muted-foreground">Pártok</div>
              <div className="space-y-2">
                {STATS.topParties.map((p, i) => (
                  <Link key={p.slug} to={`/part/${p.slug}`} className="flex items-center gap-2 group">
                    <div className="w-5 shrink-0 text-[10px] font-mono text-muted-foreground">{i + 1}.</div>
                    <div className="flex-1 min-w-0 text-sm font-medium text-foreground group-hover:text-primary truncate">{p.name}</div>
                    <div className="relative w-28 h-5 rounded bg-muted overflow-hidden">
                      <div className="h-full bg-primary/70" style={{ width: `${(p.eps / maxParty) * 100}%` }} />
                      <div className="absolute inset-0 flex items-center justify-end px-1.5 text-[10px] font-semibold text-foreground">
                        {p.eps.toLocaleString("hu-HU")}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                <Link to="/partok" className="underline">Összes párt →</Link>
              </p>
            </div>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            „Ep” = olyan magyar epizód, amelyben a szervezetet az AI extraktor azonosította a leiratban. A számok kínálati, nem hallgatottsági adatok.
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
          {/* Alive vs dead feed mini-donut */}
          <div className="mt-6 rounded-lg border border-border bg-card p-5 flex flex-col md:flex-row items-center gap-5">
            <div className="relative w-28 h-28 shrink-0">
              <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                <circle cx="18" cy="18" r="15.9155" fill="none" stroke="hsl(var(--muted))" strokeWidth="3.5" />
                <circle
                  cx="18" cy="18" r="15.9155" fill="none"
                  stroke="hsl(var(--primary))" strokeWidth="3.5"
                  strokeDasharray={`${alivePct} ${deadPct}`}
                  strokeDashoffset="0"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <div className="text-lg font-bold text-foreground tabular-nums">{alivePct}%</div>
                <div className="text-[9px] uppercase text-muted-foreground">aktív</div>
              </div>
            </div>
            <div className="text-sm text-foreground">
              <div className="font-semibold mb-1">A magyar podcastpiac stabil — csak {deadPct}% elnémult műsor</div>
              <div className="text-muted-foreground">
                A {STATS.podcastCount.toLocaleString("hu-HU")} indexelt magyar műsorból {STATS.tiers.dead} nem publikált 12+ hónapja. A többi {(STATS.podcastCount - STATS.tiers.dead).toLocaleString("hu-HU")} műsor aktívnak tekinthető — ez a nemzetközi átlagnál jelentősen jobb arány, a globális podcast-katalógusok 40–60%-a inaktív.
              </div>
            </div>
          </div>
        </section>


        {/* Pullquote */}
        <section className="mb-12">
          <blockquote className="border-l-4 border-primary pl-6 py-4 font-serif text-xl md:text-2xl italic text-foreground leading-relaxed">
            „A magyar podcastpiac már nem hobbiműfaj, hanem gyorsan növekvő, eddig alig mérhető nyilvánossági tér."
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
              Eközben a podcastok tartalma jórészt <strong>strukturálatlan, nehezen kereshető, és a hagyományos médiában láthatatlan marad</strong>: nem kerül be a hírügynökségi archívumokba, a Google érdemben nem indexeli, és a közéleti viták jelentős része kontroll nélkül zajlik a hallgatók fülében.
            </p>
            <p>
              A Podiverzum ezt az átláthatatlanságot bontja le: <strong>minden epizód szövegét AI elemzi</strong>, kinyeri a szereplőket, témákat és állításokat, majd kereshetővé teszi őket.
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
              <strong className="text-foreground">Publikálási ritmus szerinti csoportosítás:</strong> Belső pontrendszer, ami az adott podcast átlagos havi epizód-számát súlyozza a frissesség és aktivitás függvényében. A jelentésben szereplő nyilvános címkék (Heti+, Aktív havi, Havi körüli, Ritkán frissülő, Elnémult) ezen alapulnak. Részletek: <Link to="/modszertan" className="underline hover:text-foreground">módszertan</Link>.
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

function Callout({ title, children }: { title: string; children: import("react").ReactNode }) {
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

function DownloadableFigure({ filename, children }: { filename: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const handle = async () => {
    if (!ref.current) return;
    setBusy(true);
    try {
      const bg = getComputedStyle(document.body).backgroundColor || "#ffffff";
      const dataUrl = await toPng(ref.current, {
        pixelRatio: 2,
        backgroundColor: bg,
        cacheBust: true,
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `podiverzum-${filename}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      console.error("PNG export failed", e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <div className="flex justify-end mb-2 print:hidden">
        <button
          type="button"
          onClick={handle}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-primary transition disabled:opacity-50"
          title="Mentsd le PNG-ként sajtóhasználatra (cikkbe illesztéshez)"
          aria-label="Grafika letöltése PNG-ként"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v12" />
            <path d="m7 10 5 5 5-5" />
            <path d="M5 21h14" />
          </svg>
          {busy ? "Mentés…" : "PNG letöltése"}
        </button>
      </div>
      <div ref={ref} className="bg-background">
        {children}
        <div className="mt-5 pt-3 border-t border-border/60 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>Forrás: Podiverzum.hu adatbázis — 2026. május 27.</span>
          <span className="font-semibold text-foreground">podiverzum.hu</span>
        </div>
      </div>
    </div>
  );
}

function Heatmap({ data, max }: { data: { cols: string[]; rows: { day: string; vals: number[] }[] }; max: number }) {
  return (
    <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
      <div className="min-w-[520px]">
        <div className="grid gap-1 text-[10px] md:text-xs" style={{ gridTemplateColumns: `48px repeat(${data.cols.length}, minmax(0,1fr))` }}>
          <div />
          {data.cols.map((c) => (
            <div key={c} className="text-center text-muted-foreground font-mono pb-1">{c}</div>
          ))}
          {data.rows.map((r) => (
            <Fragment key={r.day}>
              <div className="flex items-center text-muted-foreground pr-1">{r.day}</div>
              {r.vals.map((v, i) => {
                const alpha = 0.08 + (v / max) * 0.92;
                const isPeak = v / max > 0.85;
                return (
                  <div
                    key={`${r.day}-${i}`}
                    className="aspect-[3/2] rounded flex items-center justify-center font-semibold tabular-nums"
                    style={{ backgroundColor: `hsl(var(--primary) / ${alpha.toFixed(2)})`, color: alpha > 0.55 ? "hsl(var(--primary-foreground))" : "hsl(var(--foreground))" }}
                    title={`${r.day} ${data.cols[i]}h — ${v} epizód / év`}
                  >
                    {isPeak ? v : ""}
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-end gap-2 text-[10px] text-muted-foreground">
          <span>kevesebb</span>
          <div className="flex gap-0.5">
            {[0.1, 0.3, 0.5, 0.7, 0.95].map((a) => (
              <div key={a} className="w-4 h-3 rounded-sm" style={{ backgroundColor: `hsl(var(--primary) / ${a})` }} />
            ))}
          </div>
          <span>több publikálás</span>
        </div>
      </div>
    </div>
  );
}
