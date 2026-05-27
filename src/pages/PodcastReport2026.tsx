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
  // Kiszűrve: műsorvezetők, akik főleg saját műsorukban szerepelnek (Bochkor, Puzsér,
  // Horváth Oszkár, Rónai Egon, Fábry Kornél stb.). A listán csak olyan közéleti
  // szereplők, szakértők, politikusok maradnak, akik vendégként/témaként szerepelnek
  // több műsorban is — vagyis akikről beszélnek, nem akik beszélnek.
  // Forrás: person_episode_mentions (AI entity-resolution), 2025.06.01–2026.05.27, HU feedek.
  // Műsorvezetők kiszűrve (Puzsér, Rónai, Ceglédi, Pető, Csepelyi, Bochkor, Horváth).
  // Homonim találatok (Kovács Gergely érsek vs MKKP, Borbély Imre, Tóth Csaba, Szabó László,
  // Varga Zoltán, Németh Dávid stb.) is kihagyva — ahol a wiki-leírás nem egyezik a podcast-kontextussal.
  topVoices: [
    { slug: "orban-viktor",    name: "Orbán Viktor",    role: "miniszterelnök",            eps: 278, pods: 30 },
    { slug: "magyar-peter",    name: "Magyar Péter",    role: "politikus (Tisza)",         eps: 199, pods: 26 },
    { slug: "donald-trump",    name: "Donald Trump",    role: "USA elnöke",                eps: 102, pods: 31 },
    { slug: "ruff-balint",     name: "Ruff Bálint",     role: "jogász, politikai tanácsadó", eps: 52, pods: 11 },
    { slug: "gubik-petra",     name: "Gubik Petra",     role: "színésznő",                 eps: 51, pods: 4  },
    { slug: "pogatsa-zoltan",  name: "Pogátsa Zoltán",  role: "közgazdász, szociológus",   eps: 39, pods: 19 },
    { slug: "szijjarto-peter", name: "Szijjártó Péter", role: "külügyminiszter",           eps: 38, pods: 16 },
    { slug: "balasy-zsolt",    name: "Balásy Zsolt",    role: "kommunikációs szakértő",    eps: 33, pods: 16 },
    { slug: "keri-laszlo",     name: "Kéri László",     role: "politológus",               eps: 31, pods: 8  },
    { slug: "zsiday-viktor",   name: "Zsiday Viktor",   role: "közgazdász, befektető",     eps: 25, pods: 11 },
  ],
  // Top szervezetek a magyar podcastekben (2025. jún. – 2026. máj.).
  // Kiszűrve: médiumok, rádiók, sportklubok és -ligák (külön világ, ott
  // egy-két sportpodcast minden epizódban ismétli ugyanazt a 8-10 csapatot,
  // ezért torzít), egyházak, pártok (saját bontás lejjebb), valamint azok
  // a szervezetek, amelyek főleg saját podcasttal vagy szponzori felirattal
  // jelennek meg (Donably, Barion, Patreon, ATV-Gondolat Jel Alapítvány,
  // XXI. Század Intézet, Partizán Alapítvány). Az „EU" és „Európai Unió"
  // bejegyzéseket összevontuk.
  topOrgs: [
    { slug: "facebook", name: "Facebook", type: "Vállalat", eps: 1841 },
    { slug: "instagram", name: "Instagram", type: "Vállalat", eps: 923 },
    { slug: "europai-unio", name: "Európai Unió", type: "Intézmény", eps: 738 },
    { slug: "youtube", name: "YouTube", type: "Vállalat", eps: 675 },
    { slug: "otp-bank", name: "OTP Bank", type: "Vállalat", eps: 599 },
    { slug: "apple", name: "Apple", type: "Vállalat", eps: 493 },
    { slug: "netflix", name: "Netflix", type: "Vállalat", eps: 403 },
    { slug: "google", name: "Google", type: "Vállalat", eps: 380 },
    { slug: "tiktok", name: "TikTok", type: "Vállalat", eps: 363 },
    { slug: "magyar-nemzeti-bank", name: "Magyar Nemzeti Bank (MNB)", type: "Intézmény", eps: 249 },
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
      { day: "Hétfő",       vals: [673, 1277, 861, 1212, 643, 89] },
      { day: "Kedd",        vals: [480, 1215, 1088, 1276, 660, 110] },
      { day: "Szerda",      vals: [602, 1163, 840, 1134, 429, 123] },
      { day: "Csütörtök",   vals: [620, 1361, 933, 1431, 566, 99] },
      { day: "Péntek",      vals: [725, 1277, 884, 1041, 547, 45] },
      { day: "Szombat",     vals: [361, 609, 539, 544, 354, 78] },
      { day: "Vasárnap",    vals: [394, 729, 587, 507, 477, 178] },
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

// derived — magyar tizedesvessző formátumban
const huNum = (n: number, digits = 1) => n.toFixed(digits).replace(".", ",");
const growth10y = huNum(STATS.episodesYear["2025"] / STATS.episodesYear["2015"]);
const yoy2025 = huNum(((STATS.episodesYear["2025"] - STATS.episodesYear["2024"]) / STATS.episodesYear["2024"]) * 100);
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

// Dinamikus dátum-bélyeg, hogy a letölthető PNG-k és bélyegzők mindig az aktuális napot mutassák.
const TODAY_LABEL = new Date().toLocaleDateString("hu-HU", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

export default function PodcastReport2026() {
  useEffect(() => {
    setSeo({
      title: "Magyar podcast piac 2026 — Podiverzum jelentés",
      description: `${STATS.podcastCount.toLocaleString("hu-HU")} indexelt magyar podcast, ${STATS.episodeCount.toLocaleString("hu-HU")} epizód, napi közel 90 új adás: a Podiverzum.hu első részletes adatelemzése a magyar podcast piacról.`,
      jsonLd: [
        {
          "@context": "https://schema.org",
          "@type": "Report",
          name: "Magyar podcast piac 2026 — Podiverzum jelentés",
          datePublished: "2026-05-27",
          inLanguage: "hu-HU",
          author: { "@type": "Organization", name: "Podiverzum", url: "https://podiverzum.hu" },
          publisher: { "@type": "Organization", name: "Podiverzum", url: "https://podiverzum.hu" },
          about: "Magyar podcast piac mérete, növekedése, kategóriái és témái — kínálati oldali adatok",
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
            Podiverzum jelentés · {TODAY_LABEL}
          </div>
          <h1 className="font-serif text-4xl md:text-5xl font-bold leading-tight text-foreground">
            Magyar podcast piac 2026
          </h1>
          <p className="mt-4 text-lg md:text-xl text-muted-foreground leading-relaxed">
            Az első részletes adatelemzés a magyar podcastpiacról:{" "}
            <strong className="text-foreground">{STATS.podcastCount.toLocaleString("hu-HU")} indexelt magyar műsor</strong>,{" "}
            <strong className="text-foreground">{STATS.episodeCount.toLocaleString("hu-HU")} epizód</strong>, tíz év alatt{" "}
            <strong className="text-foreground">{growth10y}-szeres növekedés</strong>, napi közel 90 új epizód.
          </p>
          <div className="mt-4 text-sm text-muted-foreground">
            Adatforrás: Podiverzum.hu belső katalógus · Kínálati oldali adatok (nem hallgatottság) · Módszertan a cikk alján
          </div>

          {/* Hero metric cards */}
          <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-3">
            <HeroMetric value={STATS.podcastCount.toLocaleString("hu-HU")} label="indexelt műsor" />
            <HeroMetric value={STATS.episodeCount.toLocaleString("hu-HU")} label="epizód" />
            <HeroMetric value={`${growth10y}×`} label="növekedés 2015 óta" />
            <HeroMetric value="~90" label="napi új epizód" />
          </div>

          {/* Press thesis */}
          <p className="mt-8 font-serif text-lg md:text-xl italic text-foreground leading-relaxed border-l-2 border-primary pl-4">
            A magyar podcastpiac már nem hobbiműfaj, hanem gyorsan növekvő, de eddig alig mérhető tere a nyilvánosságnak.
          </p>
        </header>

        {/* NEW: Mit mutatnak az adatok? */}
        <section className="mb-12">
          <h2 className="mb-6 font-serif text-2xl md:text-3xl font-bold text-foreground">Mit mutatnak az adatok?</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InsightCard
              n={1}
              title="A magyar podcast már médiapiaci tényező"
              body={`Napi közel 90 új magyar epizód, több mint ${STATS.episodeCount.toLocaleString("hu-HU")} indexelt adás.`}
            />
            <InsightCard
              n={2}
              title="Gyorsan nő, de kevés műsor frissül legalább hetente"
              body={`${STATS.podcastCount.toLocaleString("hu-HU")} indexelt műsorból mindössze ${STATS.tiers.weekly} jelenik meg heti vagy gyakoribb ritmusban — a piac széles, a szerkesztett mag szűkebb.`}
            />
            <InsightCard
              n={3}
              title="Közélet, kultúra és hit dominál"
              body="A vezető témák között Biblia, választás, zene, mesterséges intelligencia és háború szerepel."
            />
            <InsightCard
              n={4}
              title="A podcast a hagyományos médiamérés vakfoltja"
              body="Fontos beszélgetések hangzanak el hosszú formátumban, de ezek eddig nehezen voltak kereshetők és elemezhetők."
            />
            <InsightCard
              n={5}
              title="A Podiverzum ezt teszi kereshetővé"
              body="Epizódok, témák, közszereplők és szervezetek kapcsolódnak össze egy strukturált magyar podcast-adatbázisban."
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
              if (year.startsWith("2026")) return null;
              return (
                <div key={year} className="flex items-center gap-3">
                  <div className="w-32 shrink-0 text-sm text-muted-foreground">{year}</div>
                  <div className="flex-1 relative h-7 rounded bg-muted overflow-hidden">
                    <div
                      className={`h-full transition-all ${isBreak ? "bg-accent" : "bg-primary/80"}`}
                      style={{ width: `${(eps / Math.max(maxYear, projected2026)) * 100}%` }}
                    />
                    <div className="absolute inset-0 flex items-center px-2 text-xs font-semibold text-foreground">
                      {eps.toLocaleString("hu-HU")}
                    </div>
                  </div>
                </div>
              );
            })}
            {/* 2026 — actual so far overlaid inside projected envelope */}
            {(() => {
              const actual2026 = STATS.episodesYear["2026 (eddig, 5 hó)"];
              const denom = Math.max(maxYear, projected2026);
              const projectedPct = (projected2026 / denom) * 100;
              const actualPct = (actual2026 / denom) * 100;
              return (
                <div className="flex items-center gap-3">
                  <div className="w-32 shrink-0 text-sm text-muted-foreground">2026</div>
                  <div className="flex-1 relative h-7 rounded bg-muted overflow-hidden">
                    {/* Projected envelope (dashed) */}
                    <div
                      className="absolute inset-y-0 left-0 border-2 border-dashed border-accent bg-accent/15"
                      style={{ width: `${projectedPct}%` }}
                    />
                    {/* Actual so far (solid, inside envelope) */}
                    <div
                      className="absolute inset-y-0 left-0 bg-primary/80"
                      style={{ width: `${actualPct}%` }}
                    />
                    <div className="absolute inset-0 flex items-center justify-between px-2 text-xs font-semibold text-foreground">
                      <span>{actual2026.toLocaleString("hu-HU")} <span className="font-normal text-muted-foreground">eddig (5 hó)</span></span>
                      <span className="italic text-muted-foreground">~{projected2026.toLocaleString("hu-HU")} várható</span>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>


          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <Callout title="2020–2021: áttörési pont">Járvány + Spotify HU launch — három év alatt megnégyszereződik a termelés.</Callout>
            <Callout title={`2026 várható: ~${projected2026.toLocaleString("hu-HU")} új epizód`}>Ha az első öt hónap üteme tartható, a magyar piac idén minden korábbi évet meghaladhat.</Callout>
          </div>
          </DownloadableFigure>
        </section>


        {/* Topics — what we talk about */}
        <section className="mb-12">
          <DownloadableFigure filename="top-temak-2026">
          <h2 className="mb-2 font-serif text-2xl font-bold text-foreground">Miről beszél a magyar podcastnyilvánosság?</h2>
          <p className="mb-2 text-muted-foreground">
            Az elmúlt 12 hónap magyar epizódjaiban ez volt a top 10 visszatérő beszélgetési téma.
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
            2026-ban a Biblia (130) és a Választás 2026 (123) együtt több azonosított epizódtémát adtak, mint a mesterséges intelligencia (92).
          </p>
          <p className="text-sm italic text-muted-foreground border-l-2 border-accent pl-3">
            A választási év nyoma is ott van a listán: a kampányidőszakban a <strong className="text-foreground not-italic">választás</strong> témája a top 10 második helyére került (123 epizód), közvetlenül a Biblia mögé.
          </p>
          </DownloadableFigure>
        </section>

        {/* Categories */}
        <section className="mb-12">
          <DownloadableFigure filename="kategoriak-megoszlas">
          <h2 className="mb-2 font-serif text-2xl font-bold text-foreground">Mit hallgatunk? — kategóriák</h2>
          <p className="mb-2 text-muted-foreground">
            Az epizódok alapján a magyar podcastkínálat legerősebb pillérei: társadalom és kultúra, hírek és politika, vallás és spiritualitás, valamint üzlet és pénzügy. Alább az <strong className="text-foreground">epizódszám szerinti megoszlás</strong> (terület = elérhető epizódok aránya).
          </p>
          <p className="mb-6 text-xs text-muted-foreground italic">
            Megjegyzés: ez epizódszám-alapú megoszlás (nem műsorszám, nem hallgatottság).
          </p>
          <div className="grid grid-cols-6 gap-1.5 min-h-[420px] [grid-auto-rows:80px]">
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
            Epizódszám szerinti súlyozás, csak a top 12 kategória alapján, az indexelt magyar podcastek {TODAY_LABEL}-i állapota szerint.
          </p>
          <p className="mt-3 text-sm italic text-muted-foreground border-l-2 border-primary pl-3">
            Erős koncentráció az epizódok szintjén: a négy legnagyobb kategória — Társadalom &amp; kultúra, Hírek &amp; politika, Vallás &amp; spiritualitás, Üzlet &amp; pénzügy — adja a top 12 kategória epizódjainak közel felét.
          </p>

          </DownloadableFigure>
        </section>

        {/* Category YoY growth — 2024 vs 2025 */}
        <section className="mb-12">
          <DownloadableFigure filename="kategoria-novekedes-yoy">
          <h2 className="mb-2 font-serif text-2xl font-bold text-foreground">Mi nő, mi zsugorodik? — kategóriák 2024 vs 2025</h2>
          <p className="mb-6 text-muted-foreground">
            Évi epizódszám-változás kategóriánként, a magyar podcastpiacon. A számok az egész évre vetített új epizódok mennyiségét hasonlítják össze — ez mutatja, mely műfajok lendültek fel és melyek fáradtak el.
          </p>
          {(() => {
            const yoy = [
              { name: "Egészség & életmód",   y24: 261,  y25: 557 },
              { name: "Étel & ital",          y24: 287,  y25: 514 },
              { name: "Gyerek & család",      y24: 714,  y25: 1106 },
              { name: "Zene",                 y24: 1043, y25: 1448 },
              { name: "Önfejlesztés",         y24: 604,  y25: 786 },
              { name: "Üzlet & pénzügy",      y24: 1090, y25: 1372 },
              { name: "Technológia",          y24: 680,  y25: 822 },
              { name: "Vallás & spiritualitás", y24: 2171, y25: 2353 },
              { name: "Társadalom & kultúra", y24: 5163, y25: 5295 },
              { name: "Sport",                y24: 1463, y25: 1435 },
              { name: "Film, TV & popkultúra", y24: 1849, y25: 1328 },
              { name: "Oktatás",              y24: 476,  y25: 329 },
              { name: "Humor",                y24: 580,  y25: 323 },
            ].map((c) => ({ ...c, pct: Math.round(((c.y25 - c.y24) / c.y24) * 100) }))
             .sort((a, b) => b.pct - a.pct);
            const maxAbs = Math.max(...yoy.map((c) => Math.abs(c.pct)));
            return (
              <div className="space-y-1.5">
                {yoy.map((c) => {
                  const w = (Math.abs(c.pct) / maxAbs) * 50; // max 50% of width each side
                  const up = c.pct >= 0;
                  return (
                    <div key={c.name} className="flex items-center gap-2 text-sm">
                      <div className="w-44 md:w-56 shrink-0 text-foreground truncate">{c.name}</div>
                      <div className="flex-1 relative h-6 flex items-center">
                        {/* center line */}
                        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border" />
                        {/* bar */}
                        <div
                          className={`absolute top-1 bottom-1 rounded-sm ${up ? "bg-primary/70" : "bg-muted-foreground/40"}`}
                          style={
                            up
                              ? { left: "50%", width: `${w}%` }
                              : { right: "50%", width: `${w}%` }
                          }
                        />
                        {/* label */}
                        <div
                          className={`absolute top-0 bottom-0 flex items-center text-xs font-semibold tabular-nums ${up ? "text-foreground" : "text-muted-foreground"}`}
                          style={up ? { left: `calc(50% + ${w}% + 6px)` } : { right: `calc(50% + ${w}% + 6px)` }}
                        >
                          {up ? "+" : ""}{c.pct}%
                        </div>
                      </div>
                      <div className="w-28 shrink-0 text-right text-[11px] font-mono text-muted-foreground tabular-nums">
                        {c.y24.toLocaleString("hu-HU")} → {c.y25.toLocaleString("hu-HU")}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
          <p className="mt-4 text-sm italic text-muted-foreground border-l-2 border-primary pl-3">
            A magyar podcastpiac kínálati oldalán 2025-ben az <strong className="text-foreground">egészség / életmód (+113%)</strong> és a <strong className="text-foreground">gasztronómia (+79%)</strong> nőtt a legnagyobbat — utánuk a gyerek &amp; család (+55%), zene (+39%) és önfejlesztés (+30%) tartja a lendületet. Eközben a <strong className="text-foreground">humor (−44%)</strong>, az <strong className="text-foreground">oktatás (−31%)</strong> és a <strong className="text-foreground">film / popkultúra (−28%)</strong> kevesebb új epizódot adott ki, mint 2024-ben. <span className="not-italic">Ez epizódszám-változás, nem hallgatottsági változás.</span>
          </p>
          </DownloadableFigure>
        </section>

        {/* Self-help / mental wellness — monthly seasonality */}
        <section className="mb-12">
          <DownloadableFigure filename="onsegito-temak-szezonalitas">
          <h2 className="mb-2 font-serif text-2xl font-bold text-foreground">Alvás és meditáció: januárban két téma ugrik ki élesen</h2>
          <p className="mb-6 text-muted-foreground">
            Öt önismereti és mentális wellness téma havi említése magyar podcast-epizódokban (cím + leírás szöveges illesztés, 2025. jún. – 2026. máj.). Az öt vizsgált téma közül januárban csak kettő — az alvás és a meditáció — emelkedik kiugró csúcsra.
          </p>

          {(() => {
            const series = [
              { slug: "alvas",        name: "Alvás",        color: "hsl(220 70% 50%)",
                data: [6, 3, 7, 13, 12, 7, 19, 44, 46, 37, 37, 40] },
              { slug: "meditacio",    name: "Meditáció",    color: "hsl(160 65% 40%)",
                data: [12, 9, 16, 13, 22, 21, 13, 47, 44, 37, 39, 38] },
              { slug: "szorongas",    name: "Szorongás",    color: "hsl(35 90% 50%)",
                data: [14, 16, 17, 16, 18, 23, 24, 23, 34, 24, 26, 22] },
              { slug: "onismeret",    name: "Önismeret",    color: "hsl(330 70% 50%)",
                data: [44, 47, 47, 38, 67, 59, 54, 51, 50, 51, 44, 34] },
              { slug: "parkapcsolat", name: "Párkapcsolat", color: "hsl(265 60% 55%)",
                data: [18, 15, 12, 13, 16, 21, 20, 23, 32, 30, 22, 16] },

            ];
            const months = ["2025-06","2025-07","2025-08","2025-09","2025-10","2025-11","2025-12","2026-01","2026-02","2026-03","2026-04","2026-05"];
            const labelMap: Record<string, string> = { "01": "Jan", "02": "Feb", "03": "Már", "04": "Ápr", "05": "Máj", "06": "Jún", "07": "Júl", "08": "Aug", "09": "Szep", "10": "Okt", "11": "Nov", "12": "Dec" };
            const W = 760, H = 280, PL = 36, PR = 12, PT = 16, PB = 44;
            const innerW = W - PL - PR;
            const innerH = H - PT - PB;
            const rawMax = Math.max(...series.flatMap((s) => s.data));
            const yMax = Math.ceil(rawMax / 20) * 20;
            const yTicks = Array.from({ length: yMax / 20 + 1 }, (_, i) => i * 20);
            const xAt = (i: number) => PL + (i * innerW) / (months.length - 1);
            const yAt = (v: number) => PT + innerH - (v / yMax) * innerH;
            return (
              <div className="rounded-lg border border-border bg-card p-5">
                <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
                  {yTicks.map((t) => (
                    <g key={t}>
                      <line x1={PL} x2={W - PR} y1={yAt(t)} y2={yAt(t)} stroke="hsl(var(--border))" strokeWidth="1" />
                      <text x={PL - 6} y={yAt(t) + 3} textAnchor="end" fontSize="10" fontFamily="ui-monospace, monospace" fill="hsl(var(--muted-foreground))">{t}</text>
                    </g>
                  ))}
                  {/* Highlight January band */}
                  <rect x={xAt(7) - 14} y={PT} width={28} height={innerH} fill="hsl(var(--primary) / 0.06)" />
                  <text x={xAt(7)} y={PT + 10} textAnchor="middle" fontSize="9" fill="hsl(var(--primary))" fontWeight="600">januári kiugrás</text>
                  {series.map((s) => {
                    const d = s.data.map((v, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yAt(v)}`).join(" ");
                    return <path key={s.slug} d={d} fill="none" stroke={s.color} strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />;
                  })}
                  {series.map((s) =>
                    s.data.map((v, i) => (
                      <circle key={`${s.slug}-${i}`} cx={xAt(i)} cy={yAt(v)} r="2.5" fill={s.color} />
                    ))
                  )}
                  {months.map((m, i) => (
                    <g key={m}>
                      <text x={xAt(i)} y={H - 24} textAnchor="middle" fontSize="10" fill="hsl(var(--muted-foreground))">{labelMap[m.slice(5)]}</text>
                      <text x={xAt(i)} y={H - 10} textAnchor="middle" fontSize="9" fill="hsl(var(--muted-foreground))" opacity="0.65">'{m.slice(2, 4)}</text>
                    </g>
                  ))}
                </svg>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground mt-2">
                  {series.map((s) => (
                    <div key={s.slug} className="flex items-center gap-1.5">
                      <span className="inline-block h-3 w-3 rounded-sm" style={{ background: s.color }} />
                      {s.name}
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-sm italic text-muted-foreground border-l-2 border-primary pl-3">
                  A vizsgált öt téma közül januárban csak kettő mutat éles kiugrást: az <strong className="text-foreground">alvás</strong> említései 19-ről 44-re (+131%), a <strong className="text-foreground">meditáció</strong> 13-ról 47-re (+262%) ugranak. Az <strong className="text-foreground">önismeret</strong> egész évben magas szinten ingadozik, érdemi januári csúcs nélkül; a <strong className="text-foreground">párkapcsolat</strong> és a <strong className="text-foreground">szorongás</strong> nem januárban, hanem februárban éri el a maximumát. A magyar podcastkínálatban tehát nem egy általános „újévi self-help hullám" látszik, hanem két konkrét téma — az alvás és a meditáció — szezonális felfutása.
                </p>
              </div>
            );
          })()}
          </DownloadableFigure>
        </section>



        {/* New podcasts per month — last 24 months */}
        <section className="mb-12">
          <DownloadableFigure filename="uj-podcastek-havonta">
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
                    const HU_MONTHS = ["jan.", "febr.", "márc.", "ápr.", "máj.", "jún.", "júl.", "aug.", "szept.", "okt.", "nov.", "dec."];
                    const mm = p.m.split("-")[1];
                    const monthName = HU_MONTHS[parseInt(mm, 10) - 1] ?? p.m;
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
                          <div
                            className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[9px] font-medium text-primary-foreground/90 whitespace-nowrap pointer-events-none"
                            style={{ writingMode: "vertical-rl", transform: "translateX(-50%) rotate(180deg)" }}
                          >
                            {monthName}
                          </div>
                        </div>

                      </div>
                    );
                  })}
                </div>
              </div>
              {/* Év-tengely: egy címke évenként, a megfelelő hónapcsoport alá igazítva */}
              {(() => {
                const groups: { year: string; count: number }[] = [];
                for (const p of STATS.newPodsByMonth) {
                  const y = p.m.split("-")[0];
                  const last = groups[groups.length - 1];
                  if (last && last.year === y) last.count += 1;
                  else groups.push({ year: y, count: 1 });
                }
                return (
                  <div className="flex mt-1 text-[11px] text-muted-foreground font-mono">
                    {groups.map((g) => (
                      <div
                        key={g.year}
                        className="text-center border-t border-border/60 pt-0.5"
                        style={{ flex: `${g.count} ${g.count} 0%` }}
                      >
                        {g.year}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            A függőleges tengely {monthBaseline}-tól indul, hogy a havi különbségek láthatók legyenek.
          </p>
          <p className="mt-4 text-sm italic text-muted-foreground border-l-2 border-primary pl-3">
            2026 első három hónapjában havi 29 új magyar podcast indult — ez minden korábbi év átlagát felülmúlja. <span className="not-italic">Új indulás = az első ismert epizód megjelenése az indexelt katalógusban.</span>
          </p>
          </DownloadableFigure>
        </section>

        {/* Podcast activity / death rate */}
        <section className="mb-12">
          <DownloadableFigure filename="podcast-aktivitas">
          <h2 className="mb-2 font-serif text-2xl font-bold text-foreground">Hány magyar podcast frissül még valójában?</h2>
          <p className="mb-6 text-muted-foreground">
            Az indexelt magyar podcastek bontása az utolsó megjelent epizód dátuma szerint. A számok mutatják, hogy a katalógus egyszerre <strong className="text-foreground">bővül és lemorzsolódik</strong>: sok új műsor indul, de a rendszeres publikálási ritmust csak egy szűkebb réteg tartja fenn.
          </p>
          {(() => {
            const buckets = [
              { label: "Frissen aktív (≤30 nap)", n: 575, color: "bg-primary", note: "az elmúlt egy hónapban publikált" },
              { label: "Lassuló (30–90 nap)", n: 214, color: "bg-primary/60", note: "negyedéven belül még jelentkezett" },
              { label: "Szunnyadó (3–6 hó)", n: 218, color: "bg-muted-foreground/50", note: "lassan kihagy" },
              { label: "Inaktív (6–12 hó)", n: 95, color: "bg-muted-foreground/35", note: "fél–egy éve nem jelent meg új ep." },
              { label: "Elcsendesedett (12+ hó)", n: 345, color: "bg-muted-foreground/25", note: "egy éve nincs új epizód" },
            ];
            const total = buckets.reduce((s, b) => s + b.n, 0);
            return (
              <>
                <div className="flex h-8 w-full overflow-hidden rounded-md border border-border mb-3">
                  {buckets.map((b) => (
                    <div key={b.label} className={`${b.color} relative group`} style={{ width: `${(b.n / total) * 100}%` }} title={`${b.label}: ${b.n} műsor`}>
                      <div className="absolute inset-0 flex items-center justify-center text-[10px] font-mono text-background opacity-90">{Math.round((b.n / total) * 100)}%</div>
                    </div>
                  ))}
                </div>
                <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 text-sm">
                  {buckets.map((b) => (
                    <div key={b.label} className="flex items-baseline gap-2">
                      <span className={`inline-block h-3 w-3 rounded-sm ${b.color} mt-1 shrink-0`} />
                      <div>
                        <div className="text-foreground font-semibold">{b.label} — <span className="tabular-nums">{b.n}</span></div>
                        <div className="text-xs text-muted-foreground">{b.note}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Összesen <strong className="text-foreground">{total.toLocaleString("hu-HU")}</strong> indexelt magyar műsor, amelyhez ismert utolsó epizód-dátum tartozik (a {STATS.podcastCount.toLocaleString("hu-HU")} feedes katalógusból). A „frissen aktív" sáv az elmúlt 30 napban publikált műsorokat jelöli.
                </p>
                <p className="mt-4 text-sm italic text-muted-foreground border-l-2 border-primary pl-3">
                  A magyar podcastpiac egyszerre bővül és lemorzsolódik: sok új műsor indul, de a rendszeres publikálási ritmust csak egy szűkebb réteg tartja fenn.
                </p>
              </>
            );
          })()}
          </DownloadableFigure>
        </section>




        {/* Publishing heatmap */}
        <section className="mb-12">
          <DownloadableFigure filename="publikalasi-heatmap">
          <h2 className="mb-2 font-serif text-2xl font-bold text-foreground">Mikor publikálnak a magyar podcastek?</h2>
          <p className="mb-2 text-muted-foreground">
            <strong className="text-foreground">2025. június – 2026. május</strong> közötti időszak ({(28530).toLocaleString("hu-HU")} magyar epizód) nap és óra szerinti bontásban. A magyar podcastoknak felismerhető heti ritmusa van: a legerősebb sáv a csütörtöki munkanap, különösen a délelőtti és kora délutáni órákban.
          </p>
          <p className="mb-6 text-xs text-muted-foreground italic">
            Időzóna: Europe/Budapest. A publikálási dátum az RSS / publikációs metaadatok alapján.
          </p>
          <Heatmap data={STATS.heatmap} max={maxHeat} />
          <p className="mt-4 text-sm italic text-muted-foreground border-l-2 border-primary pl-3">
            A hét két publikálási csúcsa csütörtök kora délután és csütörtök reggel — gyakorlatilag ez a magyar podcast „prime time".
          </p>
          </DownloadableFigure>
        </section>

        {/* Személy-mention szakasz eltávolítva — az entitásfelismerés még nem különíti el
            megbízhatóan a műsorvezetőket (pl. Gubik Petra, Pogátsa Zoltán saját podcasterek)
            a vendégektől és a csak szóba kerülő szereplőktől. Visszahozzuk, ha pontosabb. */}





        {/* Top organizations szakasz IDEIGLENESEN ELREJTVE — az entitás-kinyerő jelenleg
            a raw description-ből dolgozik, nem a clean_text-ből, ezért tele van a top
            önreklám-zajjal (Facebook/YouTube/Instagram/TikTok/Apple Podcasts/Patreon
            "kövess minket / iratkozz fel" boilerplate). A pipeline újraépítése után
            (clean_text-ből + bővített boilerplate-szűrés) visszahozzuk.
            Pártokat viszont megtartjuk: azok a kanonikus 12-elemű párt-whitelistből
            jönnek, nincsenek a kinyerő torzítás-forrásnak kitéve. */}
        <section className="mb-12">
          <DownloadableFigure filename="top-partok">
          <h2 className="mb-2 font-serif text-2xl font-bold text-foreground">Közéleti említések: pártok a magyar podcastokban</h2>
          <p className="mb-6 text-muted-foreground">
            A számok azt mutatják, hány indexelt magyar epizódban azonosította a rendszer az adott pártot (2025. jún. – 2026. máj.). Ez egy <strong className="text-foreground">külön metszetet ad a közéleti podcast-térről</strong> — <strong className="text-foreground">nem támogatottsági, nem szimpátia- és nem hallgatottsági adat</strong>.
          </p>

          <div className="max-w-xl">
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
          <p className="mt-4 text-xs text-muted-foreground">
            „Ep” = olyan magyar epizód, amelyben a párt szóba került az indexelt leiratok alapján. Kínálati, nem hallgatottsági adat.
          </p>

          {/* Fidesz vs Tisza monthly — line chart */}
          {(() => {
            const partyMonthly = [
              { m: "2025-06", fidesz: 35, tisza: 20 },
              { m: "2025-07", fidesz: 24, tisza: 20 },
              { m: "2025-08", fidesz: 13, tisza: 7 },
              { m: "2025-09", fidesz: 40, tisza: 36 },
              { m: "2025-10", fidesz: 47, tisza: 58 },
              { m: "2025-11", fidesz: 49, tisza: 61 },
              { m: "2025-12", fidesz: 49, tisza: 40 },
              { m: "2026-01", fidesz: 46, tisza: 45 },
              { m: "2026-02", fidesz: 73, tisza: 71 },
              { m: "2026-03", fidesz: 79, tisza: 69 },
              { m: "2026-04", fidesz: 93, tisza: 104 },
              { m: "2026-05", fidesz: 32, tisza: 34 },
            ];
            const labelMap: Record<string, string> = { "01": "Jan", "02": "Feb", "03": "Már", "04": "Ápr", "05": "Máj", "06": "Jún", "07": "Júl", "08": "Aug", "09": "Szep", "10": "Okt", "11": "Nov", "12": "Dec" };
            const W = 760, H = 260, PL = 36, PR = 12, PT = 16, PB = 44;
            const innerW = W - PL - PR;
            const innerH = H - PT - PB;
            const rawMax = Math.max(...partyMonthly.flatMap((r) => [r.fidesz, r.tisza]));
            const yMax = Math.ceil(rawMax / 25) * 25;
            const yTicks = Array.from({ length: yMax / 25 + 1 }, (_, i) => i * 25);
            const xAt = (i: number) => PL + (i * innerW) / (partyMonthly.length - 1);
            const yAt = (v: number) => PT + innerH - (v / yMax) * innerH;
            const path = (key: "fidesz" | "tisza") =>
              partyMonthly.map((r, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yAt(r[key])}`).join(" ");
            return (
              <div className="mt-8 rounded-lg border border-border bg-card p-5">
                <h3 className="font-serif text-lg font-bold text-foreground mb-1">Fidesz vs Tisza Párt — havi említések az elmúlt 1 évben</h3>
                <p className="text-xs text-muted-foreground mb-4">
                  Olyan magyar podcast-epizódok száma havonta, amelyekben az adott pártot a kanonikus szervezet-adatbázisunk azonosítja (2025. jún. – 2026. máj.).
                </p>
                <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
                  {yTicks.map((t) => (
                    <g key={t}>
                      <line x1={PL} x2={W - PR} y1={yAt(t)} y2={yAt(t)} stroke="hsl(var(--border))" strokeWidth="1" />
                      <text x={PL - 6} y={yAt(t) + 3} textAnchor="end" fontSize="10" fontFamily="ui-monospace, monospace" fill="hsl(var(--muted-foreground))">{t}</text>
                    </g>
                  ))}
                  <path d={path("fidesz")} fill="none" stroke="hsl(28 100% 50%)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
                  <path d={path("tisza")} fill="none" stroke="hsl(345 55% 32%)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
                  {partyMonthly.map((r, i) => (
                    <g key={r.m}>
                      <circle cx={xAt(i)} cy={yAt(r.fidesz)} r="3.5" fill="hsl(28 100% 50%)" />
                      <circle cx={xAt(i)} cy={yAt(r.tisza)} r="3.5" fill="hsl(345 55% 32%)" />
                      <text x={xAt(i)} y={H - 24} textAnchor="middle" fontSize="10" fill="hsl(var(--muted-foreground))">{labelMap[r.m.slice(5)]}</text>
                      <text x={xAt(i)} y={H - 10} textAnchor="middle" fontSize="9" fill="hsl(var(--muted-foreground))" opacity="0.65">'{r.m.slice(2, 4)}</text>
                    </g>
                  ))}
                </svg>
                <div className="flex items-center gap-4 text-xs text-muted-foreground mt-2">
                  <div className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: "hsl(28 100% 50%)" }} /> Fidesz</div>
                  <div className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: "hsl(345 55% 32%)" }} /> Tisza Párt</div>
                </div>
                <p className="mt-4 text-xs italic text-muted-foreground border-l-2 border-primary pl-3">
                  2025 őszétől a két párt említési görbéje közelít egymáshoz, 2026 tavaszán pedig több hónapban hasonló nagyságrendben szerepelnek a magyar podcastokban. A 2025. augusztusi mélypont a nyári szünet hatása; a 2026. májusi adat csak részhónap (a riport zárónapja: május 27.). <span className="not-italic">Ez említésszám, nem támogatottsági adat.</span>
                </p>
              </div>
            );
          })()}
          </DownloadableFigure>
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
            „A magyar podcastpiac kinőtte a régi keresési és mérési logikát: ma már nem elég műsorokat listázni, az epizódok tartalmát kell érthetővé és kereshetővé tenni."
          </blockquote>
        </section>

        {/* What it means */}
        <section className="mb-12 rounded-lg bg-muted/40 p-6 print:break-inside-avoid">
          <h2 className="mb-3 font-serif text-2xl font-bold text-foreground">Mit jelent mindez?</h2>
          <div className="space-y-3 text-foreground">
            <p>
              A magyar podcast piac <strong>nem hobbiműfaj többé</strong>: napi közel 90 új epizód, évi több mint 25 ezer adás, több mint ezernégyszáz indexelt műsor. A nyilvánosság egyre nagyobb része — különösen a fiatalabb, urbánus korosztály — hosszú formátumú beszélgetésekből is tájékozódik.
            </p>
            <p>
              Eközben a podcastok tartalma jórészt <strong>strukturálatlan és nehezen kereshető</strong>: a keresőmotorok és hírarchívumok számára gyakran csak részlegesen látható, és a közéleti viták egy része olyan hosszú formátumú beszélgetésekben zajlik, amelyek eddig nehezen voltak visszakereshetők.
            </p>
            <p>
              A Podiverzum ezt az átláthatatlanságot bontja le: <strong>az indexelt epizódok szöveges adatait és elérhető átiratait automatizált rendszer elemzi</strong>, kinyeri a szereplőket, témákat és összefüggéseket, majd kereshetővé teszi őket.
            </p>
          </div>
        </section>

        {/* B2B capability — what does Podiverzum see */}
        <section className="mb-12 rounded-lg border border-primary/30 bg-gradient-to-br from-primary/5 via-card to-accent/5 p-6 print:break-inside-avoid">
          <div className="text-xs uppercase tracking-widest text-primary mb-2">A motor a háttérben</div>
          <h2 className="font-serif text-2xl font-bold text-foreground mb-3">Mit lát a Podiverzum, amit más nem?</h2>
          <p className="text-foreground mb-4">
            Ez a jelentés csak egy nyilvános pillanatkép. A Podiverzum mögött folyamatosan frissülő magyar podcast-adatbázis fut: epizódokkal, témákkal, személyekkel, szervezetekkel és időbeli említésgörbékkel. Ez lehetővé teszi, hogy egy közszereplő, márka, intézmény vagy téma podcastbeli jelenléte visszakereshető és elemezhető legyen.
          </p>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded border border-border bg-card p-4">
              <div className="text-xs font-mono text-primary mb-1">KI</div>
              <div className="text-sm text-foreground leading-snug">Kik és milyen epizódokban kerülnek szóba?</div>
            </div>
            <div className="rounded border border-border bg-card p-4">
              <div className="text-xs font-mono text-primary mb-1">MIKOR</div>
              <div className="text-sm text-foreground leading-snug">Hogyan változik egy téma vagy szereplő említése hónapról hónapra?</div>
            </div>
            <div className="rounded border border-border bg-card p-4">
              <div className="text-xs font-mono text-primary mb-1">MILYEN KONTEXTUSBAN</div>
              <div className="text-sm text-foreground leading-snug">Milyen témák, műsorok és szervezetek kapcsolódnak hozzá?</div>
            </div>
          </div>
        </section>

        {/* Capability demo — example queries */}
        <section className="mb-12">
          <DownloadableFigure filename="podiverzum-pelda-lekerdezesek">
          <div className="text-xs uppercase tracking-widest text-primary mb-2">Példa lekérdezések</div>
          <h2 className="mb-2 font-serif text-2xl font-bold text-foreground">Néhány gyors példa arra, mit lehet az adatbázisból kihúzni</h2>
          <p className="mb-6 text-muted-foreground">
            Ezek a számok pár perces ad-hoc lekérdezések eredményei a 2025. június óta megjelent magyar podcast-epizódokon, a tisztított átiratokban kereső szöveges illesztéssel. A teljes katalógusra futtatva, finomabb szűrésekkel a sajtó saját kérdéseire is le tudjuk gyártani a riport-grafikákat.
          </p>

          <div className="grid gap-6 md:grid-cols-2">
            {/* Cities */}
            <div className="rounded-lg border border-border bg-card p-5">
              <h3 className="font-serif text-lg font-bold text-foreground mb-1">Melyik magyar városok kerülnek szóba a leggyakrabban?</h3>
              <p className="text-xs text-muted-foreground mb-4">Epizódszám, amelyikben a városnév elhangzik (2025. jún. – 2026. máj., HU podcastek, tisztított átiratok).</p>
              <div className="space-y-1.5">
                {[
                  { name: "Budapest", eps: 808 },
                  { name: "Győr", eps: 40 },
                  { name: "Veszprém", eps: 33 },
                  { name: "Debrecen", eps: 30 },
                  { name: "Siófok", eps: 28 },
                  { name: "Békéscsaba", eps: 23 },
                  { name: "Szeged", eps: 18 },
                  { name: "Pécs", eps: 14 },
                  { name: "Sopron", eps: 13 },
                  { name: "Miskolc", eps: 12 },
                ].map((c, i, arr) => (
                  <div key={c.name} className="flex items-center gap-2">
                    <div className="w-4 shrink-0 text-xs font-mono text-muted-foreground">{i + 1}.</div>
                    <div className="w-28 shrink-0 text-sm text-foreground truncate">{c.name}</div>
                    <div className="flex-1 relative h-5 rounded bg-muted overflow-hidden">
                      <div className="h-full bg-primary/70" style={{ width: `${(c.eps / arr[0].eps) * 100}%` }} />
                      <div className="absolute inset-0 flex items-center px-2 text-xs font-semibold text-foreground">{c.eps}</div>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs italic text-muted-foreground">Budapest értelemszerűen messze vezet — érdekesebb a vidéki sorrend, ahol Győr, Veszprém és a Balaton-parti Siófok kerül előre az ország-elsőszámú nagyvárosok (Debrecen, Szeged, Pécs) elé.</p>
            </div>

            {/* Films / series */}
            <div className="rounded-lg border border-border bg-card p-5">
              <h3 className="font-serif text-lg font-bold text-foreground mb-1">Melyik filmek és sorozatok jönnek elő legtöbbet?</h3>
              <p className="text-xs text-muted-foreground mb-4">Epizódszám említés alapján, válogatott magyar és nemzetközi címek, ugyanaz az időszak. A több jelentésű címeket (pl. „Semmelweis" = film + egyetem + történelmi alak, „A Tanár" = sorozat + általános szó) kihagytuk.</p>
              <div className="space-y-1.5">
                {[
                  { name: "Harry Potter", eps: 25 },
                  { name: "Star Wars", eps: 23 },
                  { name: "Stranger Things", eps: 15 },
                  { name: "A Gyűrűk Ura", eps: 14 },
                  { name: "Dűne", eps: 10 },
                  { name: "Testről és lélekről", eps: 10 },
                  { name: "Mátrix", eps: 10 },
                  { name: "Joker", eps: 6 },
                  { name: "Saul fia", eps: 6 },
                  { name: "Trónok harca", eps: 5 },
                ].map((f, i, arr) => (
                  <div key={f.name} className="flex items-center gap-2">
                    <div className="w-4 shrink-0 text-xs font-mono text-muted-foreground">{i + 1}.</div>
                    <div className="w-36 shrink-0 text-sm text-foreground truncate">{f.name}</div>
                    <div className="flex-1 relative h-5 rounded bg-muted overflow-hidden">
                      <div className="h-full bg-accent/70" style={{ width: `${(f.eps / arr[0].eps) * 100}%` }} />
                      <div className="absolute inset-0 flex items-center px-2 text-xs font-semibold text-foreground">{f.eps}</div>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs italic text-muted-foreground">A nemzetközi franchise-ok (Harry Potter, Star Wars, Stranger Things, A Gyűrűk Ura, Dűne) viszik a listát, de a magyar Oscar-jelölt/díjnyertes filmek — Enyedi Ildikó Testről és lélekről, Nemes Jeles László Saul fia — is rendszeresen visszatérnek a beszélgetésekbe.</p>
            </div>
          </div>

          {/* Institutions */}

          <div className="mt-6 rounded-lg border border-border bg-card p-5">
            <h3 className="font-serif text-lg font-bold text-foreground mb-1">Mely állami és nemzetközi intézmények jönnek elő legtöbbet?</h3>
            <p className="text-xs text-muted-foreground mb-4">Epizódszám, amelyikben az intézmény neve elhangzik vagy szóba kerül (2025. jún. – 2026. máj., HU podcastek). Az országokat és általános fogalmakat („kormány") kihagytuk, csak konkrét intézményeket jelenítünk meg.</p>
            {(() => {
              const insts = [
                { name: "Európai Bizottság", eps: 34 },
                { name: "Magyar Nemzeti Bank (MNB)", eps: 72 },
                { name: "NATO", eps: 24 },
                { name: "Magyar Honvédség", eps: 21 },
                { name: "Országgyűlés", eps: 20 },
                { name: "NAV", eps: 19 },
                { name: "Kúria", eps: 18 },
                { name: "Szuverenitásvédelmi Hivatal", eps: 18 },
                { name: "Rendőrség", eps: 19 },
                { name: "Országos Széchényi Könyvtár", eps: 31 },
              ].sort((a, b) => b.eps - a.eps);
              const max = insts[0].eps;
              return (
                <div className="space-y-1.5">
                  {insts.map((x, i) => (
                    <div key={x.name} className="flex items-center gap-2">
                      <div className="w-4 shrink-0 text-xs font-mono text-muted-foreground">{i + 1}.</div>
                      <div className="w-56 shrink-0 text-sm text-foreground truncate">{x.name}</div>
                      <div className="flex-1 relative h-5 rounded bg-muted overflow-hidden">
                        <div className="h-full bg-primary/70" style={{ width: `${(x.eps / max) * 100}%` }} />
                        <div className="absolute inset-0 flex items-center px-2 text-xs font-semibold text-foreground">{x.eps}</div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
            <p className="mt-3 text-xs italic text-muted-foreground">A magyar közbeszéd intézményi térképét két erő rajzolja: a <strong className="text-foreground">gazdaság</strong> (MNB messze a legtöbbet emlegetett hazai intézmény) és a <strong className="text-foreground">honvédelem / biztonság</strong> (Honvédség, NATO, rendőrség, Szuverenitásvédelmi Hivatal). A Kúria és a NAV jelenléte mutatja, hogy a jogállam-vita és az adózás is folyamatosan napirenden van.</p>
            <p className="mt-2 text-xs italic text-muted-foreground border-l-2 border-primary pl-3">
              <strong className="text-foreground">Miért az MNB a hazai listán az első?</strong> Az MNB említéseinek jelentős része az MNB-alapítványok körüli közéleti diskurzushoz kapcsolódik: az intézményt tartalmazó magyar epizódok közel <strong className="text-foreground">40%-ában</strong> a „botrány", „alapítvány", „Matolcsy" vagy „korrupció" kifejezések közül legalább egy szintén megjelenik a leiratban. Ez kontextusszámítás az említések szövegkörnyezetéből — <span className="not-italic">nem tartalmi értékelés vagy jogi következtetés</span> az érintettekről.
            </p>
          </div>



          </DownloadableFigure>
        </section>


        {/* Methodology */}
        <section className="mb-12 border-t border-border pt-8">
          <h2 className="mb-3 font-serif text-xl font-bold text-foreground">Módszertan</h2>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              <strong className="text-foreground">Adatforrás:</strong> A Podiverzum.hu folyamatosan figyeli a nyilvánosan elérhető magyar podcast-csatornákat és azok publikus metaadatait.
              „Magyar podcast" = a feed metaadataiban magyar nyelv jelölve (`language=hu*`), vagy nyelvazonosítás alapján dominánsan magyar tartalom.
            </p>
            <p>
              <strong className="text-foreground">Aktív műsor:</strong> {STATS.podcastCount} aktív magyar podcast = legalább 1 publikált epizóddal rendelkező, nyilvánosan elérhető RSS feed, {TODAY_LABEL}-i állapot szerint.
            </p>
            <p>
              <strong className="text-foreground">Kategorizálás:</strong> Az iTunes/Apple taxonómiát követjük, megerősítve egy belső, 21-kategóriás magyar taxonómiával.
            </p>
            <p>
              <strong className="text-foreground">Téma-azonosítás:</strong> Minden epizód transcript-ből kinyert beszélgetési témák, dedupolva és normalizálva. „Téma" ≠ kategória.
            </p>
            <p>
              <strong className="text-foreground">Publikálási ritmus szerinti csoportosítás:</strong> Belső pontrendszer, ami az adott podcast átlagos havi epizód-számát súlyozza a frissesség és aktivitás függvényében. A jelentésben szereplő nyilvános címkék (Heti+, Aktív havi, Havi, Ritkán frissülő, Elnémult) ezen alapulnak. Részletek: <Link to="/modszertan" className="underline hover:text-foreground">módszertan</Link>.
            </p>
            <p>
              <strong className="text-foreground">Közszereplők és szervezetek:</strong> Minden epizód clean-text átiratából kinyerjük az említett embereket és szervezeteket, Wikipédia/Wikidata alapú azonosítással.
            </p>
            <p>
              <strong className="text-foreground">Korlátok:</strong> A katalógus nem teljes — kis kalózpodcastok, magán Discord-szerverek, YouTube-only streamek nem kerülnek be. Hallgatottsági (letöltés- / play-) adatokat ez a jelentés nem tartalmaz: a számok kínálati, nem keresleti oldalt mérnek.
            </p>
          </div>
        </section>

        {/* Press / research box */}
        <section className="mb-8 rounded-lg border border-primary/30 bg-primary/5 p-6 print:break-inside-avoid">
          <div className="text-xs uppercase tracking-widest text-primary mb-2">Sajtó / kutatás</div>
          <h2 className="font-serif text-xl font-bold text-foreground mb-2">Adatkérések és háttérbeszélgetés</h2>
          <p className="text-sm text-foreground mb-3">
            Sajtómegkeresések, egyedi lekérdezések, kutatási együttműködés és háttérbeszélgetés: <a href="mailto:hello@podiverzum.hu" className="font-semibold underline">hello@podiverzum.hu</a>
          </p>
          <p className="text-xs text-muted-foreground">
            A jelentésben szereplő grafikák szabadon átvehetők forrásmegjelöléssel: Podiverzum.hu.
          </p>
        </section>

        {/* Footer CTA */}
        <section className="rounded-lg border border-border bg-card p-6 text-center print:break-inside-avoid">
          <div className="mb-3 text-sm uppercase tracking-widest text-muted-foreground">Próbáld ki</div>
          <div className="font-serif text-2xl font-bold text-foreground mb-3">Keress rá bármire a magyar podcast univerzumban</div>
          <p className="mb-4 text-muted-foreground">
            133 ezer epizódban szemantikus keresés, magyar nyelven, idézhető válaszokkal.
          </p>
          <Link
            to="/kereses"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition"
          >
            Keresés indítása →
          </Link>
        </section>

        {/* Legal disclaimer */}
        <section className="mt-10 pt-6 border-t border-border print:break-inside-avoid">
          <h2 className="mb-3 font-serif text-sm font-bold uppercase tracking-widest text-muted-foreground">Felelősségkizárás</h2>
          <div className="space-y-2 text-xs text-muted-foreground leading-relaxed">
            <p>
              <strong className="text-foreground">Adatok jellege:</strong> a jelentés tájékoztató és sajtó-háttéranyag jelleggel készült a Podiverzum.hu nyilvánosan elérhető magyar podcast-katalógusa alapján. A közölt számok a {TODAY_LABEL}-i állapot pillanatképei; az alapadatok (RSS feedek, leírások, átiratok) folyamatosan változnak, így későbbi lekérdezés eltérő eredményt adhat. A jelentés <em>kínálati</em> oldalt mér, nem tartalmaz hallgatottsági, letöltési vagy bevételi adatot. Az „említés" azt jelenti, hogy egy név vagy kifejezés szerepel az epizód címében, leírásában vagy elérhető átiratában — ez nem tartalmi értékelés vagy állásfoglalás az érintettekről.
            </p>
            <p>
              <strong className="text-foreground">Automatizált feldolgozás korlátai:</strong> az entitás-kinyerés, a nyelvazonosítás és a kategorizálás részben nyelvi modellekkel és heurisztikus ellenőrzésekkel történik, ezért elszórt téves találatok, névegyezések vagy kontextus-tévesztések előfordulhatnak. A Podiverzum törekszik az adatok pontosságára, de az automatizált feldolgozás és a folyamatosan változó forrásadatok miatt elszórt eltérések előfordulhatnak; korrekciós jelzéseket a <a href="mailto:hello@podiverzum.hu" className="underline">hello@podiverzum.hu</a> címen fogadunk.
            </p>
            <p>
              <strong className="text-foreground">Felhasználás és forrásmegjelölés:</strong> a jelentésben szereplő grafikák szabadon felhasználhatók a forrás (Podiverzum.hu) feltüntetésével. A nyers adatbázis, az átiratok és a származtatott adatok a Podiverzum tulajdonát képezik; bulk-letöltésük vagy újrahasznosításuk előzetes írásos engedély nélkül nem megengedett. Harmadik felek nevei és védjegyei tulajdonosaik tulajdonát képezik.
            </p>
          </div>
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
    <div className="print:break-inside-avoid">
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
          <span>Forrás: Podiverzum.hu adatbázis — {TODAY_LABEL}.</span>
          <span className="font-semibold text-foreground">podiverzum.hu</span>
        </div>
      </div>
    </div>
  );
}

function Heatmap({ data, max }: { data: { cols: string[]; rows: { day: string; vals: number[] }[] }; max: number }) {
  return (
    <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
      <div className="min-w-[560px]">
        <div className="grid gap-1 text-[10px] md:text-xs" style={{ gridTemplateColumns: `80px repeat(${data.cols.length}, minmax(0,1fr))` }}>
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
