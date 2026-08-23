// The LIVE round view — who is still in on the results entered so far,
// computed read-only while the organiser types them in.
//
// Pure and READ-ONLY by construction: this module imports the engine
// (lib/lms.ts) and nothing else — no Supabase client, no lib/lms-db, no I/O of
// any kind — so it CANNOT settle, eliminate, crown or write. It answers the
// mid-round question ("my team just lost, am I out?") on the public
// leaderboard without touching the thing that actually decides it: settlement
// stays the single deliberate admin action it is now, and nothing here
// persists. tests/provisional.test.ts pins both the answers and the
// no-database-imports property.
//
// The rule is ONE subtraction, not a status per entry. Live "still in" =
// active entries MINUS those whose pick has already confirmedly failed — a
// draw or a loss in a result the organiser has entered. An entry whose team
// won and an entry whose game hasn't kicked off yet are the SAME thing here:
// still in. That mirrors how the competition is actually read off a pub wall
// mid-afternoon, and it spares the board a three-way safe/pending/out
// vocabulary nobody asked for.
//
// Dropping off this list is NOT elimination. The entry's status is untouched,
// the permanent Eliminated table doesn't gain a row, and no buy-back window
// opens — all of that happens only at settlement, after the last game. That
// ordering is load-bearing: with one survivor left on Saturday whose own game
// is Sunday, everyone else drops off this list a day before anyone knows
// whether it's a win or a full-round wipeout.
//
// The window is deliberately narrow: a LOCKED round that is not yet settled.
//
//   pending → null. Picks may still be arriving and blanks are unfilled, so
//             an absent pick would read as "still in" for the wrong reason.
//             Locking is what makes the pick list complete
//             (docs/LMS-RULES.md § Locking a round).
//   locked  → the view. Every result the organiser has entered moves it.
//   settled → null. The outcomes are real now, written on the picks
//             themselves, and the confirmed tables take over.
//
// The failures come from the same settleRound() that real settlement uses —
// called here for its RETURN VALUE only, nothing written back — so the live
// list can never disagree with the settlement that follows for the same
// results. That includes the two edge cases worth having for free: a
// postponed/abandoned fixture counts as a win (still in), and a pick with no
// game on a COMPLETE matchday (the auto-assign fallback) is a confirmed
// failure — while an incomplete fixture list keeps everyone in rather than
// dropping someone over a gap.

import {
  isMatchdayComplete,
  isUnplayed,
  settleRound,
  type EntryRecord,
  type Fixture,
  type PickRecord,
} from "@/lib/lms";

export type ProvisionalRound = {
  round_number: number;
  matchday: number;
  status: "pending" | "locked" | "settled";
};

export type ProvisionalView = {
  roundNumber: number;
  /** Fixtures on this matchday with a known outcome — played with a result,
      or postponed/abandoned (which the rules score as a win). */
  played: number;
  /** All fixtures on this matchday. */
  total: number;
  /**
   * ACTIVE entries whose pick has confirmedly failed — drew or lost in a
   * result entered so far. The live "still in" list is everyone active who is
   * NOT in this set. Never contains an already-eliminated or winner entry:
   * their fate is confirmed and not re-answered.
   */
  outEntryIds: Set<string>;
};

/**
 * The live view for a round, or null when there is nothing live to say —
 * which is exactly the "reverts to the confirmed tables" behaviour: callers
 * render the normal standings whenever this is null.
 *
 * `picks` must be THIS round's picks only; `fixtures` may span any range
 * (only `round.matchday` is consulted, same contract as settleRound).
 * `teamCount` is the size of the league, gating the one destructive-looking
 * reading — "this team has no game" — on the fixture list being complete,
 * exactly as real settlement gates it.
 */
export function computeProvisionalView(input: {
  round: ProvisionalRound;
  entries: EntryRecord[];
  picks: PickRecord[];
  fixtures: Fixture[];
  teamCount: number;
}): ProvisionalView | null {
  const { round, entries, picks, fixtures, teamCount } = input;

  if (round.status !== "locked") return null;

  const complete = isMatchdayComplete(fixtures, round.matchday, teamCount);
  // Return value only. settleRound is pure (lib/lms.ts) — the entry rows it
  // hands back with advanced statuses are dropped on the floor here, unread.
  const { outcomes } = settleRound(
    entries,
    picks,
    fixtures,
    round.matchday,
    complete
  );

  const outEntryIds = new Set<string>();
  for (const o of outcomes) {
    if (o.outcome === "eliminated") outEntryIds.add(o.entry_id);
  }

  let played = 0;
  let total = 0;
  for (const f of fixtures) {
    if (f.matchday !== round.matchday) continue;
    total++;
    if ((f.status === "played" && f.result !== null) || isUnplayed(f)) played++;
  }

  return { roundNumber: round.round_number, played, total, outEntryIds };
}
