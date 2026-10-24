// Display helpers for the pipeline health snapshot (pure; unit-tested).
export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

/** An intentional pause is never shown as a failure, and never as healthy. */
export function healthBadgeVariant(health: string): BadgeVariant {
  // The brand "default" badge is red, so it is never used for a healthy state.
  if (health === "red") return "destructive";
  if (health === "green") return "secondary";
  return "outline"; // yellow and paused: neutral outline, distinguished by their label
}

export function healthLabel(health: string): string {
  return ({ green: "rendben", yellow: "figyelni", red: "hiba", paused: "szándékosan szünetel" } as Record<string, string>)[health] ?? health;
}
