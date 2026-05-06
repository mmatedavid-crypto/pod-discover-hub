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

  // Hide on admin and auth routes — those users have other channels.
  const hidden =
    pathname.startsWith("/admin") || pathname === "/auth" || pathname === "/admin-bootstrap";

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (hidden) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const msg = message.trim();
    if (msg.length < 3) { toast.error("Please add a short message."); return; }
    if (msg.length > 4000) { toast.error("Message is too long."); return; }
    const trimmedEmail = email.trim();
    if (trimmedEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmedEmail)) {
      toast.error("Please enter a valid email or leave it blank.");
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
    if (error) { toast.error("Could not send. Please try again."); return; }
    toast.success("Thanks — feedback sent.");
    setMessage(""); setEmail(""); setOpen(false);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Send feedback"
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-4 py-2.5 text-sm shadow-lg hover:opacity-90"
      >
        <MessageSquare className="h-4 w-4" />
        <span className="hidden sm:inline">Feedback</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-3 sm:p-6" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-lg bg-card border border-border shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="font-semibold">Send feedback</h2>
              <button onClick={() => setOpen(false)} aria-label="Close" className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={submit} className="p-4 space-y-3">
              <p className="text-xs text-muted-foreground">
                Tell us what worked, what didn't, or what you wish Podiverzum did. We read everything.
              </p>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
                maxLength={4000}
                rows={5}
                placeholder="What's on your mind?"
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm outline-none focus:border-accent"
              />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={320}
                placeholder="Email (optional, if you'd like a reply)"
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm outline-none focus:border-accent"
              />
              <div className="flex items-center justify-end gap-2">
                <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">
                  Cancel
                </button>
                <button disabled={busy} className="bg-primary text-primary-foreground text-sm px-3 py-1.5 rounded-md disabled:opacity-50">
                  {busy ? "Sending…" : "Send"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
