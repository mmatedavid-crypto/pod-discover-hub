import { useEffect } from "react";
import { Link } from "react-router-dom";
import Layout from "@/components/Layout";
import { setSeo } from "@/lib/seo";
import {
  publisherAddressLine,
  SITE_PUBLISHER,
  sitePublisherJsonLd,
} from "@/lib/sitePublisher";

const CANONICAL = `${SITE_PUBLISHER.siteUrl}szerkesztoseg`;

// NewsMediaOrganization JSON-LD is the schema Google News uses to evaluate
// publisher trust (E-E-A-T). Every field below reflects verifiable, public
// facts about PREAG Zrt. — no fabricated bylines or personas.
function newsMediaOrganizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "NewsMediaOrganization",
    "@id": `${SITE_PUBLISHER.siteUrl}#newsroom`,
    name: SITE_PUBLISHER.brandName,
    legalName: SITE_PUBLISHER.legalName,
    alternateName: SITE_PUBLISHER.displayName,
    url: SITE_PUBLISHER.siteUrl,
    logo: `${SITE_PUBLISHER.siteUrl}icon-512.png`,
    email: SITE_PUBLISHER.email,
    foundingDate: SITE_PUBLISHER.foundingDate,
    parentOrganization: sitePublisherJsonLd(),
    publisher: sitePublisherJsonLd(),
    address: {
      "@type": "PostalAddress",
      ...SITE_PUBLISHER.address,
    },
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "editorial",
      email: SITE_PUBLISHER.email,
      availableLanguage: ["hu"],
    },
    diversityPolicy: CANONICAL,
    ethicsPolicy: CANONICAL,
    correctionsPolicy: CANONICAL,
    ownershipFundingInfo: CANONICAL,
    masthead: CANONICAL,
    missionCoveragePrioritiesPolicy: CANONICAL,
    unnamedSourcesPolicy: CANONICAL,
    actionableFeedbackPolicy: CANONICAL,
    inLanguage: "hu-HU",
    knowsLanguage: ["hu"],
    areaServed: {
      "@type": "Country",
      name: "Magyarország",
    },
  };
}

export default function SzerkesztosegPage() {
  useEffect(() => {
    setSeo({
      title: "Szerkesztőség | Podiverzum",
      description:
        "A Podiverzum szerkesztőségi felépítése, működési elvei, felelősség és kiadói adatok. Automatizált katalógus AI feldolgozással, PREAG Zrt. felelős kiadó.",
      canonical: CANONICAL,
      jsonLd: newsMediaOrganizationJsonLd(),
      ogType: "article",
    });
  }, []);

  return (
    <Layout>
      <article className="mx-auto max-w-3xl px-4 py-10 md:py-16">
        <header className="mb-10 border-b border-border pb-8">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            {SITE_PUBLISHER.brandName}
          </p>
          <h1 className="mt-2 font-serif text-4xl leading-tight md:text-5xl">
            Szerkesztőség és kiadói adatok
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Átláthatóság a Podiverzum működéséről: ki üzemelteti, hogyan
            készülnek a szövegek, kihez lehet fordulni.
          </p>
        </header>

        <section className="prose prose-neutral dark:prose-invert max-w-none">
          <h2>Mi a Podiverzum?</h2>
          <p>
            A Podiverzum a magyar podcast-piac nyilvános katalógusa és kereső
            felülete. Nyilvánosan elérhető RSS-feed-ekből, YouTube-csatornákból
            és partner-integrációkból gyűjti be a magyar nyelvű podcast
            epizódokat, és ezeket egységes felületen, kereshetően teszi elérhetővé.
            A cél az, hogy egy hallgató, újságíró vagy kutató néhány kattintással
            megtalálja a számára releváns beszélgetést.
          </p>

          <h2>Ki üzemelteti?</h2>
          <p>
            A Podiverzum.hu-t a <strong>{SITE_PUBLISHER.legalName}</strong>{" "}
            (rövidített néven <strong>{SITE_PUBLISHER.displayName}</strong>)
            üzemelteti Magyarországon bejegyzett gazdasági társaságként.
          </p>
          <ul>
            <li>
              <strong>Cégjegyzékszám:</strong>{" "}
              {SITE_PUBLISHER.companyRegisterNumber}
            </li>
            <li>
              <strong>Adószám:</strong> {SITE_PUBLISHER.taxId}
            </li>
            <li>
              <strong>Székhely:</strong> {publisherAddressLine()}
            </li>
            <li>
              <strong>Alapítás:</strong> {SITE_PUBLISHER.foundingDate}
            </li>
            <li>
              <strong>Kapcsolat:</strong>{" "}
              <a href={`mailto:${SITE_PUBLISHER.email}`}>
                {SITE_PUBLISHER.email}
              </a>
            </li>
          </ul>
          <p>
            A felelős kiadó a PREAG Zrt. mindenkori vezetője. Nyilatkozat-,
            sajtó- és korrekciós ügyekben kizárólag a fenti e-mail cím
            hivatalos.
          </p>

          <h2>Hogyan készülnek a szövegek?</h2>
          <p>
            A Podiverzum <strong>automatizált publikáció</strong>: a katalógus
            túlnyomó része géppel — nagy nyelvi modellek (LLM-ek) és saját
            osztályozó pipeline-ok — segítségével készül. Ez a gyakorlatban ezt
            jelenti:
          </p>
          <ul>
            <li>
              <strong>Epizód-összefoglalók, kategorizálás, entitás-kinyerés</strong>{" "}
              és <strong>heti szerkesztői gyűjtések</strong> AI-rendszerekkel
              készülnek, a nyers forrásanyag (RSS-leírás, transzkript, ha
              elérhető) alapján.
            </li>
            <li>
              <strong>Rangsorolás és láthatóság</strong> algoritmikus formulával
              (a Podiverzum saját, dokumentált „HU v1" formulája) történik —
              nem szerkesztői kézi kiválasztás alapján.
            </li>
            <li>
              <strong>Emberi felügyelet</strong> a kiadó oldalán a pipeline
              minőségének, a hibajelzéseknek és a jogsértési bejelentéseknek a
              kezelésére korlátozódik. A napi tartalom-előállításba ember
              tipikusan nem nyúl bele.
            </li>
          </ul>
          <p>
            Az egyes epizód-oldalakon a „Szerző" mezőben a podcast eredeti
            készítője (a műsor kiadója) szerepel — ő az, aki a hangfelvételért
            felelős. A Podiverzum szerkesztősége csak a katalógus- és
            metaadat-réteget állítja elő; a hangtartalom szerzői jogai és
            felelőssége a műsor eredeti kiadójáé marad.
          </p>

          <h2>Mit nem csinálunk?</h2>
          <ul>
            <li>
              Nem gyártunk fiktív újságírói bylineokat, nem tulajdonítunk
              cikkeket kitalált szerzőknek.
            </li>
            <li>
              Nem hosztolunk podcast hangfájlokat — minden lejátszás a
              podcast eredeti forrásából (RSS enclosure vagy YouTube) történik.
            </li>
            <li>
              Nem szerkesztjük át, nem vágjuk meg és nem kommentáljuk felül a
              hangfelvételeket.
            </li>
            <li>
              Nem foglalunk politikai állást szerkesztőségi szinten; ha egy
              podcast politikai tartalmú, az a műsor sajátja, nem a Podiverzumé.
            </li>
          </ul>

          <h2>Hibajelzés, korrekció, eltávolítási kérelem</h2>
          <p>
            Ha egy epizód-leírás pontatlan, egy személy vagy szervezet rossz
            kontextusban jelenik meg, vagy egy podcast készítője azt szeretné,
            hogy műsora ne szerepeljen a katalógusban, kérjük írjon a{" "}
            <a href={`mailto:${SITE_PUBLISHER.email}`}>
              {SITE_PUBLISHER.email}
            </a>{" "}
            címre. A bejelentéseket 5 munkanapon belül feldolgozzuk. Podcast
            eltávolítási kérelmet (opt-out) minden esetben teljesítünk, ha az
            eredeti műsor kiadójától érkezik.
          </p>

          <h2>Finanszírozás</h2>
          <p>
            A Podiverzum működését jelenleg a PREAG Zrt. saját forrásból
            finanszírozza. Az oldal nem jelenít meg display-hirdetést,
            nem szed előfizetési díjat, és nem áll szponzorált tartalmi
            kapcsolatban egyetlen listázott podcasttal sem. Ha ez változik,
            ezen az oldalon jelezzük.
          </p>

          <h2>Adatvédelem és jogi</h2>
          <p>
            Az adatkezelésről lásd az{" "}
            <Link to="/adatvedelem">Adatvédelmi tájékoztatót</Link>, a
            felhasználási feltételeket az{" "}
            <Link to="/felhasznalasi-feltetelek">ÁSZF-et</Link>. Kapcsolat:{" "}
            <Link to="/kapcsolat">/kapcsolat</Link>.
          </p>
        </section>
      </article>
    </Layout>
  );
}
