import { Component, ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Top-level error boundary. Prevents a crash deep inside providers
 * (e.g. stale localStorage shape from a previous swipe session, an
 * unexpected supabase/auth state) from black-screening the entire app.
 *
 * Renders a minimal, dependency-free fallback (no Tailwind required) so
 * it still works even if the design system failed to load.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // eslint-disable-next-line no-console
    console.error("[AppErrorBoundary]", error, info);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleRepair = () => {
    try {
      [
        "podiverzum_taste_v1",
        "podiverzum:recent-episodes:v1",
        "podiverzum:recent_searches",
        "podiverzum_player_progress_v1",
        "podiverzum_player_preview",
        "podiverzum_autoplay_mode",
        "pv_auth_redirect",
        "podi:hasSearched",
      ].forEach((key) => window.localStorage.removeItem(key));
      [
        "podiverzum_pending_archetype",
        "pv_email_capture_done",
        "pv_anon_sid",
        "pv_sid",
        "pv_source_profile_id",
        "pv_utm_snapshot",
        "pv_landing_variant",
        "podi:weather:bp:v2",
      ].forEach((key) => window.sessionStorage.removeItem(key));
    } catch {
      /* ignore */
    }
    window.location.replace("/");
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          background: "#0a0a0f",
          color: "#fff",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <div style={{ maxWidth: 480, textAlign: "center" }}>
          <div
            style={{
              fontSize: 12,
              letterSpacing: "0.25em",
              textTransform: "uppercase",
              opacity: 0.6,
              marginBottom: 12,
            }}
          >
            Podiverzum
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 12 }}>
            Valami félrement a betöltésnél
          </h1>
          <p style={{ fontSize: 14, opacity: 0.75, marginBottom: 24, lineHeight: 1.5 }}>
            Az oldal egyik része nem töltött be rendesen. Először próbáld újratölteni,
            és csak akkor töröljük a Podiverzum helyi állapotait, ha a hiba visszatér.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button
              onClick={this.handleReload}
              style={{
                display: "inline-block",
                padding: "12px 20px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.2)",
                background: "#fff",
                color: "#0a0a0f",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Oldal újratöltése
            </button>
            <button
              onClick={this.handleRepair}
              style={{
                display: "inline-block",
                padding: "10px 16px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.22)",
                background: "transparent",
                color: "#fff",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Podiverzum helyi állapot törlése
            </button>
          </div>
        </div>
      </div>
    );
  }
}
