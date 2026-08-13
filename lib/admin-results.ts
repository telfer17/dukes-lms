// Pure result-entry logic for the admin results page. No imports —
// usable from server actions, client rows, and unit tests alike.

export type ResultValidation =
  | { ok: true; home: number | null; away: number | null }
  | { ok: false; error: string };

/**
 * Validate a raw score pair. Both blank = a deliberate clear (null/null);
 * otherwise both must be integers 0–99.
 */
export function validateResult(
  homeRaw: string,
  awayRaw: string
): ResultValidation {
  const home = homeRaw.trim();
  const away = awayRaw.trim();

  if (home === "" && away === "") {
    return { ok: true, home: null, away: null };
  }
  if (home === "" || away === "") {
    return { ok: false, error: "Fill in both scores, or clear both." };
  }
  if (!/^\d+$/.test(home) || !/^\d+$/.test(away)) {
    return { ok: false, error: "Scores must be whole numbers." };
  }
  const h = Number(home);
  const a = Number(away);
  if (h > 99 || a > 99) {
    return { ok: false, error: "Scores must be between 0 and 99." };
  }
  return { ok: true, home: h, away: a };
}

/** How many matches have a full result entered. */
export function resultsEnteredCount(
  matches: { home_score: number | null; away_score: number | null }[]
): number {
  return matches.filter(
    (m) => m.home_score !== null && m.away_score !== null
  ).length;
}
