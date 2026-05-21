import { useEffect, useState } from "react";
import { Cloud, CloudRain, CloudSnow, CloudLightning, Sun, CloudSun, CloudFog, CloudDrizzle } from "lucide-react";
import { getNameDay } from "@/lib/nameDays";

type Weather = { temp: number; code: number; label: string };

// WMO weather codes → ikon + magyar címke
function describeWeather(code: number): { Icon: typeof Cloud; label: string } {
  if (code === 0) return { Icon: Sun, label: "Derült" };
  if (code === 1 || code === 2) return { Icon: CloudSun, label: "Részben felhős" };
  if (code === 3) return { Icon: Cloud, label: "Borult" };
  if (code === 45 || code === 48) return { Icon: CloudFog, label: "Köd" };
  if (code >= 51 && code <= 57) return { Icon: CloudDrizzle, label: "Szitálás" };
  if (code >= 61 && code <= 67) return { Icon: CloudRain, label: "Eső" };
  if (code >= 71 && code <= 77) return { Icon: CloudSnow, label: "Havazás" };
  if (code >= 80 && code <= 82) return { Icon: CloudRain, label: "Záporeső" };
  if (code >= 85 && code <= 86) return { Icon: CloudSnow, label: "Hózápor" };
  if (code >= 95) return { Icon: CloudLightning, label: "Zivatar" };
  return { Icon: Cloud, label: "Felhős" };
}

const HU_WEEKDAY = new Intl.DateTimeFormat("hu-HU", { weekday: "long" });
const HU_LONG = new Intl.DateTimeFormat("hu-HU", { year: "numeric", month: "long", day: "numeric" });

export default function NewspaperMasthead() {
  const [weather, setWeather] = useState<Weather | null>(null);
  const now = new Date();
  const weekday = HU_WEEKDAY.format(now);
  const longDate = HU_LONG.format(now);
  const nameDay = getNameDay(now);

  // Kiadás száma = év napja
  const start = new Date(now.getFullYear(), 0, 0);
  const issueNo = Math.floor((now.getTime() - start.getTime()) / 86400_000);

  useEffect(() => {
    const cached = sessionStorage.getItem("podi:weather:bp");
    if (cached) {
      try { setWeather(JSON.parse(cached)); } catch {}
    }
    (async () => {
      try {
        const r = await fetch(
          "https://api.open-meteo.com/v1/forecast?latitude=47.4979&longitude=19.0402&current=temperature_2m,weather_code&timezone=Europe%2FBudapest"
        );
        const j = await r.json();
        const w: Weather = {
          temp: Math.round(j?.current?.temperature_2m ?? 0),
          code: Number(j?.current?.weather_code ?? 3),
          label: describeWeather(Number(j?.current?.weather_code ?? 3)).label,
        };
        setWeather(w);
        sessionStorage.setItem("podi:weather:bp", JSON.stringify(w));
      } catch {
        /* csendes hiba */
      }
    })();
  }, []);

  const W = weather ? describeWeather(weather.code) : null;

  return (
    <div className="border-y-2 border-foreground/80 bg-card/40">
      {/* Felső sor: kiadásszám, dátum, helyszín */}
      <div className="container mx-auto flex items-center justify-between gap-4 py-1.5 text-[10px] uppercase tracking-[0.22em] text-muted-foreground border-b border-border/60">
        <span>Podiverzum&nbsp;·&nbsp;{issueNo}. szám</span>
        <span className="hidden sm:inline">{longDate}</span>
        <span>Budapest</span>
      </div>

      {/* Címlap-fejléc */}
      <div className="container mx-auto grid grid-cols-1 sm:grid-cols-3 items-center gap-4 py-5">
        {/* Bal: névnap */}
        <div className="text-center sm:text-left">
          <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Névnap</div>
          <div className="font-serif text-xl sm:text-2xl leading-tight mt-1">{nameDay || "—"}</div>
        </div>

        {/* Közép: nagy dátum, szerif */}
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{weekday}</div>
          <div className="font-serif text-3xl sm:text-4xl font-semibold leading-tight mt-1 tracking-tight">
            {longDate}
          </div>
        </div>

        {/* Jobb: időjárás */}
        <div className="text-center sm:text-right">
          <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Időjárás · Budapest</div>
          <div className="mt-1 inline-flex items-center gap-2 font-serif text-xl sm:text-2xl leading-tight">
            {W ? <W.Icon className="h-6 w-6 text-primary" aria-hidden /> : <Cloud className="h-6 w-6 text-muted-foreground/40" aria-hidden />}
            <span>{weather ? `${weather.temp}°C` : "—"}</span>
            {weather && <span className="text-sm text-muted-foreground font-sans">· {weather.label}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
