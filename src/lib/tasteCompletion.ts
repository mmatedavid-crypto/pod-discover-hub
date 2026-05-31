export function shouldCompleteTasteProfile(
  totalSwipes: number,
  positiveSwipes: number,
  confidence: number,
): boolean {
  if (totalSwipes >= 10 && positiveSwipes >= 6 && confidence >= 0.72) return true;
  if (totalSwipes >= 22 && positiveSwipes >= 5 && confidence >= 0.60) return true;
  if (totalSwipes >= 30) return true;
  return false;
}

export function isCompletedTasteProgress(input: {
  completedAt?: string | null;
  seenCardIds: string[];
  likedCardIds: string[];
}): boolean {
  return Boolean(input.completedAt || input.likedCardIds.length >= 6 || input.seenCardIds.length >= 10);
}

export function tasteProgressCopy(
  totalSwipes: number,
  positiveSwipes: number,
  confidence: number,
): string {
  if (totalSwipes === 0) return "Pár döntés, és indulnak a személyes ajánlások.";
  if (totalSwipes < 6) return `Még ${6 - totalSwipes} gyors döntés, hogy ráérezzünk.`;
  if (positiveSwipes < 4) return "Mutatunk még pár irányt, hogy legyen miből ajánlani.";
  if (confidence >= 0.72 && positiveSwipes >= 6) return "Elég erős a profilod, jönnek az ajánlások.";
  if (totalSwipes < 10) return `Még ${10 - totalSwipes} finomító döntés.`;
  return "Már elég sokat tudunk rólad, hamarosan kész.";
}
