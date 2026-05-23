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

  private handleReset = () => {
    try {
      // Clear any persisted state that could be causing the crash on
      // returning visitors (taste swipe profile, player progress, etc.).
      window.localStorage.clear();
      window.sessionStorage.clear();
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
            Úgy tűnik, egy korábbi munkamenet adata akadt el a böngésződben.
            Töröld a helyi adatokat és próbáld újra.
          </p>
          <button
            onClick={this.handleReset}
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
            Frissítés és vissza a főoldalra
          </button>
        </div>
      </div>
    );
  }
}
