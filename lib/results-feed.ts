// Pure logic for the auto-results cron: which of our fixtures are due a
// result, and what a feed payload means for them. No I/O — the route does the
// fetching and writing, this decides. Unit-tested in tests/results-feed.ts.

import { resolveTeamName, type CanonicalTeam } from "@/lib/team-names";

/** One finished match as the feed describes it, already narrowed to what we use. */
export type FeedMatch = {
  homeRaw: string;
  awayRaw: string;
  homeGoals: number | null;
  awayGoals: number | null;
  /** API-Football short status: FT / AET / PEN are finished; PST / CANC etc. are not. */
  statusShort: string;
  kickoff: string;
};

/** One of our fixtures, as far as this module cares. */
export type DueFixture = {
  id: number;
  matchday: number;
  kickoff: string;
  home: CanonicalTeam;
  away: CanonicalTeam;
};

export type FixtureUpdate = {
  fixtureId: number;
  home_score: number;
  away_score: number;
  result: "home" | "away" | "draw";
};

/** Statuses that mean the 90 minutes are over and the score is final. */
const FINISHED = new Set(["FT", "AET", "PEN"]);
/** Statuses that mean the match did not produce a result. */
const ABANDONED = new Set(["PST", "CANC", "ABD", "SUSP", "AWD", "WO", "INT"]);

export function isFinished(statusShort: string): boolean {
  return FINISHED.has(statusShort.toUpperCase());
}

export function isAbandoned(statusShort: string): boolean {
  return ABANDONED.has(statusShort.toUpperCase());
}

/**
 * Fixtures old enough to have a result: kicked off more than `graceMs` ago.
 * A Premier League match plus stoppage and half-time runs a shade under two
 * hours, so the default three hours clears even a heavily delayed finish.
 */
export const DEFAULT_GRACE_MS = 3 * 60 * 60 * 1000;

export function isDue(
  fixture: { kickoff: string },
  now: number,
  graceMs: number = DEFAULT_GRACE_MS
): boolean {
  return Date.parse(fixture.kickoff) + graceMs <= now;
}

export function resultFromScore(
  home: number,
  away: number
): "home" | "away" | "draw" {
  if (home > away) return "home";
  if (away > home) return "away";
  return "draw";
}

/** A stable key for pairing a feed match with one of ours. */
function pairKey(home: string, away: string): string {
  return `${home}|${away}`;
}

export type MatchOutcome = {
  updates: FixtureUpdate[];
  /**
   * Every feed name we could not resolve. Always reported, so a divergence
   * between our club list and the real league is visible even on a run that
   * otherwise succeeded. Whether it is an ERROR is the caller's call — it only
   * matters if one of our fixtures also went unaccounted for.
   */
  unmapped: string[];
  /** Our fixtures with no finished match in the feed yet. */
  notReported: number[];
  /** Fixtures the feed says were called off — left for an admin to mark. */
  abandoned: { fixtureId: number; statusShort: string }[];
};

/**
 * Work out what the feed tells us about the fixtures we asked about.
 *
 * Deliberately conservative: a fixture only produces an update when the feed
 * has a FINISHED match, with both scores present, whose two clubs both resolve
 * to ours and pair with that exact fixture. Anything else is reported, not
 * assumed. Postponements are surfaced rather than written, because the rules
 * treat a postponed pick as a WIN and that is an organiser's call to confirm.
 */
export function matchFeedToFixtures(
  due: DueFixture[],
  feed: FeedMatch[]
): MatchOutcome {
  const unmapped = new Set<string>();
  const byPair = new Map<string, FeedMatch>();

  for (const match of feed) {
    const home = resolveTeamName(match.homeRaw);
    const away = resolveTeamName(match.awayRaw);
    // Only complain about names involved in matches we might care about: the
    // feed covers the whole league, including clubs we do not track.
    if (!home) unmapped.add(match.homeRaw.trim());
    if (!away) unmapped.add(match.awayRaw.trim());
    if (!home || !away) continue;
    byPair.set(pairKey(home, away), match);
  }

  const updates: FixtureUpdate[] = [];
  const notReported: number[] = [];
  const abandoned: { fixtureId: number; statusShort: string }[] = [];

  for (const fixture of due) {
    const match = byPair.get(pairKey(fixture.home, fixture.away));
    if (!match) {
      notReported.push(fixture.id);
      continue;
    }
    if (isAbandoned(match.statusShort)) {
      abandoned.push({ fixtureId: fixture.id, statusShort: match.statusShort });
      continue;
    }
    if (
      !isFinished(match.statusShort) ||
      match.homeGoals === null ||
      match.awayGoals === null
    ) {
      notReported.push(fixture.id);
      continue;
    }
    updates.push({
      fixtureId: fixture.id,
      home_score: match.homeGoals,
      away_score: match.awayGoals,
      result: resultFromScore(match.homeGoals, match.awayGoals),
    });
  }

  return { updates, unmapped: [...unmapped].sort(), notReported, abandoned };
}
