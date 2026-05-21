import { useEffect, useState } from "react";
import { Cloud, CloudRain, CloudSnow, CloudLightning, Sun, CloudSun, CloudFog, CloudDrizzle } from "lucide-react";
import { getNameDay } from "@/lib/nameDays";

type Weather = { temp: number; code: number; label: string };

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

const HU_SHORT = new Intl.DateTimeFormat("hu-HU", { month: "long", day: "numeric", weekday: "short" });

/**
 * Kompakt napi infó szalag a SiteHeader-be, asztali nézeten (xl+).
 * Dátum · névnap · időjárás Budapest.
 */
export default function HeaderDailyBar() {
  const [weather, setWeather] = useState<Weather | null>(null);
  const now = new Date();
  const shortDate = HU_SHORT.format(now);
  const nameDay = getNameDay(now);

  useEffect(() => {
    const cached = sessionStorage.getItem("podi:weather:bp:v2");
    if (cached) {
      try {
        const w = JSON.parse(cached);
        if (typeof w?.temp === "number") setWeather({ temp: w.temp, code: w.code, label: w.label });
      } catch {}
    }
    (async () => {
      try {
        const r = await fetch(
          "https://api.open-meteo.com/v1/forecast?latitude=47.4979&longitude=19.0402&current=temperature_2m,weather_code&daily=sunrise,sunset&timezone=Europe%2FBudapest&forecast_days=1"
        );
        const j = await r.json();
        const code = Number(j?.current?.weather_code ?? 3);
        const w: Weather = {
          temp: Math.round(j?.current?.temperature_2m ?? 0),
          code,
          label: describeWeather(code).label,
        };
        setWeather(w);
        sessionStorage.setItem(
          "podi:weather:bp:v2",
          JSON.stringify({ ...w, sunrise: j?.daily?.sunrise?.[0], sunset: j?.daily?.sunset?.[0] })
        );
      } catch {
        /* csendes hiba */
      }
    })();
  }, []);

  const W = weather ? describeWeather(weather.code) : null;

  return (
    <div className="hidden xl:flex items-center gap-3 text-xs text-muted-foreground border-l border-border/50 pl-4 ml-2">
      <span className="text-foreground/80 capitalize">{shortDate}</span>
      {nameDay && (
        <span className="inline-flex items-center gap-1">
          <span className="text-muted-foreground/70">Névnap:</span>
          <span className="text-foreground/80">{nameDay}</span>
        </span>
      )}
      <span className="inline-flex items-center gap-1" title={weather ? `${weather.label} · Budapest` : "Budapest"}>
        {W ? <W.Icon className="h-3.5 w-3.5 text-primary" aria-hidden /> : <Cloud className="h-3.5 w-3.5 opacity-40" aria-hidden />}
        {weather ? <span className="text-foreground/80">{weather.temp}°C</span> : <span>—</span>}
      </span>
    </div>
  );
}
