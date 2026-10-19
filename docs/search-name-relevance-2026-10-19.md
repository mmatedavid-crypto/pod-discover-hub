# Teljes nevek keresési hibájának javítása

Érintett projekt: Podiverzum HU (`yoxewklaybougzpmzvkg`).

A korábbi szerveroldali „szigorú” névkeresés összefűzte a címet, a személynévlistát és a leírásokat, majd külön ellenőrizte a név szavait. Ezért a „Hajós Szilárd és S. Miller András” cím megfelelt a „Hajós András” keresésnek. A szigorú ág ezután dátum szerint rendezett. A későbbi szűrő egyetlen névrészletet is elegendőnek tekintett, a tartalék kereső pedig a különálló szavakat pontozta.

A javítás közös, determinisztikus teljesnév-illesztést használ a szerveren és a böngészős tartalék ágban. Az egyezés egy mezőn vagy egyetlen személynévlistás elemen belül szükséges. Kezeli a kis- és nagybetűket, az ékezet nélküli keresést, a szóközöket és szűk magyar toldalékokat. Nem talál ki névváltozatokat; eltérő névalakot csak elfogadott, globális katalógusalias alapján használ a szerver.

A teljes névvel egyező címek előbb jelennek meg; ezt a végső rendezés a műsorok változatosságát biztosító átrendezés után is megőrzi. A személykapcsolati táblából csak `accepted` kapcsolat ad önálló bizonyítékot. A puszta szöveges említés továbbra sem jelent megszólaló vendéget, és a javítás nem módosít személyazonosságot vagy epizódkapcsolatot.

Az `active` nyilvános, indexelhető személyek felismerése a böngészős kereső meglévő szabályával egyezően működik. A szerver rangsorolási verziójának minimuma 7; a böngészős találati gyorsítótár új névteret kap.

## Ellenőrzés

- 45 célzott teszt: több különböző név ütközése, toldalékolás, ékezetek, mezőhatárok, kezdeti betű, leírásban szereplő teljes név, elfogadott és függő kapcsolatok, műsoronkénti változatosság, tematikus/kategóriás keresés.
- A teljes `search-hybrid` kéréskezelő helyben is lefut a négy írásváltozattal, helyettesített adatforrással és tiltott modellhívásokkal.
- Az élő adatbázison csak olvasási ellenőrzés történt: az új indexelt jelöltfeltétel a jelentett téves epizódra hamis, négy ellenőrzött Hajós András-interjúra igaz, köztük két „Andrással” címre.
- Frontend production build és TypeScript-ellenőrzés sikeres.
- Az npm lockfile a kiinduló ágon nincs összhangban a package.json fájllal; ezért helyi ellenőrzéshez `npm install --package-lock=false --ignore-scripts` kellett. Függőséget/lockfile-t a javítás nem változtat.

## Élesítés

A kód önmagában nem igazolja az éles működést. A `CODEX_INSTRUCTIONS.md` alapján a `search-hybrid` edge függvényt a Lovable jóváhagyott kiadási útján kell telepíteni, majd a frontend új változatát publikálni. Nincs adatbázis-migráció, új titok, költségkeret- vagy háttérfeldolgozó-módosítás. A javítás nem ad hozzá AI-modellhívást.

Élesítés után ellenőrizendő: `Hajós András`, `hajós andrás`, `hajos andras`, valamint más személynevek és általános témakeresések. A `8d6e3bd5-7220-4755-8147-f8c5bc00b5d0` epizód nem kaphat teljesnév-egyezést; a valódi interjúknak meg kell maradniuk. Névazonosságot önmagában egy szöveges egyezés nem bizonyít azonos nevű emberek között.
