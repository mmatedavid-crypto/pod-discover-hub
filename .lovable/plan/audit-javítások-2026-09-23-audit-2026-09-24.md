# Audit javítások (2026.09.23. audit)

Sorrend az audit javaslata szerint. Minden lépés meglévő adatok tisztításával jár, nem csak elrejtéssel.

## 1. Téves összefoglaló-állítások (P1-01)
- Hack Péter adás: az ELTE „150. évforduló” állítás javítása vagy törlése a forrás alapján.
- A napi „Ha csak ötre van időd” és heti kiemelt ajánlók összefoglalóinak célzott ellenőrzése: minden konkrét szám, évszám, évforduló visszakereshető legyen a forrásszövegben; ami nem, kikerül.
- Az összefoglaló-író utasítása: csak a forrásban szereplő számadatot írhat le.

## 2. Entitás-összekeverések (P1-02)
- Köznév- és fogalomszűrő: „Mesterséges Intelligencia”, „emberi értelem” és hasonló fogalmak nem lehetnek szervezetek; „Szakértő” és egyéb szerepnevek nem lehetnek személyek.
- Meglévő hibás szervezet- és személyrekordok elrejtése, kapcsolataik törlése, a fogalmak témaként maradnak.
- Ha egy név személyként és szervezetként is szerepel ugyanannál az adásnál (pl. Szabados Levente), a szervezet-kapcsolat törlése.
- Keresési kiemelések (legjobb cég/személy kártya) frissítése a tisztított adatból.

## 3. Személyoldal és katalógus összhang (P1-03)
- Zacher Gábor: kivizsgálni, miért hiányzik a 2026.06.02-i Kibeszélő adás a kapcsolatokból.
- „Legutóbbi említés” a ténylegesen kapcsolt legfrissebb adás dátumából számolódjon, minden személyre újraszámolva.

## 4. Nyelvi szűrés és kategóriák (P1-04, P2-03)
- „Most felfedezve” és a többi főoldali sáv ugyanazt a szigorú magyar szűrést használja.
- A két megnevezett műsor (Weekly Parsha Gems, Life Wisdom) és hasonló idegen műsorok felkutatása és a meglévő szabály szerint kezelése (biztosan idegen: törlés; bizonytalan: nem kerül magyar válogatásba).
- Kategóriaszűrő-gombok összevonása azonos megjelenített név alapján (duplikált „Önfejlesztés”).

## 5. Kattintható forráshivatkozások (P2-01)
- Az AI-összkép [1], [4] jelölései kattintható linkek lesznek, és epizódazonosítóhoz kötődnek, nem a lista sorrendjéhez; rendezéskor sem változnak.

## 6. Ajánlási indoklás és műsorleírás (P2-02, P2-04)
- Ajánlás-indoklás az epizód tényleges témáiból és a profil valós jeleiből; ha nincs egyezés, általánosabb szöveg („A korábbi választásaid alapján”).
- Profilcím ne ígérjen szűkebb fókuszt, ha az ajánlások vegyesek.
- Kibeszélő (és hasonló) műsorleírás több adás alapján; epizódok kategóriája ne öröklődjön vakon a műsortól.

## Ellenőrzés
Élő böngészős újrateszt az audit útvonalain (MI-keresés, Tech, Kibeszélő, Zacher Gábor, /napi, főoldal, stressz-keresés), tesztek, build.

## Nem nyúlok
.com oldal, törölt epizódok, arculat, hosting. Mobil és bejelentkezett teszt külön kör.
