// Shared UK phone normalisation, used by every route that accepts a phone
// number so the rules can't drift between them.

/** Strip everything except digits. */
export function stripToDigits(input: string): string {
  return input.replace(/\D/g, "");
}

/**
 * Normalise a UK phone number to a bare 11-digit string starting with 0
 * (e.g. "07123456789"). Accepts "+44 7…", "+44 (0)7…" and plain "07…"
 * forms. Returns null if the input can't be normalised to that shape.
 *
 * Idempotent over stripping: raw input ("+44 7123 456789") and
 * pre-stripped digits ("447123456789") give the same result, so callers
 * that strip first (e.g. for their own empty-check) pass either form.
 */
export function normaliseUkPhone(input: string): string | null {
  let digits = stripToDigits(input);
  if (digits.startsWith("44")) {
    const rest = digits.slice(2);
    digits = rest.startsWith("0") ? rest : `0${rest}`;
  }
  if (digits.length !== 11 || !digits.startsWith("0")) {
    return null;
  }
  return digits;
}
