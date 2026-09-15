"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, ActionState } from "@/lib/action-state";
import { requireAdmin } from "@/lib/admin-auth";
import {
  buildFinalisationPlan,
  buildSettlementPlan,
} from "@/lib/settlement-plan";
import {
  eliminatedRoundNumber,
  planBuybacks,
  planRounds,
} from "@/lib/buyback";
import { formatPence, potPence } from "@/lib/competition";
import {
  currentRound,
  getActiveCompetition,
  getBuybacks,
  getEntries,
  getFixturesForMatchday,
  getParticipantNames,
  getPicksForCompetition,
  getRound,
  getRounds,
  getTeams,
  isRoundOpen,
  settledRoundNumber,
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
 * Goes through lms_set_fixture_result (db/settlement-fn.sql) rather than a
 * direct update. Reading "has this matchday been settled?" here and writing
 * afterwards is a time-of-check/time-of-use gap: a settle landing in between
 * would have computed everyone's eliminations from the old result while this
 * write replaces it. The function takes the shared settlement lock and re-reads
 * the guard inside the transaction, so the check and the write cannot be
 * separated. It refuses once the matchday's round has been settled, for the
 * same reason as before.
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

  const { data, error } = await supabaseServer.rpc("lms_set_fixture_result", {
    p_fixture_id: fixtureId,
    p_status: status,
    p_result: result,
  });

  if (error) {
    console.error("setFixtureResult failed:", error);
    return { error: "Failed to save the result." };
  }

  const outcome = data as {
    ok: boolean;
    code?: string;
    round_number?: number;
  } | null;

  if (!outcome?.ok) {
    if (outcome?.code === "not_found") {
      return { error: "That fixture no longer exists." };
    }
    if (outcome?.code === "round_settled") {
      return {
        error: `Round ${outcome.round_number} has already been settled — this result was applied to players and can't be changed while it stands. To correct it, reopen round ${outcome.round_number} (the button at the bottom of this page), fix the result, then settle the round again.`,
      };
    }
    console.error("setFixtureResult refused:", outcome);
    return { error: "Failed to save the result." };
  }

  revalidatePath("/admin/results");
  return { ok: true };
}

/** What lms_settle_round returns. See db/settlement-fn.sql. */
type SettlementResult = {
  ok: boolean;
  code: string;
  end_kind?: "continue" | "won" | "rollover" | "pending" | "provisional";
  round_number?: number;
  eliminated?: number;
  survivors?: number;
  detail?: {
    round_number?: number;
    matchday?: number;
    fixtures?: string[];
  } | null;
};

/**
 * Settle the current round — ONE Postgres transaction, via lms_settle_round().
 *
 * PLAN → VALIDATE → APPLY. This action reads the state, computes the whole
 * settlement with the pure engine (lib/lms.ts, still the only place the rules
 * live), and hands the result to the RPC as a plan. The function proves the
 * database still looks exactly as it did when the plan was computed — same
 * round, same fixtures, same picks, same active entries — and then applies the
 * lot atomically. If anything moved underneath it applies NOTHING and says so,
 * and the organiser re-runs against fresh state.
 *
 * The engine is therefore never duplicated in SQL, and there is no longer any
 * such thing as a half-applied settlement: the entries-then-competition write
 * order that the deferred won-integrity trigger wants now happens inside one
 * transaction, so the old self-heal for a half-applied win has been deleted
 * along with the state that made it necessary.
 *
 * The RPC also takes the advisory lock the manual result editor takes, so a
 * fixture result cannot change mid-settlement.
 *
 * The guards below duplicate ones the function repeats inside the transaction.
 * That is on purpose: these produce the exact message an organiser needs, from
 * data already in hand, before a plan is built. The function's copies are the
 * ones that are actually load-bearing.
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
  // auto-assign teams to entries that still have time to choose.
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
  const allPicks = await getPicksForCompetition(competition.id);
  const buybacks = await getBuybacks(competition.id);

  // ---- 1. work out the whole settlement, with the engine ----
  const built = buildSettlementPlan({
    competitionId: competition.id,
    round,
    roundNumberById: new Map(rounds.map((r) => [r.id, r.round_number])),
    teams,
    fixtures,
    entries: entries.map((e) => ({
      id: e.id,
      participant_id: e.participant_id,
      status: e.status,
      label: e.participant?.name ?? e.id,
      eliminated_round_number: eliminatedRoundNumber(e, rounds),
    })),
    picks: allPicks.map((p) => ({
      entry_id: p.entry_id,
      round_id: p.round_id,
      team_id: p.team_id,
    })),
    // Buy-back: who could still come back once this round is settled, and by
    // when. A round that wipes out the field no longer rolls the competition
    // over on the spot — see docs/LMS-RULES.md § Buy-back and rollover.
    allRounds: planRounds(rounds),
    buybacks: planBuybacks(buybacks, rounds),
  });

  if (!built.ok) {
    // Nothing has been written at this point and no plan is ever sent — these
    // are all "we cannot even describe a settlement", not partial failures.
    switch (built.reason) {
      case "no_active_entries":
        return { error: "No active entries to settle." };
      case "auto_assign_stuck":
        return {
          error: `No team can be auto-assigned for: ${built.stuck.join(", ")}. Every team they can still use is already out of this matchday — needs an organiser decision.`,
        };
      case "unsettled":
        // Named, not counted. This is the Saturday-night refusal: one player
        // has lost, the other's game is tomorrow, and the organiser needs to
        // know it is that game they are waiting on — not that "1 pick" is
        // somehow stuck.
        return {
          error: `Can't settle yet — no result for ${built.fixtures.join(", ")}. Every fixture a surviving entry picked has to be in first. Nothing has been changed.`,
        };
    }
  }

  const { plan, state, eliminatedIds } = built;

  // ---- 2. hand the whole thing to the transaction ----
  const { data, error } = await supabaseServer.rpc("lms_settle_round", {
    p_plan: plan,
  });

  if (error) {
    console.error("settleCurrentRound RPC failed:", error);
    return {
      error:
        "Settlement failed and nothing was changed — the whole thing is one transaction, so the round is exactly as it was. Try again.",
    };
  }

  const result = data as SettlementResult | null;
  if (!result) {
    console.error("settleCurrentRound returned no result");
    return { error: "Settlement returned nothing. Nothing was changed." };
  }

  if (!result.ok) {
    return { error: settlementRefusal(result, round.round_number, round.matchday) };
  }

  // Everything a settle moves. /admin/entrants is where the eliminations, the
  // pick outcomes and any new buy-back offers show up — an offer that expires at
  // the next deadline must not be waiting on a cache — and /leaderboard is the
  // public standings. (/board was the old public route; it redirects to
  // /leaderboard now and revalidating it did nothing.)
  revalidatePath("/admin/results");
  revalidatePath("/admin/entrants");
  revalidatePath("/leaderboard");

  if (result.code === "locked_provisional") {
    // Deliberately NOT settled. The rules say a player cannot win outright on a
    // postponed/abandoned game, so this round has to be re-settled once the
    // real result lands — and the idempotency guard refuses a settled round,
    // which would strand the competition with no winner forever. 'locked' keeps
    // it the current round and re-settleable, and its pick outcomes and
    // eliminations were applied in the same transaction as the lock.
    return {
      ok: `Round ${round.round_number} is decided, but the win rests only on postponed/abandoned fixture(s) — the competition is NOT settled. Per the rules, enter the real result once those games are played and settle this round again.`,
    };
  }

  const eliminatedCount = result.eliminated ?? eliminatedIds.length;

  // The buy-back states. The round IS settled in both — what is not yet decided
  // is the competition, and it stays undecided until the window shuts.
  if (state.kind === "pending_rollover") {
    return {
      ok: `Everyone went out in round ${round.round_number} — but the competition has NOT rolled over yet. ${state.open_entry_ids.length} eliminated ${state.open_entry_ids.length === 1 ? "entry" : "entries"} can still buy back in for £10, up to ${deadlineLabel(state.window_closes)}. If nobody does, come back here after that and confirm the rollover.`,
    };
  }

  if (state.kind === "pending_win") {
    const name = await participantName(state.participant_id);
    return {
      ok: `Round ${round.round_number} settled — ${eliminatedCount} out. ${name} is the last one standing, but is NOT the winner yet: an eliminated entry can still buy back in for £10, up to ${deadlineLabel(state.window_closes)}. Come back here after that to crown them.`,
    };
  }

  if (state.kind === "rollover") {
    const pot = potPence(
      competition.pot_carried_in_pence,
      [...entries, ...buybacks].map((e) => ({
        paid: e.paid,
        amount_paid_pence: e.amount_paid_pence,
      }))
    );
    return {
      ok: `Everyone went out in round ${round.round_number}. Competition rolled over — carry ${formatPence(pot)} into the next one (set it as "pot carried in", rollover count ${competition.rollover_count + 1}).`,
    };
  }

  if (state.kind === "won") {
    const winner = entries.find(
      (e) => e.participant_id === state.participant_id
    )?.participant?.name;
    return {
      ok: `${winner ?? "Winner"} is the Last Man Standing — competition won with ${state.entry_ids.length} surviving ${state.entry_ids.length === 1 ? "entry" : "entries"}.`,
    };
  }

  const standing = state.kind === "continue" ? state.entry_ids.length : 0;
  return {
    ok: `Round ${round.round_number} settled — ${eliminatedCount} out, ${standing} still standing.`,
  };
}

/** "Saturday 17 January, 12:30" — how every deadline is written on the admin. */
const deadlineFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function deadlineLabel(iso: string): string {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? "the next round's deadline" : deadlineFormat.format(at);
}

/** One name, for a message. Never worth failing an action over. */
async function participantName(id: string | null): Promise<string> {
  if (!id) return "The last entry standing";
  try {
    return (await getParticipantNames([id])).get(id) ?? "The last entry standing";
  } catch (e) {
    console.error("participant name lookup failed:", e);
    return "The last entry standing";
  }
}

/**
 * Close off a competition whose buy-back window has run out — confirm the
 * rollover, or crown the winner.
 *
 * THE SECOND HALF OF SETTLEMENT. Before buy-back existed, settling the round
 * that wiped out the field WAS the rollover, and settling the round that left
 * one entry WAS the win. Both now stop short: docs/LMS-RULES.md makes the
 * competition PENDING until the buy-back window — the next round's pick
 * deadline — closes with nobody having paid to come back. This is what runs
 * then, and it refuses until the clock says it may.
 *
 * It is deliberately a separate press rather than something that happens on a
 * timer. There is no scheduler in this app, the organiser is the one who knows
 * whether a payment is on its way, and "the competition rolled over while you
 * were in the pub" is not a thing anybody should discover after the fact.
 */
export async function finaliseCompetition(): Promise<ActionState> {
  await requireAdmin();

  const competition = await getActiveCompetition();
  if (!competition) return { error: "No active competition." };

  const rounds = await getRounds(competition.id);
  const entries = await getEntries(competition.id);
  const buybacks = await getBuybacks(competition.id);

  const built = buildFinalisationPlan({
    competitionId: competition.id,
    entries: entries.map((e) => ({
      id: e.id,
      participant_id: e.participant_id,
      status: e.status,
      label: e.participant?.name ?? e.id,
      eliminated_round_number: eliminatedRoundNumber(e, rounds),
    })),
    allRounds: planRounds(rounds),
    buybacks: planBuybacks(buybacks, rounds),
    settledRoundNumber: settledRoundNumber(rounds),
  });

  if (!built.ok) {
    if (built.reason === "not_ended") {
      return {
        error:
          "This competition is still running — there is nothing to finalise. Settle the current round instead.",
      };
    }
    return {
      error: `Not yet — an eliminated entry can still buy back in until ${deadlineLabel(built.closesAt)}. Nothing has been changed.`,
    };
  }

  const { data, error } = await supabaseServer.rpc("lms_finalise_competition", {
    p_plan: built.plan,
  });

  if (error) {
    console.error("finaliseCompetition RPC failed:", error);
    return {
      error:
        "Finalising failed and nothing was changed — the whole thing is one transaction. Try again.",
    };
  }

  const result = data as {
    ok: boolean;
    code: string;
    end_kind?: "won" | "rollover";
    detail?: { closes_at?: string; active?: number } | null;
  } | null;

  if (!result) {
    console.error("finaliseCompetition returned no result");
    return { error: "Finalising returned nothing. Nothing was changed." };
  }

  if (!result.ok) {
    switch (result.code) {
      case "no_active_competition":
        return { error: "No active competition." };
      case "window_open":
        return {
          error: `Not yet — the buy-back window is still open${
            result.detail?.closes_at
              ? ` until ${deadlineLabel(result.detail.closes_at)}`
              : ""
          }. Nothing has been changed.`,
        };
      case "buybacks_changed":
        return {
          error:
            "Somebody bought back in while this was being worked out — the competition is still running. Nothing has been changed. Reload.",
        };
      case "entries_changed":
        return {
          error:
            "The entries changed while this was being worked out. Nothing has been changed. Reload and try again.",
        };
      case "survivors_remain":
        return {
          error:
            "There are still entries standing, so this competition has not rolled over. Nothing has been changed. Reload.",
        };
      default:
        console.error("unexpected finalisation refusal:", result);
        return {
          error:
            "Finalising was refused and nothing was changed. Reload and try again.",
        };
    }
  }

  revalidatePath("/admin/results");
  revalidatePath("/admin/entrants");
  revalidatePath("/leaderboard");

  if (built.state.kind === "rollover") {
    const pot = potPence(
      competition.pot_carried_in_pence,
      [...entries, ...buybacks].map((e) => ({
        paid: e.paid,
        amount_paid_pence: e.amount_paid_pence,
      }))
    );
    return {
      ok: `The buy-back window closed with nobody coming back. Competition rolled over — carry ${formatPence(pot)} into the next one (set it as "pot carried in", rollover count ${competition.rollover_count + 1}).`,
    };
  }

  const winner = await participantName(
    built.state.kind === "won" ? built.state.participant_id : null
  );
  const count = built.state.kind === "won" ? built.state.entry_ids.length : 0;
  return {
    ok: `${winner} is the Last Man Standing — competition won with ${count} surviving ${count === 1 ? "entry" : "entries"}.`,
  };
}

/** What lms_reopen_round returns. See db/reopen-round.sql. */
type ReopenResult = {
  ok: boolean;
  code: string;
  round_number?: number;
  revived?: number;
  winners_reverted?: number;
  outcomes_reset?: number;
  competition_reverted_from?: "won" | "rolled_over" | null;
  buybacks_on_round?: number;
  detail?: {
    round_number?: number;
    status?: string;
    later_round_number?: number;
    later_status?: string;
  } | null;
};

/**
 * Reopen a settled round so a wrong result can be corrected and the round
 * settled again — ONE Postgres transaction, via lms_reopen_round().
 *
 * THE OTHER HALF OF "SETTLEMENT IS ONE-WAY". lms_settle_round refuses a round
 * that is already settled, and lms_set_fixture_result refuses to change a
 * result on a settled matchday. Both are right: a settled round is a result
 * people have been told. But a result typed in wrong and settled on used to be
 * fixable only by hand-written SQL across four tables. This is that fix as a
 * button: the function reverses exactly what settlement wrote — this round's
 * eliminations revived, its pick outcomes back to pending, any winner and a
 * won/rolled-over competition reverted — and puts the round back to 'locked',
 * where the normal correct-the-result + Settle flow applies. Nothing about the
 * rules is re-derived; re-settling is what decides the new outcome, through
 * the engine, like any other week.
 *
 * ONLY THE LATEST SETTLED ROUND. A later round settled on this one's
 * survivors; reviving anyone here would leave it describing a field that no
 * longer exists. The function refuses ('not_latest') and names the later
 * round. The page only offers the button for the round that qualifies
 * (lib/reopen-round.ts), so this refusal is what a stale tab gets.
 *
 * The round id comes from the form, not from "the current round": the round
 * being reopened is by definition not current, and the competition it belongs
 * to may already be won — so this deliberately does not go through
 * getActiveCompetition().
 */
export async function reopenRound(
  _state: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireAdmin();

  const roundId = String(formData.get("round_id") ?? "").trim();
  if (!roundId) return { error: "No round was named. Reload and try again." };

  let round: Awaited<ReturnType<typeof getRound>>;
  try {
    round = await getRound(roundId);
  } catch (e) {
    console.error("reopenRound round lookup failed:", e);
    return { error: "Could not read the round. Nothing was changed — try again." };
  }
  if (!round) return { error: "That round no longer exists. Reload." };

  const { data, error } = await supabaseServer.rpc("lms_reopen_round", {
    p_round_id: roundId,
  });

  if (error) {
    // A transport-level failure, not a refusal. The function is one
    // transaction, so the database is either fully reopened or untouched — but
    // from here there is no telling which: the call may have committed and the
    // reply been lost. Say so, rather than promising a rollback we cannot see.
    console.error("reopenRound RPC failed:", error);
    return {
      error: `Reopening round ${round.round_number} did not get a reply, so it is not known whether it went through. Reload this page to see the round's actual state before trying again.`,
    };
  }

  const result = data as ReopenResult | null;
  if (!result) {
    console.error("reopenRound returned no result");
    return { error: "Reopening returned nothing. Nothing was changed." };
  }

  if (!result.ok) {
    return { error: reopenRefusal(result, round.round_number) };
  }

  // Everything a reopen moves: the results page (the round is current again
  // and its results editable), entrants (revived entries, pending outcomes),
  // and the public standings.
  revalidatePath("/admin/results");
  revalidatePath("/admin/entrants");
  revalidatePath("/leaderboard");

  const n = result.round_number ?? round.round_number;
  const revived = result.revived ?? 0;
  const parts = [
    `Round ${n} is reopened — ${revived} ${revived === 1 ? "entry" : "entries"} back in`,
  ];
  if (result.competition_reverted_from === "won") {
    parts.push("the winner is un-crowned and the competition is active again");
  } else if (result.competition_reverted_from === "rolled_over") {
    parts.push("the rollover is undone and the competition is active again");
  }
  let message = `${parts.join(", ")}. Now correct the result in the fixtures above and settle round ${n} again.`;
  if ((result.buybacks_on_round ?? 0) > 0) {
    const b = result.buybacks_on_round ?? 0;
    message += ` Note: ${b} buy-back ${b === 1 ? "was" : "were"} taken against this round's eliminations and ${b === 1 ? "has" : "have"} been left as ${b === 1 ? "it was" : "they were"} — if the corrected result keeps that entry in, the £10 is yours to refund.`;
  }
  return { ok: message };
}

/**
 * Turn a refusal code from lms_reopen_round into something an organiser can
 * act on. Every one of these means NOTHING was written.
 */
function reopenRefusal(result: ReopenResult, roundNumber: number): string {
  const n = result.detail?.round_number ?? roundNumber;
  switch (result.code) {
    case "round_not_found":
      return "That round no longer exists. Reload.";
    case "not_settled":
      return result.detail?.status === "locked"
        ? `Round ${n} is already reopened — correct the result and settle it again.`
        : `Round ${n} is not settled, so there is nothing to reopen.`;
    case "not_latest":
      return `Round ${n} is not the most recently settled round — round ${result.detail?.later_round_number ?? "?"} was ${result.detail?.later_status === "locked" ? "provisionally locked" : "settled"} after it, on round ${n}'s survivors. Only the most recent settled round can be reopened. To correct round ${n}, reopen the later rounds first, latest to earliest, then settle forward again.`;
    case "another_competition_active":
      return `Round ${n} concluded its competition, and another competition is already active. Reopening it would need two active competitions, which is not allowed. Nothing was changed.`;
    default:
      console.error("unexpected reopen refusal:", result);
      return "Reopening was refused and nothing was changed. Reload and try again.";
  }
}

/**
 * Turn a refusal code from lms_settle_round into something an organiser can
 * act on. Every one of these means NOTHING was written — the function decides
 * all of them before its first write.
 */
function settlementRefusal(
  result: SettlementResult,
  roundNumber: number,
  matchday: number
): string {
  const moved =
    "Nothing was changed — the settle ran against state that had already moved on. Reload and settle again.";

  switch (result.code) {
    case "no_active_competition":
      return "No active competition.";
    case "already_settled":
      return `Round ${result.detail?.round_number ?? roundNumber} is already settled.`;
    case "round_open":
      return `Round ${result.detail?.round_number ?? roundNumber} is still open — picks lock at the deadline. Settle after it passes.`;
    case "no_fixtures":
      return `No fixtures loaded for matchday ${result.detail?.matchday ?? matchday}.`;
    case "no_active_entries":
      return "No active entries to settle.";
    case "missing_results": {
      // The database's own copy of the "every picked fixture has a result"
      // guard. The plan builder refuses first and this should be unreachable,
      // so it is worth reading as what it is: the last line of defence against
      // settling a round on a game nobody has played.
      const named = result.detail?.fixtures?.join(", ");
      return named
        ? `Can't settle yet — no result for ${named}. Every fixture a surviving entry picked has to be in first. Nothing has been changed.`
        : "Some picked fixtures still have no result — enter them first. Nothing has been changed.";
    }
    case "impossible_survival":
      // Cannot come from this action — the engine never claims a survival for a
      // team with no game. It means the plan and the database disagree about
      // the matchday's fixtures.
      console.error("settlement claimed an impossible survival:", result);
      return "Settlement was refused: it claimed a team survived a game that isn't in this matchday. Nothing has been changed — check the fixtures for this matchday are right.";
    case "incomplete_plan":
      return "Some picks still have no result — enter every fixture's result first. Nothing has been changed.";
    case "fixtures_changed":
      return `A fixture result changed while this settle was being worked out. ${moved}`;
    case "picks_changed":
      return `A pick changed while this settle was being worked out. ${moved}`;
    case "entries_changed":
      return `The entries changed while this settle was being worked out. ${moved}`;
    case "round_not_found":
    case "round_changed":
      return `The round changed while this settle was being worked out. ${moved}`;
    default:
      console.error("unexpected settlement refusal:", result);
      return "Settlement was refused and nothing was changed. Reload and try again.";
  }
}
