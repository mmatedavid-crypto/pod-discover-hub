export type CanonicalPersonName = {
  name: string;
  changed: boolean;
  removed_suffix?: string;
  original: string;
};

function cleanPersonNameInput(input: string): string {
  return String(input || "")
    .replace(/[“”„"]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:()[\]{}]+|[\s,;:()[\]{}.!?]+$/g, "")
    .trim();
}

function restoreVowelSuffixBase(token: string): { token: string; suffix?: string } | null {
  const rules: Array<[RegExp, string, string]> = [
    [/ával$/i, "a", "val"],
    [/ével$/i, "e", "vel"],
    [/aval$/i, "a", "val"],
    [/evel$/i, "e", "vel"],
    [/ival$/i, "i", "val"],
    [/ivel$/i, "i", "vel"],
    [/oval$/i, "o", "val"],
    [/övel$/i, "ö", "vel"],
    [/ovel$/i, "o", "vel"],
    [/uval$/i, "u", "val"],
    [/üvel$/i, "ü", "vel"],
    [/uvel$/i, "u", "vel"],
  ];
  for (const [rx, replacement, suffix] of rules) {
    if (rx.test(token)) return { token: token.replace(rx, replacement), suffix };
  }
  return null;
}

function stripAssimilatedValVel(token: string): { token: string; suffix?: string } | null {
  // Péterrel -> Péter, Judittal -> Judit. Conservative: only clear doubled
  // consonant + al/el forms on a multi-part person name.
  const m = token.match(/^(.{3,}?)([bcdfghjklmnpqrstvwxz])\2(al|el)$/i);
  if (!m) return null;
  return { token: `${m[1]}${m[2]}`, suffix: m[3] === "al" ? "val" : "vel" };
}

function stripSimpleCaseSuffix(token: string): { token: string; suffix?: string } | null {
  const rules: Array<[RegExp, string]> = [
    [/(ról|ről|rol|rol)$/i, "rol"],
    [/(nál|nél|nal|nel)$/i, "nal"],
    [/(tól|től|tol|tol)$/i, "tol"],
    [/(hoz|hez|höz)$/i, "hoz"],
    [/(nak|nek)$/i, "nak"],
    [/(ban|ben)$/i, "ban"],
    [/(ként|kent)$/i, "kent"],
    [/(ra|re)$/i, "ra"],
    [/(ba|be)$/i, "ba"],
  ];
  for (const [rx, suffix] of rules) {
    if (!rx.test(token)) continue;
    const next = token.replace(rx, "");
    if (next.length >= 3) return { token: next, suffix };
  }

  // Évát / Vandát -> Éva / Vanda. Accusative is risky on consonant-final names,
  // so only restore the common final-vowel forms.
  const accusative = token.match(/^(.{2,})(át|ét|at|et)$/i);
  if (accusative) {
    const ending = accusative[2].toLowerCase();
    const restored = ending === "ét" || ending === "et" ? "e" : "a";
    return { token: `${accusative[1]}${restored}`, suffix: "t" };
  }

  return null;
}

function canonicalizeLastToken(token: string): { token: string; suffix?: string } {
  return restoreVowelSuffixBase(token)
    || stripAssimilatedValVel(token)
    || stripSimpleCaseSuffix(token)
    || { token };
}

export function canonicalizeHungarianPersonName(input: string): CanonicalPersonName {
  const original = cleanPersonNameInput(input);
  if (!original) return { name: "", changed: false, original };

  const parts = original.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { name: original, changed: false, original };

  const last = parts[parts.length - 1];
  const canonical = canonicalizeLastToken(last);
  if (!canonical.suffix || canonical.token === last || canonical.token.length < 2) {
    return { name: original, changed: false, original };
  }

  const next = [...parts.slice(0, -1), canonical.token].join(" ");
  return {
    name: next,
    changed: next !== original,
    removed_suffix: canonical.suffix,
    original,
  };
}
