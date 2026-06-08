export const SITE_PUBLISHER = {
  displayName: "PREAG Zrt.",
  legalName: "Precíziós Agrokémia Zártkörűen Működő Részvénytársaság",
  companyRegisterNumber: "13-10-042640",
  taxId: "26558534-2-13",
  foundingDate: "2018-10-31",
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
    name: SITE_PUBLISHER.displayName,
    legalName: SITE_PUBLISHER.legalName,
    identifier: SITE_PUBLISHER.companyRegisterNumber,
    taxID: SITE_PUBLISHER.taxId,
    foundingDate: SITE_PUBLISHER.foundingDate,
    address: {
      "@type": "PostalAddress",
      ...SITE_PUBLISHER.address,
    },
  };
}

export function publisherAddressLine() {
  const { postalCode, addressLocality, streetAddress } = SITE_PUBLISHER.address;
  return `${postalCode} ${addressLocality}, ${streetAddress}`;
}
