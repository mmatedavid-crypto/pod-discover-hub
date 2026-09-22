# Funkcióaudit javítások (2026.09.22.)

Az auditban leírt "üres epizódlisták" nem tartalomhiány. Két konkrét okot találtam, mindkettőt élőben visszaigazoltam:

1. **Hiányzó olvasási jog**: a kategória- és témaoldalak az AI-besorolás táblát kérdezik, és a szerver "hozzáférés megtagadva" hibát ad a látogatóknak. Ezért lett a Tech és a True Crime kategória üres, és ezért nem jelent meg az MI-témánál a 205 epizód.
2. **Időtúllépés terhelés alatt**: a főoldali lista újraszámolása 1,5+ percig fut és lefoglalja a lemezt; ilyenkor a látogatói kérések 3 másodperc után megszakadnak. A felület a hibát "nincs epizód" üzenetnek mutatja. Ezt a Kibeszélő műsoroldalán, a Friderikusz-személyoldalon és a kategórialistáknál is elkaptam.

## Mit csinálok

### 1. Olvasási jogok rendezése (adatbázis)
- `GRANT SELECT` az AI-besorolás táblára a látogatói szerepnek (a szabályzat már engedi az olvasást, csak a jog hiányzott).
- Ugyanez a három másik táblára, ahol a szabályzat nyilvános olvasást engedélyez, de a jog hiányzik (epizód-szövegrészletek, ízléskártyák, megosztott profilok).

### 2. A főoldali lista újraszámolása ne fojtsa meg az oldalt
- Az újraszámolás zárolás nélküli (CONCURRENTLY) módra állítása, és a jelenlegi 5 perces ütem ritkítása, hogy ne fusson folyamatosan.
- Így a látogatói kérések nem futnak időtúllépésre.

### 3. Hiba ne látszódjon üres katalógusnak (audit 02)
- Műsor-, kategória-, téma- és személyoldalon: ha a betöltés hibára fut, érthető hibaüzenet + "Újrapróbálom" gomb jelenik meg a "nincs epizód" szöveg helyett.
- Automatikus újrapróbálkozás az időtúllépéses hibákra.

### 4. Kérések könnyítése
- A kategóriaoldal jelenleg 40 műsor 180 epizódját kéri le a teljes leírásokkal együtt — ezt szűkebb mezőlistára és kisebb csomagokra bontom.
- A személyoldal 500-as említéslistáját is szűkítem, hogy a 3 másodperces korláton belül maradjon.

### 5. Nyelvi következetesség (audit 05)
- A főoldali friss epizód-sáv és az "új podcastok" lista ugyanarra a magyar besorolásra szűr, mint a többi felület (így nem jön be pl. This Podcast Will Kill You, Dear Therapists).

### 6. Megjelenítési hibák (audit 04, 06)
- Magyar relatív dátumok mindenhol ("5mo ago" → "5 hónappal ezelőtt").
- Érvénytelen entitásnév (pl. `[object Object]`) nem kap címkét és linket.
- Üres "A lényeg:" blokk elrejtése; időtartam következetes megjelenítése; ugyanaz az epizód egyszer szerepel egy listában.

## Amihez nem nyúlok
- Hosting, arculat, keresőmotor beállításai, lejátszó, útvonalak.
- A podiverzum.com oldal.
- A törölt Szélsőközép-epizód nem kerül vissza.
- Tömeges tartalomgenerálás, AI-költés növelése.

## Ellenőrzés
Élő böngészős újrateszt a hat audit-útvonalon (Kibeszélő, Tech, True Crime, MI-téma, Friderikusz, keresés), plusz build és a meglévő tesztek.

## Nyitott kérdés
A keresés ("Kibeszélő", "mesterséges intelligencia") epizódtalálat nélkül tér vissza. Ez külön ok lehet (keresőindex / relevancia), és a fentiek után külön körben vizsgálnám — nem akarom ugyanabba a csomagba tenni.
