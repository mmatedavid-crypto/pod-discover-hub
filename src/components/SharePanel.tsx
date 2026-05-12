import { useState } from "react";
import { Share2, Check, Link2 } from "lucide-react";

export function SharePanel({ title, url }: { title: string; url?: string }) {
  const [copied, setCopied] = useState(false);
  const shareUrl = url || (typeof window !== "undefined" ? window.location.href : "");

  const onShare = async () => {
    if (typeof navigator !== "undefined" && (navigator as any).share) {
      try { await (navigator as any).share({ title, url: shareUrl }); return; } catch {}
    }
    onCopy();
  };
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <div className="inline-flex items-center gap-2">
      <button onClick={onShare} className="inline-flex items-center gap-1 px-3 py-2 rounded-md border border-border bg-card hover:border-primary/40 text-sm" aria-label="Megosztás">
        <Share2 className="h-4 w-4" /> Megosztás
      </button>
      <button onClick={onCopy} className="inline-flex items-center gap-1 px-3 py-2 rounded-md border border-border bg-card hover:border-primary/40 text-sm" aria-label="Link másolása">
        {copied ? <Check className="h-4 w-4 text-primary" /> : <Link2 className="h-4 w-4" />}
        {copied ? "Másolva" : "Link másolása"}
      </button>
    </div>
  );
}
