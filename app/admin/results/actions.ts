"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, ActionState } from "@/lib/action-state";
import { requireAdmin } from "@/lib/admin-auth";
import { buildSettlementPlan } from "@/lib/settlement-plan";
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
        error: `Round ${outcome.round_number} has already been settled — this result was applied to players and can't be changed here. Reopening a settled round is a deliberate re-settle, not an edit; it needs doing by hand for now.`,
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
  end_kind?: "continue" | "won" | "rollover" | "provisional";
  round_number?: number;
  eliminated?: number;
  survivors?: number;
  detail?: { round_number?: number; matchday?: number } | null;
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
 * The RPC also takes the advisory lock that the results cron and the manual
 * result editor take, so a fixture result cannot change mid-settlement.
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
    })),
    picks: allPicks.map((p) => ({
      entry_id: p.entry_id,
      round_id: p.round_id,
      team_id: p.team_id,
    })),
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
        return {
          error: `${built.count} pick(s) can't be settled yet — enter every fixture's result first. Nothing has been changed.`,
        };
    }
  }

  const { plan, end, eliminatedIds } = built;

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

  revalidatePath("/admin/results");
  revalidatePath("/board");

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

  if (end.kind === "rollover") {
    const pot = potPence(
      competition.pot_carried_in_pence,
      entries.map((e) => ({
        paid: e.paid,
        amount_paid_pence: e.amount_paid_pence,
      }))
    );
    return {
      ok: `Everyone went out in round ${round.round_number}. Competition rolled over — carry ${formatPence(pot)} into the next one (set it as "pot carried in", rollover count ${competition.rollover_count + 1}).`,
    };
  }

  if (end.kind === "won") {
    const winner = entries.find(
      (e) => e.participant_id === end.participant_id
    )?.participant?.name;
    return {
      ok: `${winner ?? "Winner"} is the Last Man Standing — competition won with ${end.entry_ids.length} surviving ${end.entry_ids.length === 1 ? "entry" : "entries"}.`,
    };
  }

  return {
    ok: `Round ${round.round_number} settled — ${eliminatedCount} out, ${end.entry_ids.length} still standing.`,
  };
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
