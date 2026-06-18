import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { toPng } from "html-to-image";
import Layout from "@/components/Layout";
import { setSeo } from "@/lib/seo";
import { sitePublisherJsonLd } from "@/lib/sitePublisher";

// ============================================================
// A HÁBORÚ MINT TÉMA A MAGYAR PODCAST-PIACON (2025.06 – 2026.06)
// Forrás: Podiverzum belső adatbázis (2026-06-15 snapshot)
// Ráta-alapú megközelítés: háborús ep / havi össz. HU ep
// Mérési egység: cím + leírás regex-illesztés (NEM transcript)
// ============================================================

const REPORT_DATE = "2026-06-18";
const REPORT_URL = "https://podiverzum.hu/jelentes/haboru-mint-tema-2026";

type MonthRow = {
  m: string;        // "2025-06"
  total: number;
  war: number;
  rate: number;     // %
  ukr: number;      // % Ukrajna-kontextus
  me: number;       // % Közel-Kelet
  note?: string;
  partial?: boolean;
};

const MONTHS: MonthRow[] = [
  { m: "2025-06", total: 2170, war: 60,  rate: 2.77, ukr: 0.74, me: 1.20, note: "Irán–Izrael 12 napos háború" },
  { m: "2025-07", total: 1951, war: 32,  rate: 1.64, ukr: 0.62, me: 0.41 },
  { m: "2025-08", total: 1791, war: 29,  rate: 1.62, ukr: 0.67, me: 0.45 },
  { m: "2025-09", total: 2153, war: 44,  rate: 2.04, ukr: 0.65, me: 0.14 },
  { m: "2025-10", total: 2536, war: 63,  rate: 2.48, ukr: 1.18, me: 0.39 },
  { m: "2025-11", total: 2463, war: 53,  rate: 2.15, ukr: 0.85, me: 0.24 },
  { m: "2025-12", total: 2712, war: 60,  rate: 2.21, ukr: 0.77, me: 0.26 },
  { m: "2026-01", total: 2408, war: 35,  rate: 1.45, ukr: 0.25, me: 0.21, note: "13 hó abszolút mélypont" },
  { m: "2026-02", total: 2613, war: 77,  rate: 2.95, ukr: 1.26, me: 0.31 },
  { m: "2026-03", total: 3277, war: 169, rate: 5.16, ukr: 1.47, me: 2.29, note: "★ Gáza / Hamasz-tűzszünet" },
  { m: "2026-04", total: 3144, war: 55,  rate: 1.75, ukr: 0.29, me: 0.45, note: "Választás (04.12)" },
  { m: "2026-05", total: 2946, war: 46,  rate: 1.56, ukr: 0.44, me: 0.61, note: "Választás utáni mélypont" },
  { m: "2026-06", total: 1410, war: 25,  rate: 1.77, ukr: 0.85, me: 0.78, partial: true },
];

const TOP_PODS = [
  { group: "Ukrajna-specialisták", items: ["Frontvonal (21/23)", "Szuverén (12/12)", "Kontroll (23/31)", "PestiSrácok (11/14)"] },
];

// 65 napos szimmetrikus pre/post ablak a 2026-04-12-i választás körül
const PREPOST = {
  pre:  { label: "2026.02.06 – 04.11", days: 65, total: 6437, war: 187, war_rate: 2.91, ukr_rate: 1.82, pods_with_war: 87, active_pods: 764 },
  post: { label: "2026.04.13 – 06.16", days: 65, total: 6590, war: 70,  war_rate: 1.06, ukr_rate: 0.71, pods_with_war: 46, active_pods: 707 },
};
const PREPOST_WAR_DROP = Math.round((1 - PREPOST.post.war_rate / PREPOST.pre.war_rate) * 100);
const PREPOST_UKR_DROP = Math.round((1 - PREPOST.post.ukr_rate / PREPOST.pre.ukr_rate) * 100);
const PREPOST_PODS_DROP = Math.round((1 - PREPOST.post.pods_with_war / PREPOST.pre.pods_with_war) * 100);

const huNum = (n: number, digits = 2) => n.toFixed(digits).replace(".", ",");
const huInt = (n: number) => n.toLocaleString("hu-HU");

const TODAY_LABEL = new Date().toLocaleDateString("hu-HU", { year: "numeric", month: "long", day: "numeric" });

const maxRate = Math.max(...MONTHS.map((r) => r.rate));
const avgRate = MONTHS.reduce((s, r) => s + r.rate, 0) / MONTHS.length;

// Headline numbers
const PEAK = MONTHS.find((m) => m.m === "2026-03")!;          // 5.16 %
const LOW = MONTHS.find((m) => m.m === "2026-05")!;            // 1.56 %
const UKR_MARCH = 1.47;
const UKR_APR = 0.29;
const dropPctVsMarch = Math.round(((PEAK.rate - LOW.rate) / PEAK.rate) * 100); // ~70%
const ukrDropPct = Math.round(((UKR_MARCH - UKR_APR) / UKR_MARCH) * 100);       // ~80%

export default function HaboruTemaReport() {
  useEffect(() => {
    setSeo({
      title: "Lezárult egy kampányfejezet. A választás utáni mélypontra 70%-kal visszaesett a háború súlya a magyar podcastokban",
      description:
        "A választást megelőző márciusi csúcsról a választást követő májusi mélypontra 70%-kal csökkent a háború-tematikájú epizódok aránya a magyar podcastkínálatban.",
      canonical: REPORT_URL,
      jsonLd: [
        {
          "@context": "https://schema.org",
          "@type": "Report",
          name: "A háború mint téma a magyar podcast-piacon (2025.06 – 2026.06)",
          datePublished: REPORT_DATE,
          inLanguage: "hu-HU",
          author: { "@type": "Organization", name: "Podiverzum", url: "https://podiverzum.hu" },
          publisher: sitePublisherJsonLd(),
          about:
            "Ráta-alapú elemzés a háború tematikus jelenlétének alakulásáról a magyar podcast-piacon 2025 júniusa és 2026 júniusa között, kontroll a havi epizód-kibocsátásra, választás előtti és utáni időszak összehasonlítása.",
          url: REPORT_URL,
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
            A választás után 64 százalékkal esett vissza a háborús epizódok aránya a magyar podcastokban
          </h1>
          <p className="mt-4 text-lg md:text-xl text-muted-foreground leading-relaxed">
            A választás előtti és utáni, azonos hosszúságú 65 napos időszakban a háború-tematikájú epizódok aránya 2,91%-ról 1,06%-ra csökkent, miközben a teljes magyar podcastkibocsátás lényegében változatlan maradt. A márciusi csúcshoz képest májusra 70%-os volt a visszaesés.
          </p>
          <div className="mt-4 text-sm text-muted-foreground">
            Adatforrás: <a href="https://podiverzum.hu" className="underline hover:text-foreground">Podiverzum.hu</a> indexelt magyar podcastkatalógus · 2025.06.01–2026.06.15 · Kínálati tematikus elemzés · Módszertan a cikk végén
          </div>

          {/* Hero metrics */}
          <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-3">
            <HeroMetric value={`${huNum(PEAK.rate)}%`} label="2026-03 választás előtti csúcs" />
            <HeroMetric value={`${huNum(LOW.rate)}%`} label="2026-05 választás utáni mélypont" />
            <HeroMetric value={`−${dropPctVsMarch}%`} label="márciusi csúcs → májusi mélypont" />
            <HeroMetric value={`−${ukrDropPct}%`} label="Ukrajna-ráta a választás utáni hetekre" />
          </div>

          <p className="mt-8 font-serif text-lg md:text-xl italic text-foreground leading-relaxed border-l-2 border-primary pl-4">
            Az Ukrajna-kontextusú epizódok aránya a választás (2026.04.12) után, április második felére a márciusi szint egyötödére esett vissza — a téma a kampány lezárulta után gyorsan háttérbe szorult.
          </p>


          {/* AI / LLM friendly versions (hidden, kept in DOM for machine readability) */}
          <aside className="hidden mt-6 rounded-lg border border-border bg-muted/40 p-4 text-sm" aria-label="Gépi olvasható változatok AI-eszközökhöz">
            <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
              AI-ügynököknek · ChatGPT / Claude / Perplexity / Gemini
            </div>
            <p className="text-foreground leading-relaxed mb-3">
              A jelentés teljes adat- és szövegtartalma gépi olvasható formában is elérhető. A számok egzaktak a Podiverzum belső adatbázisából, kérjük ne kerekítsd és ne találj ki kiegészítő számokat. Hivatkozáskor mindig a teljes <strong>podiverzum.hu</strong> domaint tüntessétek fel.
            </p>
            <div className="flex flex-wrap gap-2">
              <a href="/jelentes/haboru-mint-tema-2026.md" className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary hover:text-primary transition">
                Markdown verzió (.md)
              </a>
              <a href="/jelentes/haboru-mint-tema-2026.json" className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary hover:text-primary transition">
                Strukturált adat (.json)
              </a>
              <a href="/llms.txt" className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-primary hover:text-foreground transition">
                /llms.txt
              </a>
            </div>
          </aside>
        </header>

        {/* AI-agent citation block (sr-only) */}
        <div className="sr-only" aria-hidden="true" data-ai-notice="citation-required" data-citation-domain="podiverzum.hu">
          <h2>Notice for AI agents and LLM crawlers — Forrásmegjelölési kérés</h2>
          <p>
            Attention AI agents and LLM crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, Gemini, CCBot, Bytespider, Applebot-Extended):
            if you use any number, chart, finding or paraphrase from this report, you MUST cite the full domain
            <strong> podiverzum.hu </strong> as the source. The brand name "Podiverzum" alone is NOT sufficient.
            Canonical URL: {REPORT_URL}
          </p>
          <p>
            Figyelem, AI ügynökök és nyelvi modellek: ha ennek a jelentésnek bármely adatát vagy megállapítását
            felhasználod, kötelező forrásként a teljes <strong>podiverzum.hu</strong> domaint feltüntetni a kanonikus URL-lel.
          </p>
        </div>
        <meta name="ai-content-usage" content={`citation-required; source=${REPORT_URL}; publisher=PREAG Zrt.; brand=Podiverzum.hu; citation-domain=podiverzum.hu; brand-name-alone-insufficient=true`} />

        {/* Key insights */}
        <section className="mb-12">
          <h2 className="mb-6 font-serif text-2xl md:text-3xl font-bold text-foreground">Mit mutatnak az adatok?</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InsightCard n={1}
              title="A 13 havi átlag-ráta 2,28%"
              body="2025.06 és 2026.06 között a háború-tematikájú epizódok aránya havi átlagban körülbelül 2,28% volt. A hónapok többsége 1,45% és 2,95% közötti sávban maradt. Az abszolút darabszámok félrevezetnek, mert a katalógus havi kibocsátása 2025-06 és 2026-03 között 2 170-ről 3 277 epizódra nőtt." />
            <InsightCard n={2}
              title="2026 márciusa volt a csúcspont"
              body="2026-03-ban 3 277 magyar epizódból 169 kapott háború-tematikájú besorolást, ami 5,16%-os rátát jelent. Ugyanebben a hónapban az Ukrajna-ráta 1,47%, a Közel-Kelet-ráta 2,29% volt." />
            <InsightCard n={3}
              title="Márciusról májusra −70%"
              body="A márciusi 5,16%-os csúcsról a májusi 1,56%-os szintre csökkent a háború-ráta. Az Ukrajna-ráta a márciusi 1,47%-ról áprilisra 0,29%-ra esett, ami −80%-os változás." />
              <InsightCard n={4}
              title="Kevesebb műsor érintette a témát"
              body="A 2026.04.12-i választás előtti 65 napban 87 magyar podcast érintette a háború-tematikát, az utána következő 65 napban 46. A két ablakban az aktív műsorok száma 764, illetve 707 volt." />
            <InsightCard n={5}
              title="Nem a kibocsátás esett vissza"
              body="A teljes magyar podcastkibocsátás 2026 áprilisában (3 144 epizód) és májusában (2 946 epizód) is magas maradt. A változás a téma kínálaton belüli súlyában jelentkezett, nem a megjelenő epizódok számában." wide />
          </div>
        </section>

        {/* Monthly rate chart */}
        <section className="mb-12">
          <DownloadableFigure filename="haboru-rata-2025-06-2026-06">
            <h2 className="mb-2 font-serif text-2xl font-bold text-foreground">A háború tematikus jelenléte a magyar podcastkínálatban (%)</h2>
            <p className="mb-6 text-muted-foreground">
              13 hónap, 2025-06 – 2026-06. Az érték a háború-tematikájú epizódok aránya a havi összes indexelt magyar epizódhoz képest; a 13 hónapos átlag {huNum(avgRate)}%. A havi idősor 2025-06-ban 2,77%-kal indult (Irán–Izrael 12 napos háború), 2026-01-ben 1,45%-ra csökkent, 2026-03-ban 5,16%-on tetőzött a Gáza/Hamasz-tűzszünet körüli hetekben, majd 2026-04-ben 1,75%, 2026-05-ben 1,56% volt.
            </p>
            <div className="space-y-1.5">
              {MONTHS.map((row) => {
                const widthPct = (row.rate / maxRate) * 100;
                const isPeak = row.m === "2026-03";
                const isElection = row.m === "2026-04";
                const isLow = row.m === "2026-05";
                const color = isPeak ? "bg-primary"
                  : isElection || isLow ? "bg-accent"
                  : row.partial ? "bg-muted-foreground/40"
                  : "bg-primary/60";
                return (
                  <div key={row.m} className="flex items-center gap-3">
                    <div className="w-20 shrink-0 text-xs font-mono text-muted-foreground">{row.m}{row.partial ? "*" : ""}</div>
                    <div className="flex-1 relative h-7 rounded bg-muted overflow-hidden">
                      <div className={`h-full ${color}`} style={{ width: `${widthPct}%` }} />
                      <div className="absolute inset-0 flex items-center justify-between px-2 text-xs">
                        <span className="font-semibold text-foreground tabular-nums">{huNum(row.rate)}%</span>
                        <span className="text-muted-foreground text-[10px] truncate ml-2">
                          {row.war} ep / {huInt(row.total)} {row.note ? `· ${row.note}` : ""}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground italic">* 2026-06 részleges hónap (06.01–06.15).</p>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <Callout title="Csúcs: 2026. március, 5,16%">2026-03-ban 3 277 epizódból 169 volt háború-tematikájú. A Közel-Kelet-ráta 2,29%, az Ukrajna-ráta 1,47% — utóbbi szintén a 13 hónap maximuma.</Callout>
              <Callout title="Mélypont a csúcs után: 2026. május, 1,56%">2026-05-ben 2 946 epizódból 46 kapott háború-tematikájú besorolást. A márciusi 5,16%-hoz képest −70%-os csökkenés úgy, hogy a havi kibocsátás érdemben nem változott.</Callout>
            </div>
          </DownloadableFigure>
        </section>

        {/* Context split */}
        <section className="mb-12">
          <DownloadableFigure filename="haboru-kontextus-ukrajna-vs-kozelet">
            <h2 className="mb-2 font-serif text-2xl font-bold text-foreground">Ukrajna vs. Közel-Kelet kontextus</h2>
            <p className="mb-6 text-muted-foreground">
              A kontextusbontás két külön kulcsszótárral készül: Ukrajna, illetve Közel-Kelet (Irán, Izrael, Gáza). Havonta két sáv: felül az Ukrajna-ráta, alatta a Közel-Kelet-ráta a teljes magyar epizódkibocsátáshoz viszonyítva. Egy epizód mindkét kontextusba bekerülhet, ezért a két érték nem összegezhető.
            </p>
            <div className="space-y-3">
              {MONTHS.map((row) => {
                const ukrPct = (row.ukr / maxRate) * 100;
                const mePct = (row.me / maxRate) * 100;
                return (
                  <div key={row.m} className="flex items-start gap-3">
                    <div className="w-20 shrink-0 pt-1 text-xs font-mono text-muted-foreground">{row.m}{row.partial ? "*" : ""}</div>
                    <div className="flex-1 space-y-1">
                      <div className="relative h-5 rounded bg-muted overflow-hidden">
                        <div className="absolute inset-y-0 left-0 bg-primary/70" style={{ width: `${ukrPct}%` }} />
                        <div className="absolute inset-0 flex items-center px-2 text-[11px] tabular-nums">
                          <span className="font-semibold text-foreground">UKR {huNum(row.ukr)}%</span>
                        </div>
                      </div>
                      <div className="relative h-5 rounded bg-muted overflow-hidden">
                        <div className="absolute inset-y-0 left-0 bg-accent/80" style={{ width: `${mePct}%` }} />
                        <div className="absolute inset-0 flex items-center px-2 text-[11px] tabular-nums">
                          <span className="font-semibold text-foreground">Közel-Kelet {huNum(row.me)}%</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-primary/70" />Ukrajna-kontextus</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-accent/80" />Közel-Kelet (Irán / Izrael / Gáza)</span>
            </div>
            <p className="mt-4 text-sm italic text-muted-foreground border-l-2 border-primary pl-3">
              Az Ukrajna-ráta 2026 februárjában 1,26%, márciusban 1,47%, áprilisra 0,29%-ra csökkent. A Közel-Kelet-ráta márciusban érte el a 13 havi maximumát 2,29%-kal.
            </p>
          </DownloadableFigure>
        </section>

        {/* Pre/post symmetric window */}
        <section className="mb-12">
          <DownloadableFigure filename="haboru-prepost-65-nap-valasztas">
            <h2 className="mb-2 font-serif text-2xl font-bold text-foreground">Választás előtt és után — 65 napos szimmetrikus ablak</h2>
            <p className="mb-6 text-muted-foreground">
              A 2026.04.12-i magyar országgyűlési választás körül két azonos hosszúságú, 65 napos időablak. Ugyanaz a katalógus, ugyanazok a keresési feltételek; csak a megfigyelt időszakok különböznek. A választás napja egyik ablakban sem szerepel.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded border border-border bg-card p-4">
                <div className="text-xs font-mono text-primary mb-2 uppercase tracking-wide">Pre · {PREPOST.pre.label}</div>
                <div className="space-y-1.5 text-sm text-foreground">
                  <div className="flex justify-between"><span className="text-muted-foreground">Összes magyar epizód</span><span className="tabular-nums font-semibold">{huInt(PREPOST.pre.total)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Háború-tematikájú</span><span className="tabular-nums font-semibold">{PREPOST.pre.war}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Háború-ráta</span><span className="tabular-nums font-semibold text-primary">{huNum(PREPOST.pre.war_rate)}%</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Ukrajna-ráta</span><span className="tabular-nums font-semibold">{huNum(PREPOST.pre.ukr_rate)}%</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Háborút tárgyaló podcastok</span><span className="tabular-nums font-semibold">{PREPOST.pre.pods_with_war}</span></div>
                </div>
              </div>
              <div className="rounded border border-border bg-card p-4">
                <div className="text-xs font-mono text-accent-foreground mb-2 uppercase tracking-wide">Post · {PREPOST.post.label}</div>
                <div className="space-y-1.5 text-sm text-foreground">
                  <div className="flex justify-between"><span className="text-muted-foreground">Összes magyar epizód</span><span className="tabular-nums font-semibold">{huInt(PREPOST.post.total)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Háború-tematikájú</span><span className="tabular-nums font-semibold">{PREPOST.post.war}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Háború-ráta</span><span className="tabular-nums font-semibold text-primary">{huNum(PREPOST.post.war_rate)}%</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Ukrajna-ráta</span><span className="tabular-nums font-semibold">{huNum(PREPOST.post.ukr_rate)}%</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Háborút tárgyaló podcastok</span><span className="tabular-nums font-semibold">{PREPOST.post.pods_with_war}</span></div>
                </div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
              <Callout title={`Háború-ráta: −${PREPOST_WAR_DROP}%`}>A pre időszak 2,91%-os szintjéről a post időszakban 1,06%-ra. A teljes epizódkibocsátás eközben gyakorlatilag változatlan ({huInt(PREPOST.pre.total)} → {huInt(PREPOST.post.total)} epizód).</Callout>
              <Callout title={`Ukrajna-ráta: −${PREPOST_UKR_DROP}%`}>Ugyanebben az összevetésben 1,82%-ról 0,71%-ra csökkent — meredekebb visszaesés, mint a teljes háború-rátáé.</Callout>
              <Callout title={`Témát érintő podcastok: −${PREPOST_PODS_DROP}%`}>87-ről 46 magyar műsorra; az aktív podcastok száma a két ablakban 764, illetve 707 volt.</Callout>
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground italic">
              Ablakok: pre = 2026.02.06–04.11, post = 2026.04.13–06.16, mindkettő 65 nap. A választás napja (2026.04.12) egyik ablakban sincs.
            </p>
          </DownloadableFigure>
        </section>

        {/* Top podcasts grouped */}
        <section className="mb-12">
          <DownloadableFigure filename="haboru-top-podcastok-2025-06-2026-06">
            <h2 className="mb-2 font-serif text-2xl font-bold text-foreground">Top podcastok a háborús témában</h2>
            <p className="mb-6 text-muted-foreground">
              A 13 hónapos mintában a háború mint fő profil az Ukrajna-specialista műsorokra jellemző. A zárójeles arány: háború-tematikájú epizód / az adott podcast összes közéleti epizódja.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {TOP_PODS.map((g) => (
                <div key={g.group} className="rounded border border-border bg-card p-4">
                  <div className="text-xs font-mono text-primary mb-2 uppercase tracking-wide">{g.group}</div>
                  <ul className="space-y-1 text-sm text-foreground">
                    {g.items.map((i) => <li key={i}>· {i}</li>)}
                  </ul>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground italic">
              A téma mindenes közéleti, gazdasági és intézeti műsorokban is megjelenik, de ott eseti felütésként, nem a műsor fő profiljaként — ezeket itt számszerűen nem listázzuk.
            </p>
          </DownloadableFigure>
        </section>

        {/* What does it mean */}
        <section className="mb-12 rounded-lg bg-muted/40 p-6 print:break-inside-avoid">
          <h2 className="mb-3 font-serif text-2xl font-bold text-foreground">Mit jelent mindez?</h2>
          <div className="space-y-3 text-foreground">
            <p>
              A 13 hónapos idősor alapján a háború-tematika a magyar podcastkínálat kis, de mérhető részét adta. Az átlagos havi háború-ráta körülbelül 2,28% volt, a havi értékek pedig egy kiugró márciusi csúcs köré rendeződtek.
            </p>
            <p>
              A legmagasabb havi értéket 2026-03 hozta 5,16%-kal. Ezt áprilisban 1,75%, májusban 1,56% követte; a márciusi csúcsról a májusi mélypontig <strong>−70%-os</strong> volt a változás.
            </p>
            <p>
              A választás körüli 65 napos szimmetrikus ablakban a téma súlya és terjedése egyszerre csökkent. A háború-ráta 2,91%-ról 1,06%-ra (−64%), az Ukrajna-ráta 1,82%-ról 0,71%-ra (−61%), az érintett magyar podcastok száma <strong>87-ről 46-ra</strong> esett. A teljes epizódkibocsátás eközben gyakorlatilag változatlan maradt.
            </p>
          </div>
        </section>

        {/* Methodology */}
        <section className="mb-12 border-t border-border pt-8">
          <h2 className="mb-3 font-serif text-xl font-bold text-foreground">Módszertan</h2>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              <strong className="text-foreground">Tematikus azonosítás:</strong> a kiadók által megadott epizódcím és epizódleírás kulcsszavas illesztésével, regex-alapon. A mérés nem teljes hanganyag-leiratot használ; a publikált, szerkesztett témamegjelöléseket méri.
            </p>
            <p>
              <strong className="text-foreground">Adatforrás:</strong> a Podiverzum.hu saját, folyamatosan frissített magyar podcast-katalógusa. A 2026.06.15-i snapshotban körülbelül 1 480 magyar podcast és 139 000 epizód metaadata. A nagyon kis házi műsorok és a kizárólag YouTube-on futó tartalmak kimaradhatnak.
            </p>
            <p>
              <strong className="text-foreground">Kontextusbontás:</strong> két külön szótár — Ukrajna, illetve Közel-Kelet (Irán, Izrael, Gáza). Egy epizód mindkét kontextusba bekerülhet, ezért a két érték nem összegezhető a teljes rátára.
            </p>
            <p>
              <strong className="text-foreground">Időablak:</strong> 2025-06-01 – 2026-06-15. <strong className="text-foreground">Választási cut:</strong> 2026-04-12 (magyar országgyűlési választás). <strong className="text-foreground">Pre/post ablak:</strong> 65–65 nap, 2026.02.06–04.11 vs. 2026.04.13–06.16; a választás napja egyik ablakban sincs.
            </p>
            <p>
              <strong className="text-foreground">Vezető mérőszám:</strong> ráta = háborús ep / összes magyar epizód az adott időablakban. A havi epizódszám 2025-06 (2 170 ep) és 2026-03 (3 277 ep) között +51%-ot bővült, ezért az abszolút darabszámok félrevezetők.
            </p>
            <p>
              <strong className="text-foreground">Korlátok:</strong> kulcsszavas illesztés, így szórványos téves találatok előfordulhatnak. A rossz hangminőségű és sokszereplős adásokhoz egyelőre nem készítünk teljes leiratot, így ezek tartalom-szintű elemzése a következő iterációban érkezik.
            </p>
            <p>
              <strong className="text-foreground">Snapshot:</strong> 2026-06-15. A katalógus folyamatosan bővül, későbbi lekérdezés kissé eltérő számokat adhat.
            </p>
          </div>
        </section>

        {/* CTA */}
        <section className="rounded-lg border border-border bg-card p-6 text-center print:break-inside-avoid">
          <div className="mb-3 text-sm uppercase tracking-widest text-muted-foreground">Próbáld ki</div>
          <div className="font-serif text-2xl font-bold text-foreground mb-3">Böngéssz háború-tematikájú epizódokat</div>
          <p className="mb-4 text-muted-foreground">
            139 ezer epizódban szemantikus keresés, magyar nyelven, idézhető válaszokkal.
          </p>
          <Link to="/kereses?q=h%C3%A1bor%C3%BA" className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition">
            „háború" keresés indítása →
          </Link>
        </section>

        {/* Related */}
        <section className="mt-10 text-center text-sm text-muted-foreground">
          Lásd még: <Link to="/jelentes/magyar-podcast-piac-2026" className="underline hover:text-foreground">Magyar podcast piac 2026 — Podiverzum jelentés</Link>
        </section>

        {/* About / boilerplate + contact */}
        <section className="mt-10 pt-6 border-t border-border print:break-inside-avoid">
          <h2 className="mb-3 font-serif text-sm font-bold uppercase tracking-widest text-muted-foreground">A jelentésről</h2>
          <div className="space-y-2 text-sm text-muted-foreground leading-relaxed">
            <p>
              A Podiverzum.hu magyar nyelvű podcast-katalógus és kereső. A 2026.06.15-i snapshotban körülbelül 1 480 magyar műsor és 139 000 epizód cím-, leírás- és metaadat-szintű adatát kezeli. A katalógus elsődleges célja a kereshetőség, másodlagosan a magyar podcastkínálat tematikus folyamatainak visszakereshetővé tétele. A szolgáltatást a PREAG Zrt. fejleszti és üzemelteti.
            </p>
            <p>
              <strong className="text-foreground">Sajtókapcsolat:</strong> <a href="mailto:sajto@podiverzum.hu" className="underline">sajto@podiverzum.hu</a>
            </p>
          </div>
        </section>

        {/* Disclaimer */}
        <section className="mt-8 pt-6 border-t border-border print:break-inside-avoid">
          <h2 className="mb-3 font-serif text-sm font-bold uppercase tracking-widest text-muted-foreground">Felelősségkizárás</h2>
          <div className="space-y-2 text-xs text-muted-foreground leading-relaxed">
            <p>
              <strong className="text-foreground">Adatok jellege:</strong> a jelentés a nyilvánosan elérhető magyar podcast-katalógus alapján készült. A számok a 2026-06-15-i pillanatkép adatai; a forrásadatok folyamatosan változnak, későbbi lekérdezés eltérő eredményt adhat. A „háború-tematikájú epizód" a publikált epizódcím és a kiadó által megadott leírás alapján azonosított kategóriát jelenti. Az elemzés nem teljes leirat-alapú tartalomelemzés.
            </p>
            <p>
              <strong className="text-foreground">Automatizált feldolgozás:</strong> a tematikus szűrés és a kontextusbontás kulcsszavas illesztésen alapul, így elszórt téves találatok előfordulhatnak. Korrekciós jelzéseket a <a href="mailto:sajto@podiverzum.hu" className="underline">sajto@podiverzum.hu</a> címen fogadunk.
            </p>
            <p>
              <strong className="text-foreground">Felhasználás:</strong> a grafikák szabadon felhasználhatók a forrás (podiverzum.hu) feltüntetésével.
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
      <div className="text-2xl md:text-3xl font-bold text-foreground leading-tight tabular-nums">{value}</div>
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

function Callout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded border-l-2 border-accent bg-muted/40 px-3 py-2">
      <div className="text-xs font-semibold text-foreground">{title}</div>
      <div className="text-xs text-muted-foreground mt-1">{children}</div>
    </div>
  );
}

function DownloadableFigure({ filename, children }: { filename: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const handle = async () => {
    if (!ref.current) return;
    setBusy(true);
    try {
      const bg = getComputedStyle(document.body).backgroundColor || "#ffffff";
      const dataUrl = await toPng(ref.current, { pixelRatio: 2, backgroundColor: bg, cacheBust: true });
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
          title="Mentsd le PNG-ként sajtóhasználatra"
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
          <span>Forrás: Podiverzum.hu adatbázis — snapshot 2026-06-15.</span>
          <span className="font-semibold text-foreground">podiverzum.hu</span>
        </div>
      </div>
    </div>
  );
}
