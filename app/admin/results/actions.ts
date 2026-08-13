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
  getSettledRoundForMatchday,
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
 *
 * Refuses once the matchday's round has been settled: eliminations and pick
 * outcomes were already computed from the old value, so changing it here would
 * silently desync the board from the results people were knocked out on.
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

  const { data: fixture, error: fixtureError } = await supabaseServer
    .from("fixtures")
    .select("id, matchday")
    .eq("id", fixtureId)
    .maybeSingle<{ id: number; matchday: number }>();
  if (fixtureError) {
    console.error("setFixtureResult fixture lookup failed:", fixtureError);
    return { error: "Failed to read the fixture." };
  }
  if (!fixture) return { error: "That fixture no longer exists." };

  const settledRound = await getSettledRoundForMatchday(fixture.matchday);
  if (settledRound) {
    return {
      error: `Round ${settledRound.round_number} has already been settled — this result was applied to players and can't be changed here. Reopening a settled round is a deliberate re-settle, not an edit; it needs doing by hand for now.`,
    };
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
 * NOT a database transaction — supabase-js has no multi-statement transaction,
 * and a Postgres function is deferred to the pre-season hardening pass. When
 * that RPC is written it must also take the results cron's guard inside it
 * (app/api/cron/results/route.ts), or the lock will only be half a lock. Until
 * then the writes are ordered so every intermediate state is valid and every
 * step is idempotent: entries become 'winner' BEFORE the competition is marked
 * won (the deferred won-integrity trigger requires it), the round is flagged
 * settled last, and a half-applied win is repaired on the next run rather than
 * wedging the competition.
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

  /**
   * Lock the round without settling it — used for a provisional win, which has
   * to stay retriable. Status 'locked' keeps it as the current round (only
   * 'settled' advances) and keeps picks closed (isRoundOpen wants 'pending').
   */
  async function lockRound(): Promise<ActionResult> {
    const { error } = await supabaseServer
      .from("rounds")
      .update({ status: "locked" })
      .eq("id", round!.id);
    if (error) {
      console.error("round lock write failed:", error);
      return { error: "Could not lock the round." };
    }
    revalidatePath("/admin/results");
    revalidatePath("/board");
    return { ok: true };
  }

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


  const teams = await getTeams();
  const entries = await getEntries(competition.id);

  // ---- repair a half-applied win before anything else ----
  //
  // The winning entries are marked BEFORE the competition row (the deferred
  // won-integrity trigger demands that order), so a failure between the two
  // leaves entries saying 'winner' while the competition is still 'active'.
  // Every later run would then find zero active entries, refuse, and wedge the
  // competition: no winner recorded, and the single-active constraint blocking
  // any new one. Finish the job instead.
  const winnerEntries = entries.filter((e) => e.status === "winner");
  if (winnerEntries.length > 0 && !competition.winner_participant_id) {
    const { error } = await supabaseServer
      .from("competitions")
      .update({
        status: "won",
        winner_participant_id: winnerEntries[0].participant_id,
      })
      .eq("id", competition.id);
    if (error) {
      console.error("won recovery write failed:", error);
      return {
        error:
          "The winning entries are marked but the competition row could not be updated. Try again.",
      };
    }
    await finishRound();
    const name = winnerEntries[0].participant?.name;
    return {
      ok: `A previous settle had only got halfway — ${name ?? "the winner"} is now recorded as the winner.`,
    };
  }

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
    if ("error" in finished) {
      // The rollover itself landed — say so, or the admin will think nothing
      // happened and go looking for a re-run that can never work.
      return {
        error: `The competition was marked rolled over, but the round could not be flagged settled. The rollover stands — do not settle again.`,
      };
    }
    return {
      ok: `Everyone went out in round ${round.round_number}. Competition rolled over — carry ${formatPence(pot)} into the next one (set it as "pot carried in", rollover count ${competition.rollover_count + 1}).`,
    };
  }

  // end.kind === "won"
  if (provisional) {
    // Deliberately NOT settled. The rules say a player cannot win outright on a
    // postponed/abandoned game, so this round has to be re-settled once the
    // real result lands — and the idempotency guard refuses a settled round,
    // which would strand the competition with no winner forever. Locking keeps
    // it as the current round and retriable. Re-running is safe: auto-assign
    // finds no missing picks, outcome writes skip unchanged rows, and
    // eliminations only touch entries still active in the database.
    const locked = await lockRound();
    if ("error" in locked) return locked;
    return {
      ok: `Round ${round.round_number} is decided, but the win rests only on postponed/abandoned fixture(s) — the competition is NOT settled. Per the rules, enter the real result once those games are played and settle this round again.`,
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
  if ("error" in finished) {
    return {
      error: `The competition was marked won, but the round could not be flagged settled. The result stands — do not settle again.`,
    };
  }

  const winner = entries.find(
    (e) => e.participant_id === end.participant_id
  )?.participant?.name;

  return {
    ok: `${winner ?? "Winner"} is the Last Man Standing — competition won with ${end.entry_ids.length} surviving ${end.entry_ids.length === 1 ? "entry" : "entries"}.`,
  };
}
