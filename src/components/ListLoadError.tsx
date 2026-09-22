import { RefreshCw } from "lucide-react";

/**
 * Shown when an episode/entity list fails to load (most often a database
 * statement timeout under load). Never render "nincs tartalom" in that case —
 * it makes a full catalog look empty.
 */
export default function ListLoadError({
  onRetry,
  message = "Az epizódok betöltése most nem sikerült — ez átmeneti hiba, a tartalom a helyén van.",
}: {
  onRetry: () => void;
  message?: string;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-6 text-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <span className="text-muted-foreground">{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex w-fit items-center gap-2 rounded-md border border-border px-3 py-2 font-medium transition-colors hover:border-primary/50 hover:text-primary"
      >
        <RefreshCw className="h-4 w-4" aria-hidden />
        Újrapróbálom
      </button>
    </div>
  );
}
