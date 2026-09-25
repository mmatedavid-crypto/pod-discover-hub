# Mobil fejléc és keresési lekérdezések

## Mit módosítok
- 360 px szélességen a Podiverzum felirat és a „Te Podiverzumod” szöveg helyett kompakt ikonok jelennek meg, miközben a menü- és fiókgombok legalább 40×40 px-es érintési felületet kapnak.
- A fejléc teljes szélessége a képernyőn belül marad; 400 px felett fokozatosan visszatér a felirat, nagyobb képernyőn a jelenlegi megjelenés marad.
- A személy- és szervezetlinkek ellenőrzését egy közös adatlekérésbe vonom össze, így a találati oldal nem indít külön lekérdezést mindkét típusra.

## Ellenőrzés
- 360, 390 és 768 px szélességen ellenőrzöm, hogy nincs vízszintes kilógás és minden gomb kényelmesen használható.
- Megmérem a keresési találati oldal adatlekéréseinek számát, és ellenőrzöm a Szabados Levente-linkeket is.
- Ellenőrzöm, hogy az oldal hibamentesen elkészül.

## Technikai részletek
- A közös linkellenőrzés egy olvasási adatbázis-függvényt használ; a publikus, elfogadott epizóddal rendelkező céloldalak szabálya nem változik.
- A keresési találatok kiválasztása és sorrendje nem változik.
