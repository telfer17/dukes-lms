// Last Man Standing survival engine.
//
// Pure logic only — no database, no React, no I/O. Every function takes plain
// data and returns plain data, so the rules in docs/LMS-RULES.md can be
// unit-tested in isolation (tests/lms.test.ts).
//
// Vocabulary matches db/lms-schema.sql exactly:
//   entry status : active | eliminated | winner
//   pick outcome : pending | survived | eliminated
//   fixture      : scheduled | played | postponed | abandoned, result home|away|draw

export type TeamId = number;

export type EntryStatus = "active" | "eliminated" | "winner";
export type PickOutcome = "pending" | "survived" | "eliminated";
export type FixtureStatus = "scheduled" | "played" | "postponed" | "abandoned";
export type FixtureResult = "home" | "away" | "draw";

export type Team = {
  id: TeamId;
  name: string;
};

export type Fixture = {
  id: number;
  matchday: number;
  home_team_id: TeamId;
  away_team_id: TeamId;
  status: FixtureStatus;
  result: FixtureResult | null;
};

export type EntryRecord = {
  id: string;
  participant_id: string;
  status: EntryStatus;
};

export type PickRecord = {
  entry_id: string;
  team_id: TeamId;
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The fixture a team plays in, or undefined if they aren't playing this round. */
export function fixtureForTeam(
  fixtures: Fixture[],
  teamId: TeamId
): Fixture | undefined {
  return fixtures.find(
    (f) => f.home_team_id === teamId || f.away_team_id === teamId
  );
}

/**
 * Postponed and abandoned games never produce a result. Per the rules the pick
 * still counts as a WIN — the pick is what survives, not the match.
 */
export function isUnplayed(fixture: Fixture): boolean {
  return fixture.status === "postponed" || fixture.status === "abandoned";
}

/** Every team with a fixture in this set — i.e. everyone who can be picked. */
export function teamsPlayingIn(fixtures: Fixture[]): Set<TeamId> {
  const playing = new Set<TeamId>();
  for (const f of fixtures) {
    playing.add(f.home_team_id);
    playing.add(f.away_team_id);
  }
  return playing;
}

// ---------------------------------------------------------------------------
// Rule 1 — settling a single pick
// ---------------------------------------------------------------------------

/**
 * The outcome of picking `teamId`, given the fixture they were picked in.
 *
 *   won                      → survived
 *   drew or lost             → eliminated
 *   postponed / abandoned    → survived (the pick counts as a win)
 *   no fixture / not played  → pending (nothing to settle yet)
 */
export function settlePick(
  teamId: TeamId,
  fixture: Fixture | undefined
): PickOutcome {
  if (!fixture) return "pending";
  if (isUnplayed(fixture)) return "survived";
  if (fixture.status !== "played" || fixture.result === null) return "pending";

  const won =
    fixture.result === "home"
      ? fixture.home_team_id === teamId
      : fixture.result === "away"
        ? fixture.away_team_id === teamId
        : false; // a draw is never a win

  return won ? "survived" : "eliminated";
}

// ---------------------------------------------------------------------------
// Rule 2 — no-repeat-team, with the 20-team reset
// ---------------------------------------------------------------------------

/**
 * The teams this entry has used SINCE ITS LAST RESET.
 *
 * The pool resets every `poolSize` picks, so only the tail of the history
 * counts: with 20 teams, picks 1–20 are the first cycle and pick 21 starts a
 * fresh one. `history.length % poolSize === 0` means a clean slate.
 *
 * History must be in pick order (oldest first).
 */
export function usedSinceReset(
  pickHistory: TeamId[],
  poolSize: number
): TeamId[] {
  if (poolSize <= 0) return [];
  const usedInCycle = pickHistory.length % poolSize;
  return pickHistory.slice(pickHistory.length - usedInCycle);
}

/**
 * Teams this entry may still pick. Everything not used since its last reset —
 * so after all 20 are used the full pool comes back.
 *
 * Note this reads the pick HISTORY, not outcomes: a team picked in a postponed
 * game still counts as used, exactly as the rules require.
 */
export function availableTeams(
  pickHistory: TeamId[],
  allTeams: Team[]
): Team[] {
  const used = new Set(usedSinceReset(pickHistory, allTeams.length));
  return allTeams.filter((team) => !used.has(team.id));
}

// ---------------------------------------------------------------------------
// Rule 3 — auto-assign on a missed pick (per entry)
// ---------------------------------------------------------------------------

/**
 * The team to auto-assign when an entry reaches the deadline with no pick:
 * the first ALPHABETICALLY that this entry has not used since its last reset
 * AND that is playing in this round's fixtures.
 *
 * Per entry by construction — it derives everything from the one entry's own
 * history, so two entries of the same person compute independently.
 *
 * Returns null if nothing qualifies (an organiser decision, not an engine one).
 */
export function autoAssignTeam(
  pickHistory: TeamId[],
  allTeams: Team[],
  fixtures: Fixture[]
): Team | null {
  const playing = teamsPlayingIn(fixtures);
  const candidates = availableTeams(pickHistory, allTeams)
    .filter((team) => playing.has(team.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  return candidates[0] ?? null;
}

// ---------------------------------------------------------------------------
// Settling a whole round
// ---------------------------------------------------------------------------

export type SettledOutcome = {
  entry_id: string;
  team_id: TeamId;
  outcome: PickOutcome;
};

export type RoundSettlement = {
  /** One row per active entry that had a pick. */
  outcomes: SettledOutcome[];
  /** Entries with their status advanced — eliminated where the pick lost. */
  entries: EntryRecord[];
  /** Active entries whose pick could not be settled yet (fixture not played). */
  unsettled: string[];
  /** Entries that survived ONLY because their fixture was postponed/abandoned. */
  survivedViaUnplayed: Set<string>;
};

/**
 * Settle every active entry's pick for a round.
 *
 * Entries already eliminated (or already marked winner) are passed through
 * untouched. An active entry with no pick at all is left active and reported in
 * `unsettled` — a missed pick is never an elimination; auto-assign should have
 * run at lock time.
 */
export function settleRound(
  entries: EntryRecord[],
  picks: PickRecord[],
  fixtures: Fixture[]
): RoundSettlement {
  const pickByEntry = new Map(picks.map((p) => [p.entry_id, p]));
  const outcomes: SettledOutcome[] = [];
  const unsettled: string[] = [];
  const survivedViaUnplayed = new Set<string>();

  const settledEntries = entries.map((entry) => {
    if (entry.status !== "active") return entry;

    const pick = pickByEntry.get(entry.id);
    if (!pick) {
      unsettled.push(entry.id);
      return entry;
    }

    const fixture = fixtureForTeam(fixtures, pick.team_id);
    const outcome = settlePick(pick.team_id, fixture);
    outcomes.push({
      entry_id: entry.id,
      team_id: pick.team_id,
      outcome,
    });

    if (outcome === "pending") {
      unsettled.push(entry.id);
      return entry;
    }
    if (outcome === "survived") {
      if (fixture && isUnplayed(fixture)) survivedViaUnplayed.add(entry.id);
      return entry;
    }
    return { ...entry, status: "eliminated" as const };
  });

  return { outcomes, entries: settledEntries, unsettled, survivedViaUnplayed };
}

// ---------------------------------------------------------------------------
// Rule 4 — end-state detection
// ---------------------------------------------------------------------------

export type EndState =
  | { kind: "won"; participant_id: string; entry_ids: string[] }
  | { kind: "continue"; entry_ids: string[] }
  | { kind: "rollover" };

/**
 * What the competition does now that the round has settled.
 *
 *   0 active            → rollover (everyone out in the same round, no winner)
 *   1 active            → that entry wins
 *   2+ active, one owner → that PERSON wins; winner-takes-all, one pot, however
 *                          many of the surviving entries are theirs
 *   2+ active, several  → continue to the next round
 *
 * The winner is reported as a participant, matching
 * competitions.winner_participant_id — see docs/LMS-SCHEMA.md.
 */
export function resolveEndState(entries: EntryRecord[]): EndState {
  const active = entries.filter((e) => e.status === "active");
  if (active.length === 0) return { kind: "rollover" };

  const owners = new Set(active.map((e) => e.participant_id));
  if (owners.size === 1) {
    return {
      kind: "won",
      participant_id: active[0].participant_id,
      entry_ids: active.map((e) => e.id),
    };
  }

  return { kind: "continue", entry_ids: active.map((e) => e.id) };
}

/**
 * "A player cannot win the competition outright solely on a postponed/abandoned
 * game." True when every surviving entry got there on an unplayed fixture — the
 * round should not be settled as final until those games are played (or the
 * organiser rules on it).
 */
export function isWinPendingUnplayedFixtures(
  end: EndState,
  survivedViaUnplayed: Set<string>
): boolean {
  if (end.kind !== "won") return false;
  return end.entry_ids.every((id) => survivedViaUnplayed.has(id));
}
