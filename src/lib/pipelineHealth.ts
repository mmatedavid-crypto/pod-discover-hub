// Display helpers for the pipeline health snapshot (pure; unit-tested).
export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

/** An intentional pause is never shown as a failure, and never as healthy. */
export function healthBadgeVariant(health: string): BadgeVariant {
  if (health === "red") return "destructive";
  if (health === "green") return "default";
  if (health === "paused") return "outline";
  return "secondary";
}

export function healthLabel(health: string): string {
  return ({ green: "rendben", yellow: "figyelni", red: "hiba", paused: "szándékosan szünetel" } as Record<string, string>)[health] ?? health;
}
