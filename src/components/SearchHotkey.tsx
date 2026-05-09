import { useEffect } from "react";

// Global "/" hotkey: focus the first <input> inside the site header search form.
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
      const headerInput = document.querySelector<HTMLInputElement>(
        'header input[placeholder^="Search"]',
      );
      if (headerInput) {
        e.preventDefault();
        headerInput.focus();
        headerInput.select();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return null;
}
