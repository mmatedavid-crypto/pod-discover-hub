# Keresés és ajánlások: globális minőségmérés, utána hibaosztályonkénti javítás

## Miért nem elég az eddigi
Az eddigi javítások (fizika-ajánlás, „mostanában”) szabályként minden keresésre hatnak, de egy-egy panaszból indultak. Nincs mérés arról, hogy a keresés egészében hány találat rossz. A rendszerben van egy 310 tesztkérdésből álló készlet, de utoljára májusban futott, és a találatokat soha senki nem pontozta: a pontossági mezők üresek.

## 1. Teljes körű mérés (alapállapot)
- Tesztkészlet: a meglévő 310 kérdés, kiegészítve a látogatók elmúlt 90 napos valódi kereséseivel és a Search Console-ból érkező kérdésekkel, típusonként kiegyensúlyozva (téma, személy, cég, kérdés, időre utaló, elírás, hangulat).
- Minden kérdésre lefut a valódi kereső úgy, ahogy a látogató látja (első 10 találat), és az ajánlásokból egy 200 epizódos minta.
- Minden találatot egy olcsó AI-bíráló pontoz egyenként (0 = nem a témáról szól, 1 = érinti, 2 = pontosan erről szól), indoklással. Egy kisebb mintát egy erősebb AI is pontoz, így kiderül, mennyire megbízható a bírálat.
- Eredmény kérdéstípusonként: hány első találat jó, hány teljes témaugrás van, hány üres a találati lista, mennyi a válaszidő.
- Becsült költség: kb. 1–2 USD egyszeri keret, ennél többet nem költ.

## 2. Hibaosztályok azonosítása
A rossz találatokat nem egyenként javítom, hanem ok szerint csoportosítom, például:
- rokon szavas bővítés témát vált (gazdaság → infláció → vallási böjt),
- csak egy kulcsszó egyezik, a téma nem,
- hírműsorok általános epizódjai minden kérdésre bejönnek,
- az utólagos rangsoroló felülírja a helyes sorrendet,
- személy/cég nevének rossz feloldása,
- ajánlásnál a műfaj nem stimmel.
Minden osztályhoz megadom, a teszthalmaz hány százalékát érinti.

## 3. Javítás osztályonként, a teljes halmazon ellenőrizve
- A leggyakoribb hibaosztálytól kezdem.
- Egy javítás csak akkor marad élesben, ha a teljes tesztkészleten javít, és egyik kérdéstípus sem romlik. Ezt egy elkülönített, a javításnál nem használt kérdéscsoporton is ellenőrzöm, hogy ne csak a tesztkérdésekre legyen igazítva.
- Ami nem javít, az visszakerül az előző állapotra.

## 4. Folyamatos figyelés
- Hetente automatikus mérés ugyanazon a készleten, kis kerettel.
- Telegram-riasztás, ha bármely kérdéstípus pontossága érezhetően romlik.
- Az admin keresési teszt oldalon megjelenik a trend.

## Időzítési megjegyzés
Most fut a régi keresővektorok újrakészítése (kb. 6 nap). A vektorfüggetlen hibaosztályok (szóbővítés, kulcsszó-egyezés, hírműsorok, rangsoroló) javíthatók most. A vektoros részt az újrakészítés végén újramérem.

## Határok
Nem kerül publikusra leirat, a `.com` nem változik, emailküldés nincs, a bírálathoz egyszeri 1–2 USD keret, a heti méréshez külön kis napi limit.

## Technikai részletek
- Meglévő táblák: `search_golden_queries`, `search_benchmark_runs`, `search_benchmark_results` (a precision/nDCG mezők ma üresek).
- Új szolgáltatás-oldali benchmark-futtató (belső tokennel, költségfoglalással), a keresőt a valódi `search-hybrid` úton hívja (nem cache), az ajánlásokat a `similar_episodes` / `get_related_episodes_by_embedding` úton.
- Bíráló: Lovable AI Gateway olcsó modell, kötegelt pontozás, epizódonként cím + műsor + nyilvános leírás (nem leirat); kalibrációs minta erősebb modellel, egyezési arány riportolva.
- Mutatók: P@3, P@10, nDCG@10, témaugrás-arány, üres-arány, p50/p95 idő, kérdéstípusonként; fejlesztési és visszatartott csoport szétválasztva.
- Minden rangsor-változás verziózott (`ranking_version`), így a cache érvénytelenül és visszaállítható.
