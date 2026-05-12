import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { MessageSquare, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function FeedbackButton() {
  const { pathname, search } = useLocation();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const hidden =
    pathname.startsWith("/admin") || pathname === "/auth" || pathname === "/admin-bootstrap";

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (hidden) return;
    const onScroll = () => {
      if (window.scrollY > 600) setRevealed(true);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [hidden]);

  if (hidden) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const msg = message.trim();
    if (msg.length < 3) { toast.error("Az üzenet túl rövid."); return; }
    if (msg.length > 4000) { toast.error("Az üzenet túl hosszú."); return; }
    const trimmedEmail = email.trim();
    if (trimmedEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmedEmail)) {
      toast.error("Adj meg érvényes e-mail címet, vagy hagyd üresen.");
      return;
    }
    setBusy(true);
    const sp = new URLSearchParams(search);
    const { data: sess } = await supabase.auth.getSession();
    const { error } = await supabase.from("beta_feedback").insert({
      message: msg,
      email: trimmedEmail || null,
      page_url: typeof window !== "undefined" ? window.location.href : pathname,
      viewport: typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : null,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : null,
      search_query: sp.get("q") || null,
      user_id: sess.session?.user.id || null,
    });
    setBusy(false);
    if (error) { toast.error("Nem sikerült elküldeni. Próbáld meg újra."); return; }
    toast.success("Köszönjük a visszajelzést.");
    setMessage(""); setEmail(""); setOpen(false);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Visszajelzés küldése"
        className={`btn-brand fixed bottom-3 right-3 sm:bottom-4 sm:right-4 z-40 flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold shadow-lg transition-all duration-300 ${
          revealed ? "opacity-90 hover:opacity-100 translate-y-0" : "opacity-0 translate-y-3 pointer-events-none"
        }`}
      >
        <MessageSquare className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Visszajelzés</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-3 sm:p-6" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-lg bg-card border border-border shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="font-semibold">Visszajelzés küldése</h2>
              <button onClick={() => setOpen(false)} aria-label="Bezárás" className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={submit} className="p-4 space-y-3">
              <p className="text-xs text-muted-foreground">
                Írd meg, mi működött, mi nem, vagy mit szeretnél a Podiverzumtól. Minden visszajelzést elolvasunk.
              </p>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
                maxLength={4000}
                rows={5}
                placeholder="Üzenet..."
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm outline-none focus:border-accent"
              />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={320}
                placeholder="E-mail cím (ha választ is szeretnél)"
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm outline-none focus:border-accent"
              />
              <div className="flex items-center justify-end gap-2">
                <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">
                  Mégse
                </button>
                <button disabled={busy} className="btn-brand text-sm px-4 py-1.5 rounded-md disabled:opacity-50 font-semibold">
                  {busy ? "Küldés…" : "Küldés"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}