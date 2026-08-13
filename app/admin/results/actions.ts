"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, ActionState } from "@/lib/action-state";
import { requireAdmin } from "@/lib/admin-auth";
import {
  autoAssignTeam,
  isWinPendingUnplayedFixtures,
  resolveEndState,
  settleRound,
  type EntryRecord,
  type PickRecord,
} from "@/lib/lms";
import { formatPence, potPence } from "@/lib/competition";
import {
  currentRound,
  getActiveCompetition,
  getEntries,
  getFixturesForMatchday,
  getPicksForCompetition,
  getRounds,
  getTeams,
  isRoundOpen,
  pickHistoryTeamIds,
} from "@/lib/lms-db";
import { supabaseServer } from "@/lib/supabase-server";

/**
 * Record a fixture's outcome. Only status and result — Last Man Standing needs
 * win/draw/loss, not the scoreline. The schema's CHECK enforces that a result
 * only exists on a played game; we mirror that here for a clean message.
 *
 * Returns a result rather than throwing so the row can revert its optimistic
 * state and show the reason — a thrown server-action error reaches the client
 * as a generic boundary message, which would leave a failed save looking saved.
 */
export async function setFixtureResult(
  fixtureId: number,
  status: "scheduled" | "played" | "postponed" | "abandoned",
  result: "home" | "away" | "draw" | null
): Promise<ActionResult> {
  await requireAdmin();

  if (status !== "played" && result !== null) {
    return { error: "Only a played fixture can have a result." };
  }
  if (status === "played" && result === null) {
    return { error: "A played fixture needs a result." };
  }

  const { error } = await supabaseServer
    .from("fixtures")
    .update({ status, result })
    .eq("id", fixtureId);

  if (error) {
    console.error("setFixtureResult failed:", error);
    return { error: "Failed to save the result." };
  }
  revalidatePath("/admin/results");
  return { ok: true };
}

/**
 * Settle the current round.
 *
 * Order of work:
 *   1. auto-assign a team to every active entry with no pick (engine picks the
 *      first alphabetically available team that's playing). If the engine has
 *      nothing to give, HALT — that's an organiser decision, not a guess.
 *   2. settle every pick through the engine.
 *   3. write pick outcomes and entry statuses.
 *   4. resolve the end state and apply it.
 *
 * NOT a database transaction — supabase-js has no multi-statement transaction.
 * Writes are ordered so every intermediate state satisfies the schema's
 * deferred won-integrity trigger: entries become 'winner' BEFORE the
 * competition is marked won. Re-settling is refused up front, so a partial
 * failure can be re-run rather than double-applied.
 */
export async function settleCurrentRound(): Promise<ActionState> {
  await requireAdmin();

  const competition = await getActiveCompetition();
  if (!competition) return { error: "No active competition." };

  const rounds = await getRounds(competition.id);
  const round = currentRound(rounds);
  if (!round) return { error: "No unsettled round left." };

  // Idempotency guard — settling twice must never double-apply.
  if (round.status === "settled") {
    return { error: `Round ${round.round_number} is already settled.` };
  }

  // Refuse while picks can still change. Settling an open round would
  // auto-assign teams to entries that still have time to choose, and would open
  // a window where a pick lands between settlement reading and writing.
  if (isRoundOpen(round)) {
    return {
      error: `Round ${round.round_number} is still open — picks lock at the deadline. Settle after it passes.`,
    };
  }

  const fixtures = await getFixturesForMatchday(round.matchday);
  if (fixtures.length === 0) {
    return { error: `No fixtures loaded for matchday ${round.matchday}.` };
  }

  const teams = await getTeams();
  const entries = await getEntries(competition.id);
  const activeEntries = entries.filter((e) => e.status === "active");
  if (activeEntries.length === 0) {
    return { error: "No active entries to settle." };
  }

  // ---- 1. auto-assign for anyone who missed the deadline ----
  const roundNumberById = new Map(rounds.map((r) => [r.id, r.round_number]));
  const allPicks = await getPicksForCompetition(competition.id);
  const picksThisRound = allPicks.filter((p) => p.round_id === round.id);
  const pickedEntryIds = new Set(picksThisRound.map((p) => p.entry_id));

  const missing = activeEntries.filter((e) => !pickedEntryIds.has(e.id));
  const autoRows: {
    competition_id: string;
    entry_id: string;
    round_id: string;
    team_id: number;
    auto_assigned: boolean;
    outcome: "pending";
  }[] = [];
  const stuck: string[] = [];

  for (const entry of missing) {
    const history = pickHistoryTeamIds(
      allPicks.filter((p) => p.entry_id === entry.id),
      roundNumberById
    );
    const team = autoAssignTeam(history, teams, fixtures, round.matchday);
    if (!team) {
      stuck.push(entry.participant?.name ?? entry.id);
      continue;
    }
    autoRows.push({
      competition_id: competition.id,
      entry_id: entry.id,
      round_id: round.id,
      team_id: team.id,
      auto_assigned: true,
      outcome: "pending",
    });
  }

  if (stuck.length > 0) {
    return {
      error: `No team can be auto-assigned for: ${stuck.join(", ")}. Every team they can still use is already out of this matchday — needs an organiser decision.`,
    };
  }

  // NOTE: auto-assigned picks are NOT written yet. They are persisted only once
  // the engine confirms the round can actually settle, so an early or failed
  // settle leaves everyone's picks exactly as they were.

  // ---- 2. settle through the engine ----
  const livePicks = picksThisRound;
  const engineEntries: EntryRecord[] = entries.map((e) => ({
    id: e.id,
    participant_id: e.participant_id,
    status: e.status,
  }));
  const enginePicks: PickRecord[] = [
    ...livePicks.map((p) => ({ entry_id: p.entry_id, team_id: p.team_id })),
    ...autoRows.map((p) => ({ entry_id: p.entry_id, team_id: p.team_id })),
  ];

  const settlement = settleRound(
    engineEntries,
    enginePicks,
    fixtures,
    round.matchday
  );

  if (settlement.unsettled.length > 0) {
    return {
      error: `${settlement.unsettled.length} pick(s) can't be settled yet — enter every fixture's result first. Nothing has been changed.`,
    };
  }

  // ---- 3. write pick outcomes and entry statuses ----
  const outcomeByEntry = new Map(
    settlement.outcomes.map((o) => [o.entry_id, o.outcome])
  );

  // Settlement is possible, so the auto-assignments become real — written with
  // their settled outcome directly, saving a re-read.
  if (autoRows.length > 0) {
    const { error } = await supabaseServer.from("picks").insert(
      autoRows.map((row) => ({
        ...row,
        outcome: outcomeByEntry.get(row.entry_id) ?? "pending",
      }))
    );
    if (error) {
      console.error("auto-assign insert failed:", error);
      return { error: "Could not auto-assign missing picks." };
    }
  }

  for (const pick of livePicks) {
    const outcome = outcomeByEntry.get(pick.entry_id);
    if (!outcome || outcome === pick.outcome) continue;
    const { error } = await supabaseServer
      .from("picks")
      .update({ outcome })
      .eq("id", pick.id);
    if (error) {
      console.error("pick outcome write failed:", error);
      return { error: "Could not write pick outcomes." };
    }
  }

  const eliminated = settlement.entries.filter(
    (e) =>
      e.status === "eliminated" &&
      entries.find((row) => row.id === e.id)?.status === "active"
  );
  for (const entry of eliminated) {
    const { error } = await supabaseServer
      .from("entries")
      .update({ status: "eliminated", eliminated_round_id: round.id })
      .eq("id", entry.id);
    if (error) {
      console.error("entry elimination write failed:", error);
      return { error: "Could not eliminate entries." };
    }
  }

  // ---- 4. resolve and apply the end state ----
  const end = resolveEndState(settlement.entries);
  const provisional = isWinPendingUnplayedFixtures(
    end,
    settlement.survivedViaUnplayed
  );
  const eliminatedCount = eliminated.length;

  /**
   * Mark the round settled and refresh the screens. Called LAST in every path:
   * the round's settled flag is what blocks a re-run, so it must not be set
   * until the competition-level writes have actually landed. Otherwise a failed
   * rollover/won write would leave a settled round that can never be retried.
   */
  async function finishRound(): Promise<ActionResult> {
    const { error } = await supabaseServer
      .from("rounds")
      .update({ status: "settled" })
      .eq("id", round!.id);
    if (error) {
      console.error("round settle write failed:", error);
      return { error: "Could not mark the round settled." };
    }
    revalidatePath("/admin/results");
    revalidatePath("/board");
    return { ok: true };
  }

  if (end.kind === "continue") {
    const finished = await finishRound();
    if ("error" in finished) return finished;
    return {
      ok: `Round ${round.round_number} settled — ${eliminatedCount} out, ${end.entry_ids.length} still standing.`,
    };
  }

  if (end.kind === "rollover") {
    const { error } = await supabaseServer
      .from("competitions")
      .update({ status: "rolled_over" })
      .eq("id", competition.id);
    if (error) {
      console.error("rollover write failed:", error);
      return { error: "Could not mark the competition rolled over." };
    }
    const pot = potPence(
      competition.pot_carried_in_pence,
      entries.map((e) => ({
        paid: e.paid,
        amount_paid_pence: e.amount_paid_pence,
      }))
    );
    const finished = await finishRound();
    if ("error" in finished) return finished;
    return {
      ok: `Everyone went out in round ${round.round_number}. Competition rolled over — carry ${formatPence(pot)} into the next one (set it as "pot carried in", rollover count ${competition.rollover_count + 1}).`,
    };
  }

  // end.kind === "won"
  if (provisional) {
    const finished = await finishRound();
    if ("error" in finished) return finished;
    return {
      ok: `Round ${round.round_number} settled, but the win rests only on postponed/abandoned fixture(s) — NOT settling the competition. Per the rules, resolve once those games are played.`,
    };
  }

  // Entries become 'winner' FIRST so the competition update passes the
  // won-integrity trigger (see the note on this function).
  for (const id of end.entry_ids) {
    const { error } = await supabaseServer
      .from("entries")
      .update({ status: "winner" })
      .eq("id", id);
    if (error) {
      console.error("winner entry write failed:", error);
      return { error: "Could not mark the winning entries." };
    }
  }

  const { error: wonError } = await supabaseServer
    .from("competitions")
    .update({ status: "won", winner_participant_id: end.participant_id })
    .eq("id", competition.id);
  if (wonError) {
    console.error("competition won write failed:", wonError);
    return { error: "Could not mark the competition won." };
  }

  const finished = await finishRound();
  if ("error" in finished) return finished;

  const winner = entries.find(
    (e) => e.participant_id === end.participant_id
  )?.participant?.name;

  return {
    ok: `${winner ?? "Winner"} is the Last Man Standing — competition won with ${end.entry_ids.length} surviving ${end.entry_ids.length === 1 ? "entry" : "entries"}.`,
  };
}
