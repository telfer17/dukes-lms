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

/**
 * The fixture a team plays in ON THAT MATCHDAY, or undefined if they aren't
 * playing it.
 *
 * The matchday is required, not assumed: `fixtures` may well be the whole
 * season, and a team plays 38 times in it. Matching on team alone would return
 * whichever fixture happened to come first — a silent, round-dependent wrong
 * answer. The schema guarantees at most one fixture per team per matchday
 * (fixtures_one_home_per_matchday / _one_away_per_matchday).
 */
export function fixtureForTeam(
  fixtures: Fixture[],
  teamId: TeamId,
  matchday: number
): Fixture | undefined {
  return fixtures.find(
    (f) =>
      f.matchday === matchday &&
      (f.home_team_id === teamId || f.away_team_id === teamId)
  );
}

/**
 * Postponed and abandoned games never produce a result. Per the rules the pick
 * still counts as a WIN — the pick is what survives, not the match.
 */
export function isUnplayed(fixture: Fixture): boolean {
  return fixture.status === "postponed" || fixture.status === "abandoned";
}

/**
 * Every team playing on that matchday — i.e. everyone who can be picked.
 *
 * Matchday-scoped for the same reason as fixtureForTeam: given a season of
 * fixtures, an unscoped version would report all 20 teams as playing and
 * auto-assign a team that isn't actually on this round's card.
 */
export function teamsPlayingIn(
  fixtures: Fixture[],
  matchday: number
): Set<TeamId> {
  const playing = new Set<TeamId>();
  for (const f of fixtures) {
    if (f.matchday !== matchday) continue;
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
  fixtures: Fixture[],
  matchday: number
): Team | null {
  const playing = teamsPlayingIn(fixtures, matchday);
  const candidates = availableTeams(pickHistory, allTeams)
    .filter((team) => playing.has(team.id))
    // Explicit "en" so the answer can't drift with the server's default locale,
    // and id as a tie-break so equal-comparing names still order deterministically.
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, "en", { sensitivity: "base" }) ||
        a.id - b.id
    );
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
 *
 * `fixtures` may span any range; only `matchday` is consulted.
 */
export function settleRound(
  entries: EntryRecord[],
  picks: PickRecord[],
  fixtures: Fixture[],
  matchday: number
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

    const fixture = fixtureForTeam(fixtures, pick.team_id, matchday);
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
 *
 * DELIBERATELY does NOT read entries already persisted as status = 'winner' to
 * short-circuit to a "already won" answer. This engine is pure and stateless:
 * it derives the end state from the active field, it does not read back a
 * settlement someone already wrote. "Has this competition been settled before?"
 * is a database question, answered at the Phase 5 call site — folding it in
 * here would mix engine logic with persisted state and make the function's
 * result depend on write history rather than on the round it was handed.
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

// ---------------------------------------------------------------------------
// Rule 5 — buy-back
// ---------------------------------------------------------------------------
//
// docs/LMS-RULES.md § Buy-back. An entry eliminated EARLY may be bought back
// into the SAME competition for another £10 — once, for the immediately
// following round only, confirmed before that round's pick deadline.
//
// Everything here is per ENTRY. The offer belongs to the entry, not to the
// person holding it: someone with two eliminated entries has two independent
// windows and pays twice, and buying one back says nothing about the other.
// That falls out of the shape below rather than being enforced anywhere — no
// function in this section ever looks at another entry.
//
// What is deliberately ABSENT is any notion of the team pool. A buy-back
// restores an entry's LIFE, not its list of used teams: the team that put it
// out, and everything it used before that, stay unavailable. The way that rule
// is kept is that nothing here reads or writes pick history at all — the entry
// comes back and availableTeams() answers exactly as it did the week before.

/**
 * The last round an elimination can still buy back from. Out in 1, 2 or 3 →
 * one window. Out in 4 or later → nothing; a round-3 elimination is the last
 * that can ever buy back, and it returns for round 4.
 *
 * Mirrored as a backstop by lms_buyback_max_elim_round() in db/buyback.sql.
 * This is the source of truth.
 */
export const BUYBACK_MAX_ELIMINATED_ROUND = 3;

/** The round a buy-back would be FOR, as the eligibility check needs it. */
export type BuybackRound = {
  round_number: number;
  /** ISO instant — the authoritative deadline, from the database. */
  deadline: string;
  status: "pending" | "locked" | "settled";
};

export type BuybackCandidate = {
  entry_id: string;
  participant_id: string;
  status: EntryStatus;
  /** The round this entry went OUT in. Null when it is not out. */
  eliminated_round_number: number | null;
  /** True when a buy-back has already been recorded for THAT elimination. */
  bought_back: boolean;
};

export type BuybackRefusal =
  | "not_eliminated"
  | "unknown_elimination_round"
  | "eliminated_too_late"
  | "already_bought_back"
  | "no_next_round"
  | "wrong_round"
  | "window_closed";

export type BuybackVerdict =
  | { eligible: true; for_round_number: number; closes_at: string }
  | { eligible: false; code: BuybackRefusal; reason: string };

/**
 * May this entry be bought back into `round`, right now?
 *
 * Pure: state in, verdict out. Every clause is one sentence of the rule —
 *
 *   eliminated at all           an active entry has nothing to buy back
 *   in round 1, 2 or 3          eligibility is by the round it went OUT in
 *   not already bought back     one buy-back per elimination
 *   the round after that one    N → N+1 and nothing else. This is the clause
 *                               that refuses "out in R1, sit out R2, rejoin in
 *                               R3": the offer is a single time-boxed window,
 *                               not a standing option to return whenever.
 *   before that round's deadline    miss it and the entry is permanently out
 *
 * `round` is the round being bought INTO — the caller looks it up; this decides
 * whether it is the right one. Passing undefined means the competition has no
 * such round, which is not eligibility either.
 */
export function buybackEligibility(
  candidate: BuybackCandidate,
  round: BuybackRound | undefined,
  now: Date = new Date()
): BuybackVerdict {
  const refuse = (code: BuybackRefusal, reason: string): BuybackVerdict => ({
    eligible: false,
    code,
    reason,
  });

  if (candidate.status !== "eliminated") {
    return refuse(
      "not_eliminated",
      candidate.status === "active"
        ? "This entry is still in — there is nothing to buy back."
        : "This entry is not eliminated."
    );
  }

  const out = candidate.eliminated_round_number;
  if (out === null) {
    return refuse(
      "unknown_elimination_round",
      "We don't know which round this entry went out in, so its buy-back window can't be worked out."
    );
  }

  if (out > BUYBACK_MAX_ELIMINATED_ROUND) {
    return refuse(
      "eliminated_too_late",
      `Out in round ${out} — buy-backs are only for entries eliminated in rounds 1 to ${BUYBACK_MAX_ELIMINATED_ROUND}.`
    );
  }

  if (candidate.bought_back) {
    return refuse(
      "already_bought_back",
      "This entry has already used its buy-back for that elimination."
    );
  }

  if (!round) {
    return refuse(
      "no_next_round",
      `There is no round ${out + 1} in this competition to buy back into.`
    );
  }

  if (round.round_number !== out + 1) {
    return refuse(
      "wrong_round",
      `Out in round ${out}, so the only buy-back is for round ${out + 1} — not round ${round.round_number}. A round can't be skipped and rejoined later.`
    );
  }

  // A deadline that will not parse is not "no deadline" — same reasoning as
  // validatePick(): `now >= NaN` is false, which would read as a window that is
  // still open and let a buy-back through on a round whose deadline nobody can
  // determine. Fail closed.
  const closesAt = Date.parse(round.deadline);
  if (Number.isNaN(closesAt)) {
    return refuse(
      "window_closed",
      `Round ${round.round_number}'s deadline can't be read, so the buy-back window can't be confirmed open.`
    );
  }

  // Settled or locked is past the deadline by construction. Checked as well as
  // the clock so the refusal never rests on the clock alone.
  if (round.status !== "pending" || now.getTime() >= closesAt) {
    return refuse(
      "window_closed",
      `The buy-back window closed at round ${round.round_number}'s deadline — this entry is out for good.`
    );
  }

  return {
    eligible: true,
    for_round_number: round.round_number,
    closes_at: round.deadline,
  };
}

/** An eligibility that is still live: a buy-back that could still land. */
export type OpenBuybackWindow = {
  entry_id: string;
  participant_id: string;
  /** The round it would come back for. */
  for_round_number: number;
  /** ISO instant the window shuts — that round's pick deadline. */
  closes_at: string;
};

/**
 * Every candidate whose window is still open, right now.
 *
 * `roundByNumber` is a lookup rather than a list so the caller decides where
 * rounds come from, and this stays free of any I/O.
 */
export function openBuybackWindows(
  candidates: BuybackCandidate[],
  roundByNumber: (roundNumber: number) => BuybackRound | undefined,
  now: Date = new Date()
): OpenBuybackWindow[] {
  const open: OpenBuybackWindow[] = [];
  for (const candidate of candidates) {
    const target =
      candidate.eliminated_round_number === null
        ? undefined
        : roundByNumber(candidate.eliminated_round_number + 1);
    const verdict = buybackEligibility(candidate, target, now);
    if (!verdict.eligible) continue;
    open.push({
      entry_id: candidate.entry_id,
      participant_id: candidate.participant_id,
      for_round_number: verdict.for_round_number,
      closes_at: verdict.closes_at,
    });
  }
  return open;
}

/**
 * What the COMPETITION does now — the end state once buy-back is taken into
 * account.
 *
 *   continue         two or more owners still standing. Never pends: a round
 *                    that leaves the competition running is simply running.
 *   won              one owner left AND no window can still revive anybody.
 *   pending_win      one owner left, but a window is open. NOT a win yet:
 *                    being last standing before eliminated players' windows
 *                    close is not winning (docs/LMS-RULES.md § End states).
 *   pending_rollover nobody left, but a window is open. NOT a rollover yet.
 *   rollover         nobody left and no window open. Confirmed.
 *
 * The two pending states are the same fact wearing different clothes: the round
 * is settled and the competition's END is waiting on a clock. Both carry
 * `window_closes` — the LATEST instant any open window shuts, because the
 * decision cannot be taken until every one of them has — and that is what
 * lms_finalise_competition() (db/buyback.sql) is made to prove has passed.
 *
 * `openWindows` blocks a win WHOEVER holds the eliminated entry, including the
 * prospective winner themselves. Winner-takes-all by PERSON means reviving
 * one's own entry cannot change who wins, so this is stricter than the rule
 * strictly requires — but crowning ends the competition, and ending it while a
 * paid-for offer is still live is the one mistake with no undo. Waiting costs a
 * week; crowning early costs somebody their buy-back.
 *
 * RETURNING ENTRIES ARE NOT SURVIVORS. An entry that is active because it BOUGHT
 * BACK has not come through the round — it has paid to play the next one. So
 * while any returning entry is on the field, the competition CONTINUES, and
 * nothing is decided:
 *
 *   a round wipes out the field and one entry buys back → pending_rollover
 *   becomes continue, not a win. Nobody survived; somebody returned, and they
 *   have a round to play before anything is read off.
 *
 * Without this the difference is invisible — one active entry looks the same
 * however it got there — and a competition that was rescued from a rollover
 * would instead crown the person who rescued it, for a round they never played.
 *
 * `returningEntryIds` is therefore relative to a REFERENCE ROUND: entries whose
 * buy-back is for a round LATER than the one whose end state is being read. An
 * entry that bought back for the round just settled played it like anybody else
 * and is an ordinary survivor.
 */
export type CompetitionState =
  | { kind: "continue"; entry_ids: string[] }
  | { kind: "won"; participant_id: string; entry_ids: string[] }
  | {
      kind: "pending_win";
      participant_id: string;
      entry_ids: string[];
      window_closes: string;
      open_entry_ids: string[];
    }
  | { kind: "pending_rollover"; window_closes: string; open_entry_ids: string[] }
  | { kind: "rollover" };

/** The latest instant any of these windows shuts. */
function latestClose(windows: OpenBuybackWindow[]): string {
  return windows.reduce((latest, w) =>
    Date.parse(w.closes_at) > Date.parse(latest.closes_at) ? w : latest
  ).closes_at;
}

export function resolveCompetitionState(
  entries: EntryRecord[],
  openWindows: OpenBuybackWindow[],
  returningEntryIds: string[] = []
): CompetitionState {
  const active = entries.filter((e) => e.status === "active");

  // Somebody is back and has not played yet — there is nothing to read off,
  // whatever the rest of the field looks like.
  const returning = new Set(returningEntryIds);
  if (active.some((e) => returning.has(e.id))) {
    return { kind: "continue", entry_ids: active.map((e) => e.id) };
  }

  const end = resolveEndState(entries);

  // No window open → buy-back changes nothing, and the answer is the one the
  // competition always gave. resolveEndState stays the core rule; this wraps it.
  if (openWindows.length === 0) {
    return end.kind === "won"
      ? { kind: "won", participant_id: end.participant_id, entry_ids: end.entry_ids }
      : end.kind === "rollover"
        ? { kind: "rollover" }
        : { kind: "continue", entry_ids: end.entry_ids };
  }

  const window_closes = latestClose(openWindows);
  const open_entry_ids = openWindows.map((w) => w.entry_id);

  if (end.kind === "rollover") {
    return { kind: "pending_rollover", window_closes, open_entry_ids };
  }
  if (end.kind === "won") {
    return {
      kind: "pending_win",
      participant_id: end.participant_id,
      entry_ids: end.entry_ids,
      window_closes,
      open_entry_ids,
    };
  }
  // Two or more owners are still in. An open window can only add another
  // entry to a competition that is already carrying on, so there is nothing
  // to wait for.
  return { kind: "continue", entry_ids: end.entry_ids };
}
