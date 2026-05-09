import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const KEY = "podiverzum:theme";

function applyTheme(t: "dark" | "light") {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(t);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const saved = (localStorage.getItem(KEY) as "dark" | "light" | null) || "dark";
    setTheme(saved);
    applyTheme(saved);
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    try { localStorage.setItem(KEY, next); } catch { /* noop */ }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={theme === "dark" ? "Light mode" : "Dark mode"}
      className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-border bg-card/60 text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
