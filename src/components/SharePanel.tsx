import { useState } from "react";
import { Share2, Check, Link2, Facebook, MessageCircle, Send } from "lucide-react";

// Explicit platform icons for X (Twitter) and Messenger — lucide has no dedicated X icon.
function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function MessengerIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12 2C6.36 2 2 6.13 2 11.7c0 2.91 1.19 5.44 3.14 7.17.16.14.26.34.27.56l.05 1.78a.8.8 0 001.12.71l1.98-.87a.8.8 0 01.53-.04c.9.25 1.86.38 2.91.38 5.64 0 10-4.13 10-9.7S17.64 2 12 2zm6.01 7.5l-2.94 4.66a1.5 1.5 0 01-2.16.4L10.57 12.7a.6.6 0 00-.72 0l-3.17 2.4c-.42.32-.97-.18-.7-.63l2.94-4.66a1.5 1.5 0 012.16-.4l2.34 1.86a.6.6 0 00.72 0l3.17-2.4c.42-.32.97.18.7.63z" />
    </svg>
  );
}

export function SharePanel({ title, url, compact = false }: { title: string; url?: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const shareUrl = url || (typeof window !== "undefined" ? window.location.href : "");
  const encodedUrl = encodeURIComponent(shareUrl);
  const encodedTitle = encodeURIComponent(title);

  const track = (platform: string) => {
    try {
      // Best-effort: matches existing landing_events / player_events pattern.
      if (typeof window !== "undefined" && (window as any).plausible) {
        (window as any).plausible("share", { props: { platform } });
      }
    } catch {}
  };

  const onNativeShare = async () => {
    track("native");
    if (typeof navigator !== "undefined" && (navigator as any).share) {
      try { await (navigator as any).share({ title, url: shareUrl }); return; } catch {}
    }
    onCopy();
  };
  const onCopy = async () => {
    track("copy");
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const btn = "inline-flex items-center gap-1.5 px-2.5 py-2 rounded-md border border-border bg-card text-xs font-medium text-foreground/85 hover:border-primary/40 hover:text-primary transition-colors";

  const fbUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`;
  const messengerUrl = `fb-messenger://share?link=${encodedUrl}`;
  const xUrl = `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}`;
  const whatsappUrl = `https://wa.me/?text=${encodedTitle}%20${encodedUrl}`;

  if (compact) {
    return (
      <div className="inline-flex items-center gap-1.5">
        <button onClick={onNativeShare} className={btn} aria-label="Megosztás">
          <Share2 className="h-3.5 w-3.5" /> Megosztás
        </button>
      </div>
    );
  }

  return (
    <div className="inline-flex flex-wrap items-center gap-1.5">
      <a
        href={fbUrl}
        target="_blank"
        rel="noreferrer"
        onClick={() => track("facebook")}
        className={btn}
        aria-label="Megosztás Facebookon"
      >
        <Facebook className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Facebook</span>
      </a>
      <a
        href={messengerUrl}
        onClick={() => track("messenger")}
        className={btn}
        aria-label="Küldés Messengeren"
      >
        <MessengerIcon className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Messenger</span>
      </a>
      <a
        href={whatsappUrl}
        target="_blank"
        rel="noreferrer"
        onClick={() => track("whatsapp")}
        className={btn}
        aria-label="Küldés WhatsApp-on"
      >
        <MessageCircle className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">WhatsApp</span>
      </a>
      <a
        href={xUrl}
        target="_blank"
        rel="noreferrer"
        onClick={() => track("x")}
        className={btn}
        aria-label="Megosztás X-en (Twitter)"
      >
        <XIcon className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">X</span>
      </a>
      <button onClick={onCopy} className={btn} aria-label="Link másolása">
        {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Link2 className="h-3.5 w-3.5" />}
        <span className="hidden sm:inline">{copied ? "Másolva" : "Link"}</span>
      </button>
      <button onClick={onNativeShare} className={btn + " sm:hidden"} aria-label="Több lehetőség">
        <Send className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
