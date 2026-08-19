// The settlement PLAN: everything lms_settle_round() needs, worked out here so
// the database function never has to know a rule.
//
// Pure, like lib/lms.ts — no database, no React, no I/O. It imports the engine
// and nothing else, so the whole "what should happen when this round settles?"
// question is answerable from plain data and testable without a server. The
// server action (app/admin/results/actions.ts) reads the rows, calls this, and
// posts the result to Postgres; the integration suite calls the SAME builder
// against a real database, so the thing under test is the thing that ships.
//
// lib/lms.ts remains the only place the RULES live. This module decides nothing
// — it arranges the engine's answers into the shape the transaction applies.

import {
  autoAssignTeam,
  buybackEligibility,
  fixtureForTeam,
  isWinPendingUnplayedFixtures,
  openBuybackWindows,
  resolveCompetitionState,
  resolveEndState,
  settleRound,
  type BuybackCandidate,
  type BuybackRound,
  type CompetitionState,
  type EndState,
  type EntryRecord,
  type EntryStatus,
  type Fixture,
  type FixtureResult,
  type FixtureStatus,
  type OpenBuybackWindow,
  type PickOutcome,
  type PickRecord,
  type Team,
  type TeamId,
} from "@/lib/lms";

export type PlanRound = {
  id: string;
  round_number: number;
  matchday: number;
};

export type PlanEntry = {
  id: string;
  participant_id: string;
  status: EntryStatus;
  /** How to name this entry if nothing can be auto-assigned to it. */
  label: string;
  /**
   * The round this entry went OUT in, if it is out. Required, not optional:
   * without it a buy-back window cannot be worked out, and an unworked-out
   * window reads as "no window", which is the difference between a competition
   * that is pending and one that has rolled over for good.
   *
   * For an entry eliminated in the round being settled this is not known to the
   * caller — the settlement is what eliminates it — and the builder fills it in.
   */
  eliminated_round_number: number | null;
};

/** A round as the buy-back rules need it: number, deadline, status. */
export type PlanRoundInfo = BuybackRound;

/** One recorded buy-back, as db/buyback.sql stores it. */
export type PlanBuyback = {
  id: string;
  entry_id: string;
  /** The round the entry went OUT in — which elimination this bought back. */
  eliminated_round_number: number;
  /** The round it was bought back FOR (that elimination's round, plus one). */
  for_round_number: number;
};

export type PlanPick = {
  entry_id: string;
  round_id: string;
  team_id: TeamId;
};

export type BuildPlanInput = {
  competitionId: string;
  round: PlanRound;
  /** Round id → round_number, so pick history can be put in order. */
  roundNumberById: Map<string, number>;
  teams: Team[];
  /** Every fixture of `round.matchday`. */
  fixtures: Fixture[];
  /** Every entry in the competition, whatever its status. */
  entries: PlanEntry[];
  /** Every pick in the competition, all rounds — the used-team history. */
  picks: PlanPick[];
  /**
   * Every round of the competition, so a buy-back window's deadline can be
   * found. Buy-back windows shut at the NEXT round's pick deadline, so this
   * needs the rounds after the one being settled, not just up to it.
   */
  allRounds: PlanRoundInfo[];
  /** Every buy-back already recorded in this competition. */
  buybacks: PlanBuyback[];
  now?: Date;
};

/**
 * Exactly the JSON lms_settle_round() takes. The three `expected_*` arrays are
 * the fingerprints it re-checks inside the transaction: if the database no
 * longer matches them, the plan was computed against state that has since moved
 * and the whole thing is refused rather than applied to a world it does not
 * describe.
 */
export type SettlementPlan = {
  competition_id: string;
  round_id: string;
  matchday: number;
  expected_fixtures: {
    id: number;
    status: FixtureStatus;
    result: FixtureResult | null;
  }[];
  expected_picks: { entry_id: string; team_id: TeamId }[];
  expected_active_entry_ids: string[];
  auto_assign: { entry_id: string; team_id: TeamId }[];
  pick_outcomes: { entry_id: string; outcome: PickOutcome }[];
  eliminate_entry_ids: string[];
  end: {
    kind: "continue" | "won" | "rollover" | "pending" | "provisional";
    participant_id: string | null;
    winner_entry_ids: string[];
  };
};

export type PlanOutcome =
  /** Nobody left to settle. */
  | { ok: false; reason: "no_active_entries" }
  /**
   * At least one entry has no pick and no legal team to give it. Halts the
   * WHOLE settlement — an organiser decision, never a guess, and never a
   * partial settle that quietly leaves someone behind.
   */
  | { ok: false; reason: "auto_assign_stuck"; stuck: string[] }
  /**
   * Some picked fixture has no result yet. `fixtures` names them — "Chelsea v
   * Everton" — because a count alone ("1 pick can't be settled") leaves the
   * organiser hunting the matchday for the one row they have not filled in.
   */
  | { ok: false; reason: "unsettled"; count: number; fixtures: string[] }
  | {
      ok: true;
      plan: SettlementPlan;
      end: EndState;
      /**
       * What the COMPETITION does, buy-back included. `end` is the field-only
       * answer and stays exactly what it was; this is the one the organiser is
       * told about, and the one that can say "pending".
       */
      state: CompetitionState;
      /** Buy-back windows still open once this round is settled. */
      openWindows: OpenBuybackWindow[];
      /**
       * The win rests solely on postponed/abandoned fixtures. The plan locks
       * the round instead of settling it — see docs/LMS-RULES.md.
       */
      provisional: boolean;
      eliminatedIds: string[];
    };

/** Ordered pick history (team ids) for one entry — what availableTeams wants. */
function historyFor(
  entryId: string,
  picks: PlanPick[],
  roundNumberById: Map<string, number>
): TeamId[] {
  return picks
    .filter((p) => p.entry_id === entryId)
    .sort(
      (a, b) =>
        (roundNumberById.get(a.round_id) ?? 0) -
        (roundNumberById.get(b.round_id) ?? 0)
    )
    .map((p) => p.team_id);
}

/**
 * Name the fixtures that are holding a settlement up, for the refusal message.
 *
 * One label per FIXTURE, not per entry: three entries all waiting on the same
 * Sunday game is one thing to go and do something about, not three. Sorted so
 * the message reads the same however the entries happened to be ordered.
 */
function unsettledFixtureLabels(
  unsettledEntryIds: string[],
  picks: PickRecord[],
  fixtures: Fixture[],
  teams: Team[],
  matchday: number
): string[] {
  const nameOf = new Map(teams.map((t) => [t.id, t.name]));
  const name = (id: TeamId) => nameOf.get(id) ?? `team ${id}`;
  const pickByEntry = new Map(picks.map((p) => [p.entry_id, p]));

  const labels = new Set<string>();
  for (const entryId of unsettledEntryIds) {
    const pick = pickByEntry.get(entryId);
    // No pick at all cannot reach here — auto-assign has already covered every
    // active entry, or the whole build refused as auto_assign_stuck.
    if (!pick) continue;
    const fixture = fixtureForTeam(fixtures, pick.team_id, matchday);
    labels.add(
      fixture
        ? `${name(fixture.home_team_id)} v ${name(fixture.away_team_id)}`
        : `${name(pick.team_id)} (no matchday ${matchday} fixture)`
    );
  }
  return [...labels].sort();
}

// ---------------------------------------------------------------------------
// Buy-back
// ---------------------------------------------------------------------------

/** Round number → the round, for the window lookups. */
function roundsByNumber(
  rounds: PlanRoundInfo[]
): (roundNumber: number) => PlanRoundInfo | undefined {
  const byNumber = new Map(rounds.map((r) => [r.round_number, r]));
  return (roundNumber) => byNumber.get(roundNumber);
}

/**
 * Which entries could still buy back, given where each of them went out and
 * what has already been bought.
 *
 * `eliminatedIn` supplies the round for entries the settlement has only just
 * eliminated — their PlanEntry still says null, because the caller read them
 * before they went out.
 */
function buybackCandidates(
  entries: EntryRecord[],
  planEntryById: Map<string, PlanEntry>,
  buybacks: PlanBuyback[],
  eliminatedIn: Map<string, number>
): BuybackCandidate[] {
  // Keyed by entry AND elimination round: the offer is per elimination, so an
  // entry that went out, bought back and went out again has a fresh one.
  const used = new Set(
    buybacks.map((b) => `${b.entry_id}:${b.eliminated_round_number}`)
  );

  return entries
    .filter((e) => e.status === "eliminated")
    .map((e) => {
      const outIn =
        eliminatedIn.get(e.id) ??
        planEntryById.get(e.id)?.eliminated_round_number ??
        null;
      return {
        entry_id: e.id,
        participant_id: e.participant_id,
        status: e.status,
        eliminated_round_number: outIn,
        bought_back: outIn !== null && used.has(`${e.id}:${outIn}`),
      };
    });
}

/**
 * Entries that are active because they BOUGHT BACK for a round later than
 * `referenceRoundNumber` — i.e. they have returned but not yet played.
 *
 * See resolveCompetitionState: a returning entry is not a survivor, and a field
 * made only of returning entries has decided nothing.
 */
function returningEntryIds(
  entries: EntryRecord[],
  buybacks: PlanBuyback[],
  referenceRoundNumber: number
): string[] {
  const returning = new Set(
    buybacks
      .filter((b) => b.for_round_number > referenceRoundNumber)
      .map((b) => b.entry_id)
  );
  return entries
    .filter((e) => e.status === "active" && returning.has(e.id))
    .map((e) => e.id);
}

// The clock, wound all the way back. Used only by lastWindowClose below.
const EPOCH = new Date(0);

/**
 * When the LAST buy-back window shuts — including ones that already have.
 *
 * This is what lms_finalise_competition() is asked to prove has passed, so it
 * cannot be "the windows that are open now" (by then there are none). It asks
 * the ordinary eligibility question with two facts suspended: the clock, and
 * the target round's own status — a round that has since locked or settled
 * would refuse on those grounds alone, and its deadline is exactly the instant
 * being looked for. Everything else — the 1..3 band, one-per-elimination, the
 * next-round-only rule — is the real rule, called rather than restated, so this
 * cannot drift away from it.
 *
 * Null when no entry ever had a window: there is then nothing to wait for.
 */
function lastWindowClose(
  candidates: BuybackCandidate[],
  roundFor: (roundNumber: number) => PlanRoundInfo | undefined
): string | null {
  let latest: string | null = null;

  for (const candidate of candidates) {
    if (candidate.eliminated_round_number === null) continue;
    const target = roundFor(candidate.eliminated_round_number + 1);
    if (!target) continue;

    const verdict = buybackEligibility(
      candidate,
      { ...target, status: "pending" },
      EPOCH
    );
    if (!verdict.eligible) continue;

    const at = Date.parse(verdict.closes_at);
    if (Number.isNaN(at)) continue;
    if (latest === null || at > Date.parse(latest)) latest = verdict.closes_at;
  }

  return latest;
}

export function buildSettlementPlan(input: BuildPlanInput): PlanOutcome {
  const {
    competitionId,
    round,
    teams,
    fixtures,
    entries,
    picks,
    allRounds,
    buybacks,
    now = new Date(),
  } = input;

  const activeEntries = entries.filter((e) => e.status === "active");
  if (activeEntries.length === 0) return { ok: false, reason: "no_active_entries" };

  const picksThisRound = picks.filter((p) => p.round_id === round.id);
  const pickedEntryIds = new Set(picksThisRound.map((p) => p.entry_id));

  // ---- 1. auto-assign for anyone who missed the deadline ----
  const autoAssign: { entry_id: string; team_id: TeamId }[] = [];
  const stuck: string[] = [];

  for (const entry of activeEntries) {
    if (pickedEntryIds.has(entry.id)) continue;
    const team = autoAssignTeam(
      historyFor(entry.id, picks, input.roundNumberById),
      teams,
      fixtures,
      round.matchday
    );
    if (!team) {
      stuck.push(entry.label);
      continue;
    }
    autoAssign.push({ entry_id: entry.id, team_id: team.id });
  }

  if (stuck.length > 0) return { ok: false, reason: "auto_assign_stuck", stuck };

  // ---- 2. settle through the engine ----
  const engineEntries: EntryRecord[] = entries.map((e) => ({
    id: e.id,
    participant_id: e.participant_id,
    status: e.status,
  }));
  const enginePicks: PickRecord[] = [
    ...picksThisRound.map((p) => ({ entry_id: p.entry_id, team_id: p.team_id })),
    ...autoAssign,
  ];

  const settlement = settleRound(
    engineEntries,
    enginePicks,
    fixtures,
    round.matchday
  );

  if (settlement.unsettled.length > 0) {
    return {
      ok: false,
      reason: "unsettled",
      count: settlement.unsettled.length,
      fixtures: unsettledFixtureLabels(
        settlement.unsettled,
        enginePicks,
        fixtures,
        teams,
        round.matchday
      ),
    };
  }

  // ---- 3. the end state ----
  const end = resolveEndState(settlement.entries);
  const provisional = isWinPendingUnplayedFixtures(
    end,
    settlement.survivedViaUnplayed
  );

  // Only entries that were active in the DATABASE go on the elimination list —
  // an entry the engine passed through untouched must not be re-stamped.
  const wasActive = new Set(activeEntries.map((e) => e.id));
  const eliminatedIds = settlement.entries
    .filter((e) => e.status === "eliminated" && wasActive.has(e.id))
    .map((e) => e.id);

  // ---- 4. buy-back: who could still come back, and what that makes this ----
  //
  // The entries eliminated BY this settlement are the ones whose window opens
  // now, and the round they went out in is the round being settled.
  const eliminatedIn = new Map(eliminatedIds.map((id) => [id, round.round_number]));
  const candidates = buybackCandidates(
    settlement.entries,
    new Map(entries.map((e) => [e.id, e])),
    buybacks,
    eliminatedIn
  );
  const roundFor = roundsByNumber(allRounds);
  const openWindows = openBuybackWindows(candidates, roundFor, now);

  const state = resolveCompetitionState(
    settlement.entries,
    openWindows,
    returningEntryIds(settlement.entries, buybacks, round.round_number)
  );

  // How the transaction is told to end.
  //
  // 'provisional' wins over everything, and deliberately: a win resting on a
  // postponed game does not settle the round at all, it LOCKS it, so there is
  // nothing yet for a buy-back window to be pending on. The buy-back question
  // is asked again — with a week's more clock — when the round is re-settled
  // for real.
  const endKind: SettlementPlan["end"]["kind"] = provisional
    ? "provisional"
    : state.kind === "pending_win" || state.kind === "pending_rollover"
      ? "pending"
      : state.kind;

  // A crown is only written when the competition is actually over. 'pending'
  // settles the round and stops; lms_finalise_competition() does the rest once
  // the window shuts.
  const crowning = endKind === "won";

  const plan: SettlementPlan = {
    competition_id: competitionId,
    round_id: round.id,
    matchday: round.matchday,
    expected_fixtures: fixtures.map((f) => ({
      id: f.id,
      status: f.status,
      result: f.result,
    })),
    expected_picks: picksThisRound.map((p) => ({
      entry_id: p.entry_id,
      team_id: p.team_id,
    })),
    expected_active_entry_ids: activeEntries.map((e) => e.id),
    auto_assign: autoAssign,
    pick_outcomes: settlement.outcomes.map((o) => ({
      entry_id: o.entry_id,
      outcome: o.outcome,
    })),
    eliminate_entry_ids: eliminatedIds,
    end: {
      kind: endKind,
      participant_id: state.kind === "won" ? state.participant_id : null,
      winner_entry_ids: crowning && state.kind === "won" ? state.entry_ids : [],
    },
  };

  return { ok: true, plan, end, state, openWindows, provisional, eliminatedIds };
}

// ---------------------------------------------------------------------------
// Finalising a pending competition
// ---------------------------------------------------------------------------

/**
 * Exactly the JSON lms_finalise_competition() takes (db/buyback.sql).
 *
 * `window_closes_at` is the guard that makes the whole buy-back rule hold at
 * the operational level: the database refuses to confirm a rollover — or crown
 * a winner — until that instant has passed. The two fingerprints then prove
 * that nothing moved between working the answer out and applying it, and the
 * one that matters is `expected_buyback_ids`: a buy-back landing in that gap
 * turns "rolled over" into "still running".
 */
export type FinalisationPlan = {
  competition_id: string;
  window_closes_at: string | null;
  expected_active_entry_ids: string[];
  expected_buyback_ids: string[];
  end: {
    kind: "won" | "rollover";
    participant_id: string | null;
    winner_entry_ids: string[];
  };
};

export type BuildFinalisationInput = {
  competitionId: string;
  /** Every entry in the competition, whatever its status. */
  entries: PlanEntry[];
  /** Every round of the competition. */
  allRounds: PlanRoundInfo[];
  /** Every buy-back recorded in this competition. */
  buybacks: PlanBuyback[];
  /**
   * The highest round number that has been SETTLED. Buy-backs for anything
   * after it are entries that have returned but not yet played.
   */
  settledRoundNumber: number;
  now?: Date;
};

export type FinalisationOutcome =
  /** The competition is still running — there is nothing to finalise. */
  | { ok: false; reason: "not_ended"; state: CompetitionState }
  /** The end is decided but a buy-back could still change it. */
  | { ok: false; reason: "window_open"; state: CompetitionState; closesAt: string }
  | { ok: true; plan: FinalisationPlan; state: CompetitionState };

/**
 * Work out whether a competition can now be closed off, and the plan to do it.
 *
 * Called on a competition whose latest round is already settled: this decides
 * nothing about a round, only about the competition. It is the second half of
 * the pending state — settlement stops at 'pending', and this is what finishes
 * the job once the buy-back window has run out.
 */
export function buildFinalisationPlan(
  input: BuildFinalisationInput
): FinalisationOutcome {
  const {
    competitionId,
    entries,
    allRounds,
    buybacks,
    settledRoundNumber,
    now = new Date(),
  } = input;

  const engineEntries: EntryRecord[] = entries.map((e) => ({
    id: e.id,
    participant_id: e.participant_id,
    status: e.status,
  }));

  // Nothing has been settled, so nothing can be over. Without this, a
  // competition with a single entrant reads as "won" from the moment it is
  // created — resolveEndState answers "one active entry, one owner" whether a
  // ball has been kicked or not, because until now it was only ever asked once
  // a round had been settled.
  if (settledRoundNumber < 1) {
    return {
      ok: false,
      reason: "not_ended",
      state: { kind: "continue", entry_ids: engineEntries.filter((e) => e.status === "active").map((e) => e.id) },
    };
  }

  const candidates = buybackCandidates(
    engineEntries,
    new Map(entries.map((e) => [e.id, e])),
    buybacks,
    new Map()
  );
  const roundFor = roundsByNumber(allRounds);
  const openWindows = openBuybackWindows(candidates, roundFor, now);

  const state = resolveCompetitionState(
    engineEntries,
    openWindows,
    returningEntryIds(engineEntries, buybacks, settledRoundNumber)
  );

  if (state.kind === "continue") return { ok: false, reason: "not_ended", state };
  if (state.kind === "pending_win" || state.kind === "pending_rollover") {
    return {
      ok: false,
      reason: "window_open",
      state,
      closesAt: state.window_closes,
    };
  }

  const plan: FinalisationPlan = {
    competition_id: competitionId,
    // Including windows that have already shut — this is the instant the
    // database is asked to prove is in the past, not a list of live offers.
    window_closes_at: lastWindowClose(candidates, roundFor),
    expected_active_entry_ids: engineEntries
      .filter((e) => e.status === "active")
      .map((e) => e.id),
    expected_buyback_ids: buybacks.map((b) => b.id),
    end: {
      kind: state.kind,
      participant_id: state.kind === "won" ? state.participant_id : null,
      winner_entry_ids: state.kind === "won" ? state.entry_ids : [],
    },
  };

  return { ok: true, plan, state };
}
