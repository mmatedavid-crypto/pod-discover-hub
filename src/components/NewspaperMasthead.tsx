import { useEffect, useState } from "react";
import { Cloud, CloudRain, CloudSnow, CloudLightning, Sun, CloudSun, CloudFog, CloudDrizzle, Sunrise, Sunset, Gift } from "lucide-react";
import { getNameDay } from "@/lib/nameDays";
import { findNextHoliday, getMoonPhase } from "@/lib/huCalendar";

type Weather = { temp: number; code: number; label: string; sunrise?: string; sunset?: string };

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

const HU_LONG = new Intl.DateTimeFormat("hu-HU", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
const HU_TIME = new Intl.DateTimeFormat("hu-HU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Budapest" });

function fmtTime(iso?: string): string {
  if (!iso) return "—";
  try { return HU_TIME.format(new Date(iso)); } catch { return "—"; }
}

export default function NewspaperMasthead() {
  const [weather, setWeather] = useState<Weather | null>(null);
  const now = new Date();
  const longDate = HU_LONG.format(now);
  const nameDay = getNameDay(now);
  const moon = getMoonPhase(now);
  const nextHoliday = findNextHoliday(now);

  useEffect(() => {
    const cached = sessionStorage.getItem("podi:weather:bp:v2");
    if (cached) {
      try { setWeather(JSON.parse(cached)); } catch {}
    }
    (async () => {
      try {
        const r = await fetch(
          "https://api.open-meteo.com/v1/forecast?latitude=47.4979&longitude=19.0402&current=temperature_2m,weather_code&daily=sunrise,sunset&timezone=Europe%2FBudapest&forecast_days=1"
        );
        const j = await r.json();
        const w: Weather = {
          temp: Math.round(j?.current?.temperature_2m ?? 0),
          code: Number(j?.current?.weather_code ?? 3),
          label: describeWeather(Number(j?.current?.weather_code ?? 3)).label,
          sunrise: j?.daily?.sunrise?.[0],
          sunset: j?.daily?.sunset?.[0],
        };
        setWeather(w);
        sessionStorage.setItem("podi:weather:bp:v2", JSON.stringify(w));
      } catch {
        /* csendes hiba */
      }
    })();
  }, []);

  const W = weather ? describeWeather(weather.code) : null;

  // Egysoros híroldal-szalag — minden infó egy sorban, kis betűs, homogén tipográfia
  return (
    <div className="border-y border-border bg-card/30">
      <div className="container mx-auto flex flex-wrap items-center gap-x-5 gap-y-1.5 py-2 text-xs text-muted-foreground">
        <span className="text-foreground font-medium">{longDate}</span>

        {nameDay && (
          <span><span className="text-muted-foreground/70">Névnap:</span> <span className="text-foreground">{nameDay}</span></span>
        )}

        <span className="inline-flex items-center gap-1.5">
          {W ? <W.Icon className="h-3.5 w-3.5 text-primary" aria-hidden /> : <Cloud className="h-3.5 w-3.5 opacity-40" aria-hidden />}
          {weather ? <span className="text-foreground">{weather.temp}°C</span> : <span>—</span>}
          {weather && <span className="text-muted-foreground/80">· {weather.label}</span>}
          <span className="text-muted-foreground/70">· Budapest</span>
        </span>

        <span className="inline-flex items-center gap-1">
          <Sunrise className="h-3.5 w-3.5 text-amber-500" aria-hidden />
          {fmtTime(weather?.sunrise)}
        </span>
        <span className="inline-flex items-center gap-1">
          <Sunset className="h-3.5 w-3.5 text-orange-500" aria-hidden />
          {fmtTime(weather?.sunset)}
        </span>

        <span className="inline-flex items-center gap-1.5" title={`Hold világítás: ${moon.illumination}%`}>
          <span className="text-sm leading-none" aria-hidden>{moon.emoji}</span>
          <span>{moon.name}</span>
        </span>

        {nextHoliday && (
          <span className="inline-flex items-center gap-1.5 ml-auto">
            <Gift className="h-3.5 w-3.5 text-primary" aria-hidden />
            {nextHoliday.daysUntil === 0
              ? <span className="text-foreground">Ma: {nextHoliday.name}</span>
              : <span><span className="text-foreground font-medium">{nextHoliday.daysUntil}</span> nap a következő ünnepig: <span className="text-foreground">{nextHoliday.name}</span></span>}
          </span>
        )}
      </div>
    </div>
  );
}
