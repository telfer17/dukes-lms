// Which round of a competition may be REOPENED — pure, no I/O.
//
// Reopening reverses a settled round's settlement effects so a wrong result can
// be corrected and the round settled again (db/reopen-round.sql). The rule for
// which round that can be is small and worth having in one place, because two
// screens and one action all need the same answer: the results page decides
// whether to draw the button and what to write next to it, and the action
// decides what to tell the organiser when the database refuses.
//
// The function in Postgres re-checks the same guard inside the transaction and
// is the copy that is load-bearing. This one exists so the UI never OFFERS a
// reopen the database would refuse, and so the reason can be said in words.
//
// THE RULE. Only the most recently settled round can be reopened, and only if
// no later round has been touched by settlement at all. A later round settles
// on THIS round's survivors — its eliminations and its auto-assignments were
// computed from who this round let through — so reviving anyone here would
// leave the later round describing a field that no longer exists. A later round
// in status 'locked' counts as touched: that is the provisional-win lock, which
// applies outcomes and eliminations (db/settlement-fn.sql § 7). Only 'pending'
// later rounds are untouched.

export type ReopenRound = {
  id: string;
  round_number: number;
  status: "pending" | "locked" | "settled";
};

export type ReopenVerdict<R extends ReopenRound = ReopenRound> =
  | { ok: true; round: R }
  | { ok: false; reason: "round_not_found" }
  /** The round is pending or provisionally locked — there is nothing to reverse. */
  | { ok: false; reason: "not_settled"; round: R }
  /** A later round has settlement effects; only it (if settled) could be reopened. */
  | { ok: false; reason: "not_latest"; round: R; later: R };

/** The highest-numbered round settlement has touched: settled or locked. */
function latestTouched<R extends ReopenRound>(rounds: R[]): R | null {
  let latest: R | null = null;
  for (const r of rounds) {
    if (r.status === "pending") continue;
    if (latest === null || r.round_number > latest.round_number) latest = r;
  }
  return latest;
}

/**
 * The one round that can be reopened right now, or null if none can.
 *
 * Null when nothing is settled, and ALSO when the latest touched round is a
 * provisional lock rather than a settlement: the settled round beneath it is
 * not the latest, and the locked round itself has nothing settled to reverse
 * (it is already re-settleable — that is what the lock is for).
 */
export function reopenableRound<R extends ReopenRound>(rounds: R[]): R | null {
  const latest = latestTouched(rounds);
  return latest?.status === "settled" ? latest : null;
}

/** Why a specific round can or cannot be reopened, for the message. */
export function reopenVerdict<R extends ReopenRound>(
  rounds: R[],
  roundId: string
): ReopenVerdict<R> {
  const round = rounds.find((r) => r.id === roundId);
  if (!round) return { ok: false, reason: "round_not_found" };
  if (round.status !== "settled") {
    return { ok: false, reason: "not_settled", round };
  }
  const latest = latestTouched(rounds);
  if (latest && latest.round_number > round.round_number) {
    return { ok: false, reason: "not_latest", round, later: latest };
  }
  return { ok: true, round };
}
