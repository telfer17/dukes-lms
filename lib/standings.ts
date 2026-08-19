// The two groups every public screen splits the field into, and the words both
// of them use for it.
//
// /leaderboard asks this question twice — once in the headline count, once in
// the two tables under it — and it must not answer in two vocabularies or two
// orders. The split, the ranking and the headings all live here, so a change of
// wording is one edit, not a hunt.
//
// Pure — no imports, no I/O — and generic over the row shape: the page counts
// projected grid rows while the tables carry cells too, and the homepage's
// board rows are a third shape again. They agree on the three fields that
// decide order and nothing else.

export type StandingRow = {
  name: string;
  status: "active" | "eliminated" | "winner";
  /** Round they went out in; null while they are still in (or if unrecorded). */
  eliminatedRound: number | null;
};

/**
 * Who is left. The winner goes top when there is one — a finished competition
 * is a result, not a list — and everyone else is alphabetical, because among
 * the living there is no ranking to imply.
 */
export function rankStanding<T extends StandingRow>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      (a.status === "winner" ? 0 : 1) - (b.status === "winner" ? 0 : 1) ||
      a.name.localeCompare(b.name, "en")
  );
}

/**
 * The rest of the standings, ranked by HOW FAR THEY GOT: the last people
 * knocked out first, the round-one casualties at the bottom. That is the order
 * the competition actually produced — alphabetical would throw the only
 * information an eliminated row still carries.
 *
 * An unknown round sorts to the bottom rather than to the top: claiming
 * somebody went out in round 0 would rank them below a genuine round-one exit,
 * which is a fact this doesn't have.
 */
export function rankEliminated<T extends StandingRow>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      (b.eliminatedRound ?? 0) - (a.eliminatedRound ?? 0) ||
      a.name.localeCompare(b.name, "en")
  );
}

/**
 * The field, split in two and each half ranked. Winner entries belong with the
 * living: a multi-entry winner may hold several, and they all survived.
 */
export function splitStandings<T extends StandingRow>(
  rows: T[]
): { standing: T[]; eliminated: T[] } {
  return {
    standing: rankStanding(rows.filter((r) => r.status !== "eliminated")),
    eliminated: rankEliminated(rows.filter((r) => r.status === "eliminated")),
  };
}

// ---------------------------------------------------------------------------
// The words. Shared so the headline and the tables cannot describe the same two
// groups differently.
// ---------------------------------------------------------------------------

/** Heading for the survivors — past tense once the competition is over. */
export function standingHeading(concluded: boolean): string {
  return concluded ? "Made it to the end" : "Still standing";
}

export const ELIMINATED_HEADING = "Eliminated";

/**
 * Nobody left. On a concluded competition that can only be a rollover — a win
 * leaves at least one winner entry standing — so it says what actually
 * happened to the pot rather than just reporting an empty list.
 */
export function noStandingLine(concluded: boolean): string {
  return concluded
    ? "No one made it — the pot rolls over."
    : "No one is still standing.";
}

export const NO_ELIMINATIONS_LINE = "No one's out yet.";
