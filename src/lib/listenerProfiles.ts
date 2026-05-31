// Receipt-friendly hallgatói profilok ("listener profiles").
// 8 launch profile. Mind viral-safe — semmi vallás/politika/egészség/szexualitás
// dimenzió, mindenkinek osztható, flattering hangvétel.
//
// A meglévő `ARCHETYPES` (tasteArchetypes.ts) eredménye → mapping az itteni
// 8 profil egyikére. A swipe-pipeline így változatlan marad.

export type ListenerProfile = {
  id: string;
  /** Display név magyarul, kis kezdőbetűs határozott névelővel. */
  name: string;
  /** 3 rövid, pozitív tulajdonság — a nyugta sorai. */
  traits: [string, string, string];
  /** Egy rövid "ajánlott irány" sor. */
  recommendedDirection: string;
};

export const LISTENER_PROFILES: ListenerProfile[] = [
  {
    id: "fokuszalt_elemzo",
    name: "A Fókuszált Elemző",
    traits: ["elemző", "fókuszált", "mélyre megy"],
    recommendedDirection: "Hosszú beszélgetések, szakmai mélység",
  },
  {
    id: "melyinterju_vadasz",
    name: "A Mélyinterjú-vadász",
    traits: ["kíváncsi", "türelmes", "gondolatkereső"],
    recommendedDirection: "Életutak, fordulópontok, őszinte vallomások",
  },
  {
    id: "strategiai_figyelo",
    name: "A Stratégiai Figyelő",
    traits: ["üzleti", "előrelátó", "rendszerező"],
    recommendedDirection: "Üzlet, vezetés, hosszú távú gondolkodás",
  },
  {
    id: "kozeleti_radar",
    name: "A Fókuszált Elemző",
    traits: ["elemző", "kritikus", "összefüggést keres"],
    recommendedDirection: "Elemző beszélgetések, társadalmi kontextus",
  },
  {
    id: "uzleti_navigator",
    name: "Az Üzleti Navigátor",
    traits: ["piacfigyelő", "gyakorlatias", "döntésorientált"],
    recommendedDirection: "Piacok, befektetés, gazdasági realitás",
  },
  {
    id: "tech_kivancsi",
    name: "A Tech Kíváncsi",
    traits: ["jövőfigyelő", "kísérletező", "nyitott"],
    recommendedDirection: "AI, technológia, jövőkép",
  },
  {
    id: "kulturflaneur",
    name: "A Kultúrflâneur",
    traits: ["érzékeny", "ízléses", "történetkereső"],
    recommendedDirection: "Kultúra, könyv, film, eszmék",
  },
  {
    id: "tortenetkereso",
    name: "A Történetkereső",
    traits: ["emberközeli", "kíváncsi", "lassú figyelmű"],
    recommendedDirection: "Emberi sorsok, lassú, kontemplatív adások",
  },
];

const BY_ID = new Map(LISTENER_PROFILES.map((p) => [p.id, p]));

/** Régi archetype id (tasteArchetypes) → új listener profile id. */
const ARCHETYPE_TO_PROFILE: Record<string, string> = {
  strategic_curious: "strategiai_figyelo",
  deep_dive: "melyinterju_vadasz",
  future_watcher: "tech_kivancsi",
  public_radar: "fokuszalt_elemzo",
  story_collector: "tortenetkereso",
  market_realist: "uzleti_navigator",
  culture_hunter: "kulturflaneur",
  science_explorer: "tech_kivancsi",
  meaning_seeker: "tortenetkereso",
  calm_observer: "tortenetkereso",
  performance_watcher: "fokuszalt_elemzo",
  discovery_listener: "kulturflaneur",
};

export function profileForArchetypeId(archetypeId: string | null | undefined): ListenerProfile {
  if (archetypeId) {
    const mapped = ARCHETYPE_TO_PROFILE[archetypeId];
    if (mapped && BY_ID.has(mapped)) return BY_ID.get(mapped)!;
    if (BY_ID.has(archetypeId)) return BY_ID.get(archetypeId)!;
  }
  return LISTENER_PROFILES[0];
}

export function profileById(id: string | null | undefined): ListenerProfile | null {
  if (!id) return null;
  return BY_ID.get(id) ?? null;
}

/** PZ-YYYY-MMDD-XXXX kis számkód a "receipt no" sorhoz. */
export function buildReceiptNumber(seed: string, when = new Date()): string {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) >>> 0;
  const four = (h % 9000) + 1000;
  const y = when.getFullYear();
  const mm = String(when.getMonth() + 1).padStart(2, "0");
  const dd = String(when.getDate()).padStart(2, "0");
  return `PZ-${y}-${mm}${dd}-${four}`;
}
