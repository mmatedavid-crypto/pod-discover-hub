// Deterministic archetype mapping for "A Te Podiverzumod" result page.
// Score each archetype by summing tagWeight × affinity. Highest wins.

export type Archetype = {
  id: string;
  name: string;
  tagline: string; // 1-2 sentence deterministic explanation
  topics: string[];
  affinity: Record<string, number>; // tag -> weight
};

export type ArchetypeScore = {
  id: string;
  name: string;
  score: number;
};

export const ARCHETYPES: Archetype[] = [
  {
    id: "strategic_curious",
    name: "A Stratégiai Kíváncsi",
    tagline: "Szereted, ha egy beszélgetés rendszerszinten ad keretet a világhoz — üzlet, döntés, hosszú távú gondolkodás.",
    topics: ["üzlet", "stratégia", "vezetés"],
    affinity: { üzlet: 3, stratégia: 3, vezetés: 2, gazdaság: 2, karrier: 2, döntéshozatal: 2, jövő: 1 },
  },
  {
    id: "deep_dive",
    name: "A Mélyfúró",
    tagline: "A hosszú, részletes, szakmailag mély beszélgetéseket keresed — a felszín alá ásó adásokat.",
    topics: ["mélyinterjú", "szakmai"],
    affinity: { "hosszú beszélgetés": 3, mélyinterjú: 3, szakmai: 2, "belső mélység": 2, dokumentarista: 2 },
  },
  {
    id: "future_watcher",
    name: "A Jövőfigyelő",
    tagline: "MI, technológia, jövőkép — szeretsz előre nézni, és érdekel, hogyan változik körülöttünk a világ.",
    topics: ["MI", "technológia", "jövő"],
    affinity: { AI: 3, technológia: 3, jövő: 3, innováció: 2, startup: 1, tudomány: 1 },
  },
  {
    id: "public_radar",
    name: "A Közéleti Radar",
    tagline: "Érdekel a közélet, politika és társadalom — nem mindegy, mi történik körülötted.",
    topics: ["közélet", "politika"],
    affinity: { közélet: 3, politika: 3, társadalom: 2, geopolitika: 2, demokrácia: 2, "magyar közélet": 2 },
  },
  {
    id: "story_collector",
    name: "Az Emberi Történetek Gyűjtője",
    tagline: "A személyes utak, fordulópontok, őszinte vallomások vonzanak — az ember a középpontban.",
    topics: ["életutak", "interjú"],
    affinity: { életutak: 3, "személyes történet": 3, interjú: 2, "emberi sorsok": 3, fordulópont: 2 },
  },
  {
    id: "market_realist",
    name: "A Piaci Realista",
    tagline: "Pénz, piacok, befektetés — a számok és a valós gazdasági folyamatok érdekelnek.",
    topics: ["pénzügy", "befektetés"],
    affinity: { pénzügy: 3, befektetés: 3, gazdaság: 3, tőzsde: 2, piacok: 2, ingatlan: 1 },
  },
  {
    id: "culture_hunter",
    name: "A Kultúra- és Gondolatvadász",
    tagline: "Könyv, film, művészet, eszmék — a kultúra és a gondolatok világa az otthonod.",
    topics: ["kultúra", "művészet"],
    affinity: { kultúra: 3, művészet: 2, irodalom: 2, film: 2, filozófia: 2, eszmék: 2 },
  },
  {
    id: "science_explorer",
    name: "A Tudományos Felfedező",
    tagline: "Tudomány, kutatás, evidenciaalapú gondolkodás — a megértés öröme hajt.",
    topics: ["tudomány", "kutatás"],
    affinity: { tudomány: 3, kutatás: 3, evidencia: 2, természet: 2, agy: 1, biológia: 1 },
  },
  {
    id: "meaning_seeker",
    name: "A Hit és Értelem Keresője",
    tagline: "A hitről, kételyről, életértelemről szóló őszinte beszélgetések közel állnak hozzád.",
    topics: ["hit", "filozófia", "életértelem"],
    affinity: { hit: 3, spiritualitás: 3, vallás: 2, "életértelem": 3, filozófia: 2, "értelemkeresés": 3 },
  },
  {
    id: "calm_observer",
    name: "A Nyugodt Megfigyelő",
    tagline: "Halkabb, megfontolt, kontemplatív tartalmak — nem kapkodós, mély adások.",
    topics: ["nyugodt", "kontemplatív"],
    affinity: { nyugodt: 3, halk: 2, kontemplatív: 3, "lassú beszélgetés": 2, természet: 1, csend: 2 },
  },
  {
    id: "performance_watcher",
    name: "A Teljesítményfigyelő",
    tagline: "Egészség, teljesítmény, önfejlesztés — fontos, hogyan működsz a legjobban.",
    topics: ["egészség", "teljesítmény"],
    affinity: { egészség: 3, teljesítmény: 3, sport: 2, edzés: 2, önfejlesztés: 3, biohacking: 1 },
  },
  {
    id: "discovery_listener",
    name: "A Felfedező Hallgató",
    tagline: "Szereted a vegyes ízeket — egy jó adás bárhonnan jöhet, ha érdekes ember beszél benne.",
    topics: ["vegyes", "felfedezés"],
    affinity: { "discovery": 2, "niche": 2, "új tartalom": 2, kíváncsiság: 3, vegyes: 2 },
  },
];

export function pickArchetype(tagWeights: Record<string, number>): Archetype {
  const decision = scoreArchetypes(tagWeights);
  return decision.winner;
}

export function scoreArchetypes(tagWeights: Record<string, number>): {
  winner: Archetype;
  rawWinner: Archetype;
  scores: ArchetypeScore[];
  explicitPublicSignals: number;
  publicScore: number;
  bestNonPublicScore: number;
} {
  const scores = ARCHETYPES.map((a) => ({
    id: a.id,
    name: a.name,
    score: Object.entries(a.affinity).reduce((s, [tag, aff]) => s + (tagWeights[tag] || 0) * aff, 0),
  })).sort((a, b) => b.score - a.score);
  let best = ARCHETYPES[0];
  let bestScore = -Infinity;
  let bestNonPublic = ARCHETYPES[0];
  let bestNonPublicScore = -Infinity;
  let publicScore = 0;
  for (const score of scores) {
    const a = ARCHETYPES.find((candidate) => candidate.id === score.id) ?? ARCHETYPES[0];
    const s = score.score;
    if (a.id === "public_radar") publicScore = s;
    if (a.id !== "public_radar" && s > bestNonPublicScore) {
      bestNonPublicScore = s;
      bestNonPublic = a;
    }
    if (s > bestScore) {
      bestScore = s;
      best = a;
    }
  }
  const rawWinner = best;
  // Public-affairs cards are common and can accidentally dominate a mixed
  // profile. Only return that archetype when it is both absolutely strong and
  // clearly stronger than the closest non-political alternative.
  const explicitPublicSignals =
    (tagWeights.közélet || 0) +
    (tagWeights.politika || 0) +
    (tagWeights["magyar közélet"] || 0) +
    (tagWeights.geopolitika || 0) +
    (tagWeights.demokrácia || 0);
  if (
    best.id === "public_radar" &&
    (publicScore < 14 || explicitPublicSignals < 4 || bestScore < bestNonPublicScore + 8)
  ) {
    best = bestNonPublic;
  }
  return {
    winner: best,
    rawWinner,
    scores,
    explicitPublicSignals,
    publicScore,
    bestNonPublicScore,
  };
}

// Softmax-style confidence: how dominant is the top archetype?
export function archetypeConfidence(tagWeights: Record<string, number>): number {
  const scores = ARCHETYPES.map(a => {
    let s = 0;
    for (const [tag, aff] of Object.entries(a.affinity)) s += (tagWeights[tag] || 0) * aff;
    return Math.max(0, s);
  });
  const sum = scores.reduce((s, v) => s + v, 0);
  if (sum === 0) return 0;
  const top = Math.max(...scores);
  return Math.min(1, top / sum * ARCHETYPES.length / 3);
}
