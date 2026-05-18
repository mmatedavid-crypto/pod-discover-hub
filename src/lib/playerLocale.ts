// Locale strings for the Smart Player on podiverzum.hu (Hungarian-only).

export type PlayerLocale = "hu";

export function getPlayerLocale(): PlayerLocale {
  return "hu";
}

type Dict = {
  preview: string;
  playbackSpeed: string;
  back15: string;
  fwd30: string;
  play: string;
  pause: string;
  close: string;
  open: string;
  seek: string;
  resumeFrom: string;
  loading: string;
  externalOnly: string;
  playbackError: string;
  durationUnknown: string;
  fallbackUnavailable: string;
  openOriginal: string;
};

const HU: Dict = {
  preview: "előnézet",
  playbackSpeed: "Lejátszási sebesség",
  back15: "Vissza 15 mp",
  fwd30: "Előre 30 mp",
  play: "Lejátszás",
  pause: "Szünet",
  close: "Bezárás",
  open: "Megnyitás",
  seek: "Tekerés",
  resumeFrom: "Folytatás innen",
  loading: "betöltés…",
  externalOnly: "Ezt az epizódot jelenleg külső lejátszóban tudod megnyitni.",
  playbackError: "Hiba",
  durationUnknown: "--:--",
  fallbackUnavailable: "Ezt az epizódot jelenleg külső lejátszóban tudod megnyitni.",
  openOriginal: "Megnyitás külső lejátszóban",
};

export function t(key: keyof Dict): string {
  return HU[key];
}

export function formatSpeedLabel(s: number): string {
  return `${String(s).replace(".", ",")}x`;
}
