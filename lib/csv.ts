// Minimal RFC-4180 CSV builder. No imports — pure and unit-tested.

type CsvValue = string | number | boolean | null | undefined;

function escapeField(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Neutralise spreadsheet formula injection from free-text, user-supplied
 * fields: if a value starts with a formula trigger, prefix a single quote so
 * Excel/Sheets treat it as text. Apply to user input (names, etc.) — NOT to
 * fields we deliberately emit as formulas, like the phone `="0…"` cell.
 */
export function csvSafeText(value: string | null | undefined): string {
  if (!value) return "";
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function toCsv(headers: string[], rows: CsvValue[][]): string {
  const lines = [headers, ...rows].map((row) =>
    row.map(escapeField).join(",")
  );
  return lines.join("\r\n");
}
