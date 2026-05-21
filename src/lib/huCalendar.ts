// Magyar ünnepek és kiemelt napok 2026-ra (bővíthető)
// Forrás: hivatalos magyar munkaszüneti napok + jelentős ünnepek
type Holiday = { date: string; name: string; type: "national" | "holiday" | "memorial" };

// Format: "MM-DD" (évre független) vagy "YYYY-MM-DD" (mozgó ünnep adott évre)
const FIXED: Holiday[] = [
  { date: "01-01", name: "Újév", type: "national" },
  { date: "01-22", name: "A magyar kultúra napja", type: "memorial" },
  { date: "02-25", name: "A kommunizmus áldozatainak emléknapja", type: "memorial" },
  { date: "03-15", name: "Nemzeti ünnep – 1848", type: "national" },
  { date: "04-16", name: "Holokauszt magyarországi áldozatainak emléknapja", type: "memorial" },
  { date: "05-01", name: "A munka ünnepe", type: "national" },
  { date: "06-04", name: "Nemzeti összetartozás napja", type: "memorial" },
  { date: "08-20", name: "Államalapítás ünnepe – Szent István", type: "national" },
  { date: "10-06", name: "Az aradi vértanúk emléknapja", type: "memorial" },
  { date: "10-23", name: "Nemzeti ünnep – 1956", type: "national" },
  { date: "11-01", name: "Mindenszentek", type: "holiday" },
  { date: "12-24", name: "Szenteste", type: "holiday" },
  { date: "12-25", name: "Karácsony", type: "national" },
  { date: "12-26", name: "Karácsony másnapja", type: "national" },
  { date: "12-31", name: "Szilveszter", type: "holiday" },
];

// Mozgó ünnepek évenként
const MOVING: Holiday[] = [
  // 2026
  { date: "2026-04-05", name: "Húsvétvasárnap", type: "holiday" },
  { date: "2026-04-06", name: "Húsvéthétfő", type: "national" },
  { date: "2026-05-24", name: "Pünkösdvasárnap", type: "holiday" },
  { date: "2026-05-25", name: "Pünkösdhétfő", type: "national" },
  // 2027
  { date: "2027-03-28", name: "Húsvétvasárnap", type: "holiday" },
  { date: "2027-03-29", name: "Húsvéthétfő", type: "national" },
  { date: "2027-05-16", name: "Pünkösdvasárnap", type: "holiday" },
  { date: "2027-05-17", name: "Pünkösdhétfő", type: "national" },
];

export type UpcomingHoliday = { name: string; daysUntil: number; date: Date };

export function findNextHoliday(from: Date = new Date()): UpcomingHoliday | null {
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const candidates: { date: Date; name: string }[] = [];

  // Fixed (évre független) — idei + jövő évi
  for (const y of [from.getFullYear(), from.getFullYear() + 1]) {
    for (const h of FIXED) {
      const [m, d] = h.date.split("-").map(Number);
      candidates.push({ date: new Date(y, m - 1, d), name: h.name });
    }
  }
  // Moving (évvel együtt)
  for (const h of MOVING) {
    const [yy, mm, dd] = h.date.split("-").map(Number);
    candidates.push({ date: new Date(yy, mm - 1, dd), name: h.name });
  }

  const future = candidates
    .filter(c => c.date.getTime() >= today.getTime())
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  if (!future.length) return null;
  const next = future[0];
  const daysUntil = Math.round((next.date.getTime() - today.getTime()) / 86400_000);
  return { name: next.name, daysUntil, date: next.date };
}

// Holdfázis számítás (egyszerű algoritmus, ±1 nap pontosság elég)
export type MoonPhase = { name: string; emoji: string; illumination: number };
export function getMoonPhase(date: Date = new Date()): MoonPhase {
  // Days since known new moon 2000-01-06 18:14 UTC
  const ref = Date.UTC(2000, 0, 6, 18, 14) / 1000;
  const now = date.getTime() / 1000;
  const synodic = 29.530588853; // days
  const days = (now - ref) / 86400;
  const phase = ((days % synodic) + synodic) % synodic;
  const frac = phase / synodic; // 0..1
  const illumination = Math.round((1 - Math.cos(2 * Math.PI * frac)) / 2 * 100);

  let name = "Újhold", emoji = "🌑";
  if (frac < 0.03 || frac > 0.97) { name = "Újhold"; emoji = "🌑"; }
  else if (frac < 0.22) { name = "Növő sarló"; emoji = "🌒"; }
  else if (frac < 0.28) { name = "Első negyed"; emoji = "🌓"; }
  else if (frac < 0.47) { name = "Növő hold"; emoji = "🌔"; }
  else if (frac < 0.53) { name = "Telihold"; emoji = "🌕"; }
  else if (frac < 0.72) { name = "Fogyó hold"; emoji = "🌖"; }
  else if (frac < 0.78) { name = "Utolsó negyed"; emoji = "🌗"; }
  else { name = "Fogyó sarló"; emoji = "🌘"; }
  return { name, emoji, illumination };
}
