export const SITE_PUBLISHER = {
  id: "https://podiverzum.hu/#publisher",
  displayName: "PREAG Zrt.",
  brandName: "Podiverzum",
  siteName: "Podiverzum.hu",
  siteUrl: "https://podiverzum.hu/",
  legalName: "Precíziós Agrokémia Zártkörűen Működő Részvénytársaság",
  companyRegisterNumber: "13-10-042640",
  taxId: "26558534-2-13",
  foundingDate: "2018-10-31",
  email: "hello@podiverzum.hu",
  registeredSeat: "2636 Tésa, Ady Endre utca 11.",
  address: {
    streetAddress: "Ady Endre utca 11.",
    postalCode: "2636",
    addressLocality: "Tésa",
    addressCountry: "HU",
  },
} as const;

export function sitePublisherJsonLd() {
  return {
    "@type": "Organization",
    "@id": SITE_PUBLISHER.id,
    name: SITE_PUBLISHER.displayName,
    alternateName: SITE_PUBLISHER.legalName,
    legalName: SITE_PUBLISHER.legalName,
    url: SITE_PUBLISHER.siteUrl,
    identifier: SITE_PUBLISHER.companyRegisterNumber,
    taxID: SITE_PUBLISHER.taxId,
    foundingDate: SITE_PUBLISHER.foundingDate,
    email: SITE_PUBLISHER.email,
    address: {
      "@type": "PostalAddress",
      ...SITE_PUBLISHER.address,
    },
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: SITE_PUBLISHER.email,
      availableLanguage: ["hu"],
    },
  };
}

export function siteIdentityJsonLd() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      sitePublisherJsonLd(),
      {
        "@type": "WebSite",
        "@id": "https://podiverzum.hu/#website",
        name: SITE_PUBLISHER.siteName,
        alternateName: SITE_PUBLISHER.brandName,
        url: SITE_PUBLISHER.siteUrl,
        inLanguage: "hu-HU",
        publisher: { "@id": SITE_PUBLISHER.id },
        potentialAction: {
          "@type": "SearchAction",
          target: "https://podiverzum.hu/kereses?q={search_term_string}",
          "query-input": "required name=search_term_string",
        },
      },
    ],
  };
}

export function publisherAddressLine() {
  const { postalCode, addressLocality, streetAddress } = SITE_PUBLISHER.address;
  return `${postalCode} ${addressLocality}, ${streetAddress}`;
}
