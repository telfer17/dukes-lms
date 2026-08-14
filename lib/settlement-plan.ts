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
  isWinPendingUnplayedFixtures,
  resolveEndState,
  settleRound,
  type EndState,
  type EntryRecord,
  type EntryStatus,
  type Fixture,
  type FixtureResult,
  type FixtureStatus,
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
    kind: "continue" | "won" | "rollover" | "provisional";
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
  /** Some picked fixture has no result yet. */
  | { ok: false; reason: "unsettled"; count: number }
  | {
      ok: true;
      plan: SettlementPlan;
      end: EndState;
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

export function buildSettlementPlan(input: BuildPlanInput): PlanOutcome {
  const { competitionId, round, teams, fixtures, entries, picks } = input;

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
    return { ok: false, reason: "unsettled", count: settlement.unsettled.length };
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
      kind: provisional ? "provisional" : end.kind,
      participant_id: end.kind === "won" ? end.participant_id : null,
      winner_entry_ids: end.kind === "won" && !provisional ? end.entry_ids : [],
    },
  };

  return { ok: true, plan, end, provisional, eliminatedIds };
}
