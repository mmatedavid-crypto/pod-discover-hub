import { useEffect } from "react";

// Global "/" hotkey: focus the visible site search input.
// Ignored when the user is typing in another input/textarea/contenteditable.
export function SearchHotkey() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }
      const candidates = Array.from(document.querySelectorAll<HTMLInputElement>(
        'form[role="search"] input[aria-label="Keresés"], input[aria-label="Keresés"]',
      ));
      const searchInput = candidates.find((input) => {
        const rect = input.getBoundingClientRect();
        const style = window.getComputedStyle(input);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      });
      if (searchInput) {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return null;
}
