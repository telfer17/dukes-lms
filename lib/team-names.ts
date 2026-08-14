// The canonical club list, and the one transformation applied to outside names.
// Pure — no imports, no I/O.
//
// openfootball's Football.TXT (the fixture source) carries "FC"/"AFC" tags:
// "Arsenal FC", "AFC Bournemouth". stripClubTag is the whole of that
// transformation, and nothing here ever guesses — an unrecognised name is
// reported by name, because guessing would attach a fixture to the wrong club
// and knock the wrong players out.
//
// The API-Football alias table and resolveTeamName/resolveTeamNames lived here
// for the auto-results cron, which was removed before launch; they went with it
// (recoverable from git history — search: results-feed).

/** The 20 canonical club names — must match teams.name in db/lms-schema.sql. */
export const CANONICAL_TEAMS = [
  "Arsenal",
  "Aston Villa",
  "Bournemouth",
  "Brentford",
  "Brighton & Hove Albion",
  "Chelsea",
  "Coventry City",
  "Crystal Palace",
  "Everton",
  "Fulham",
  "Hull City",
  "Ipswich Town",
  "Leeds United",
  "Liverpool",
  "Manchester City",
  "Manchester United",
  "Newcastle United",
  "Nottingham Forest",
  "Sunderland",
  "Tottenham Hotspur",
] as const;

/**
 * Strip the club-type tags a feed may carry: a trailing " FC"/" AFC", or a
 * leading "AFC ". This is the whole of the openfootball transformation —
 * "Arsenal FC" -> "Arsenal", "AFC Bournemouth" -> "Bournemouth",
 * "Hull City AFC" -> "Hull City".
 */
export function stripClubTag(raw: string): string {
  return raw
    .trim()
    .replace(/\s+(FC|AFC)$/i, "")
    .replace(/^AFC\s+/i, "")
    .trim();
}

// ---------------------------------------------------------------------------
// Display names for tight UI
// ---------------------------------------------------------------------------

/**
 * Shorter names for places where the full one does not fit: pick buttons, grid
 * cells, fixture rows. NOT a rename — `name` in the database stays canonical,
 * and everything that matches on a club (colours, used-team history, the
 * fixture seed) keys off the canonical name. This is presentation only, applied
 * at render.
 *
 * Why not teams.short_name? That column holds 3-letter codes (ARS, AVL). "MUN"
 * in a grid cell is a puzzle; "Man Utd" is a team. Codes are the right answer
 * for a 40px column and the wrong one here, so this sits alongside rather than
 * replacing it.
 *
 * All 20 clubs are listed, most mapping to themselves, so that the table can be
 * checked against CANONICAL_TEAMS exactly — a club renamed in one place and not
 * the other is then a failing test rather than a blank cell.
 */
export const TEAM_DISPLAY_NAMES: Record<string, string> = {
  Arsenal: "Arsenal",
  "Aston Villa": "Aston Villa",
  Bournemouth: "Bournemouth",
  Brentford: "Brentford",
  "Brighton & Hove Albion": "Brighton",
  Chelsea: "Chelsea",
  "Coventry City": "Coventry City",
  "Crystal Palace": "Crystal Palace",
  Everton: "Everton",
  Fulham: "Fulham",
  "Hull City": "Hull City",
  "Ipswich Town": "Ipswich Town",
  "Leeds United": "Leeds United",
  Liverpool: "Liverpool",
  "Manchester City": "Man City",
  "Manchester United": "Man Utd",
  // Added after the 390px check: the full name truncated to "Newcastle U…" on
  // a pick button, which point 4 of the brief rules out. Only one Newcastle.
  "Newcastle United": "Newcastle",
  "Nottingham Forest": "Nott'm Forest",
  Sunderland: "Sunderland",
  "Tottenham Hotspur": "Spurs",
};

/**
 * The short display name for a club, or the input unchanged if we don't know
 * it. Never returns empty: an unrecognised club shows its own name rather than
 * vanishing from a cell.
 */
export function displayTeamName(name: string | null | undefined): string {
  if (!name) return "";
  const trimmed = name.trim();
  return TEAM_DISPLAY_NAMES[trimmed] ?? trimmed;
}
