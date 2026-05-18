import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type GhostSuggestion = {
  type: "podcast" | "person" | "topic" | "category" | "query";
  label: string;
  subtitle?: string;
  href: string;
  image_url?: string | null;
  confidence: number;
};

export function normLabel(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

export function useSearchSuggestions(q: string, limit = 8) {
  const [suggestions, setSuggestions] = useState<GhostSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();
    const trimmed = q.trim();
    if (trimmed.length < 2) { setSuggestions([]); setLoading(false); return; }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const { data, error } = await supabase.functions.invoke("search-autocomplete", {
          body: { q: trimmed, limit },
        });
        if (!error && Array.isArray(data?.suggestions)) setSuggestions(data.suggestions);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    }, 160);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q, limit]);

  return { suggestions, loading };
}

export function computeGhost(q: string, suggestions: GhostSuggestion[]): string {
  if (!q || q !== q.trimStart()) return "";
  const qn = normLabel(q);
  if (qn.length < 2) return "";
  for (const s of suggestions) {
    if (s.type === "query" && normLabel(s.label) === qn) continue;
    const ln = normLabel(s.label);
    if (ln.length > qn.length && ln.startsWith(qn)) {
      return s.label.slice(q.length);
    }
  }
  return "";
}
