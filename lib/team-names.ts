// Mapping outside club names onto ours. Pure — no imports, no I/O.
//
// Two feeds name the same 20 clubs differently: openfootball's Football.TXT
// carries "FC"/"AFC" tags, and API-Football uses its own short forms. Both are
// resolved here, and both FAIL LOUDLY: an unrecognised name is reported by
// name, never skipped and never guessed at. Guessing would silently attach a
// result to the wrong club and knock the wrong players out.

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

export type CanonicalTeam = (typeof CANONICAL_TEAMS)[number];

const CANONICAL_SET = new Set<string>(CANONICAL_TEAMS);

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

/**
 * API-Football's names for the same clubs. Only entries that do NOT survive
 * stripClubTag need to be here — the rest resolve on their own, and a name we
 * have never seen is reported rather than aliased to a guess.
 */
// Null prototype: a plain object literal inherits `constructor`, `toString`
// and friends, so a feed name of "constructor" would look up as a truthy
// non-string. The CANONICAL_SET check below already rejects those, but a table
// of aliases should not answer for keys nobody put in it.
export const API_FOOTBALL_ALIASES: Record<string, CanonicalTeam> =
  Object.assign(Object.create(null) as Record<string, CanonicalTeam>, {
  // Short forms. Each is an unambiguous shortening of one of OUR clubs —
  // nothing here is a judgement call, and a club we do not have must NEVER be
  // aliased onto one we do (that would post a result against the wrong team
  // and knock the wrong players out). Unknown names are reported instead.
  Brighton: "Brighton & Hove Albion",
  "Brighton and Hove Albion": "Brighton & Hove Albion",
  Coventry: "Coventry City",
  Hull: "Hull City",
  Ipswich: "Ipswich Town",
  Leeds: "Leeds United",
  "Man City": "Manchester City",
  "Man Utd": "Manchester United",
  "Manchester Utd": "Manchester United",
  Newcastle: "Newcastle United",
  Nottingham: "Nottingham Forest",
  "Nott'm Forest": "Nottingham Forest",
  Spurs: "Tottenham Hotspur",
  Tottenham: "Tottenham Hotspur",
});

/**
 * Resolve one feed name to a canonical club, or null if we cannot.
 *
 * Order: exact match, then the explicit alias table, then tag-stripping. Null
 * means "report this name to a human", never "close enough".
 */
export function resolveTeamName(raw: string): CanonicalTeam | null {
  const trimmed = raw.trim();
  if (CANONICAL_SET.has(trimmed)) return trimmed as CanonicalTeam;

  const alias = API_FOOTBALL_ALIASES[trimmed];
  if (alias && CANONICAL_SET.has(alias)) return alias;

  const stripped = stripClubTag(trimmed);
  if (CANONICAL_SET.has(stripped)) return stripped as CanonicalTeam;

  const strippedAlias = API_FOOTBALL_ALIASES[stripped];
  if (strippedAlias && CANONICAL_SET.has(strippedAlias)) return strippedAlias;

  return null;
}

/**
 * Resolve a batch, separating what mapped from what didn't. Callers are
 * expected to refuse to act while `unmapped` is non-empty.
 */
export function resolveTeamNames(raws: string[]): {
  resolved: Map<string, CanonicalTeam>;
  unmapped: string[];
} {
  const resolved = new Map<string, CanonicalTeam>();
  const unmapped = new Set<string>();
  for (const raw of raws) {
    const team = resolveTeamName(raw);
    if (team) resolved.set(raw, team);
    else unmapped.add(raw.trim());
  }
  return { resolved, unmapped: [...unmapped].sort() };
}
