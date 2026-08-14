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
