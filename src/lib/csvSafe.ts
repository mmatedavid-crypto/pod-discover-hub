// CSV cell escaping for admin exports. Values that a spreadsheet would treat as
// a formula (=, +, -, @, tab, CR) get a leading apostrophe, so text that came
// from podcast feeds can never run as a formula when the file is opened.
export function csvCell(value: unknown): string {
  if (value == null) return '""';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
