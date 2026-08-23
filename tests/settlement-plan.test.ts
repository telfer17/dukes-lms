import { describe, expect, it } from "vitest";
import {
  buildFinalisationPlan,
  buildLockPlan,
  buildSettlementPlan,
  type PlanEntry,
  type PlanRoundInfo,
} from "@/lib/settlement-plan";
import type { EntryStatus, Fixture, Team } from "@/lib/lms";

// The plan builder is pure, so it can be pinned down here without a database.
// tests/db/settlement.db.test.ts then proves the plans it produces actually
// apply — these two halves are deliberately separate, so a machine with no
// Postgres still covers everything except the transaction itself.

const TEAMS: Team[] = [
  { id: 1, name: "Arsenal" },
  { id: 2, name: "Aston Villa" },
  { id: 3, name: "Bournemouth" },
  { id: 4, name: "Brentford" },
  { id: 5, name: "Chelsea" },
  { id: 6, name: "Crystal Palace" },
];

const fixture = (
  id: number,
  home: number,
  away: number,
  status: Fixture["status"] = "played",
  result: Fixture["result"] = null
): Fixture => ({
  id,
  matchday: 1,
  home_team_id: home,
  away_team_id: away,
  status,
  result,
});

const ROUND = { id: "r1", round_number: 1, matchday: 1 };
const ROUND_NUMBERS = new Map([["r1", 1]]);

// A buy-back window shuts at the NEXT round's pick deadline, so whether one is
// open is a property of the WORLD, not of the settlement. The default world
// below has round 2's deadline already behind it: no window is open, and the
// tests in the first two blocks are about settlement mechanics exactly as they
// were before buy-back existed. The buy-back block near the bottom moves the
// deadline forward and asserts the pending states.
const NOW = new Date("2026-01-10T12:00:00.000Z");
const WINDOW_OPEN = "2026-01-11T12:00:00.000Z";
const WINDOW_SHUT = "2026-01-09T12:00:00.000Z";

const ALL_ROUNDS: PlanRoundInfo[] = [
  { round_number: 1, deadline: "2026-01-08T12:00:00.000Z", status: "pending" },
  { round_number: 2, deadline: WINDOW_SHUT, status: "pending" },
];

/** The same world with round 2 still to come — every window still open. */
const ROUNDS_WINDOW_OPEN: PlanRoundInfo[] = [
  ALL_ROUNDS[0],
  { round_number: 2, deadline: WINDOW_OPEN, status: "pending" },
];

const entry = (
  id: string,
  participant_id: string,
  status: EntryStatus = "active"
): PlanEntry => ({
  id,
  participant_id,
  status,
  label: id,
  eliminated_round_number: status === "eliminated" ? 1 : null,
});

function build(
  overrides: Partial<Parameters<typeof buildSettlementPlan>[0]> = {}
) {
  return buildSettlementPlan({
    competitionId: "c1",
    round: ROUND,
    roundNumberById: ROUND_NUMBERS,
    teams: TEAMS,
    fixtures: [
      fixture(10, 1, 2, "played", "home"), // Arsenal beat Aston Villa
      fixture(11, 3, 4, "played", "draw"), // Bournemouth v Brentford drawn
      fixture(12, 5, 6, "postponed"), // Chelsea v Palace off
    ],
    entries: [entry("e1", "p1"), entry("e2", "p2")],
    picks: [
      { entry_id: "e1", round_id: "r1", team_id: 1 },
      { entry_id: "e2", round_id: "r1", team_id: 3 },
    ],
    allRounds: ALL_ROUNDS,
    buybacks: [],
    now: NOW,
    ...overrides,
  });
}

describe("buildSettlementPlan", () => {
  it("carries the fingerprints the transaction re-checks", () => {
    const built = build();
    if (!built.ok) throw new Error(built.reason);

    expect(built.plan.expected_fixtures).toEqual([
      { id: 10, status: "played", result: "home" },
      { id: 11, status: "played", result: "draw" },
      { id: 12, status: "postponed", result: null },
    ]);
    expect(built.plan.expected_picks).toEqual([
      { entry_id: "e1", team_id: 1 },
      { entry_id: "e2", team_id: 3 },
    ]);
    expect(built.plan.expected_active_entry_ids).toEqual(["e1", "e2"]);
  });

  it("eliminates the drawer and leaves the winner standing", () => {
    const built = build();
    if (!built.ok) throw new Error(built.reason);

    expect(built.plan.pick_outcomes).toEqual([
      { entry_id: "e1", outcome: "survived" },
      { entry_id: "e2", outcome: "eliminated" },
    ]);
    expect(built.plan.eliminate_entry_ids).toEqual(["e2"]);
    expect(built.plan.end.kind).toBe("won");
    expect(built.plan.end.participant_id).toBe("p1");
    expect(built.plan.end.winner_entry_ids).toEqual(["e1"]);
  });

  it("auto-assigns the first alphabetically-available playing team", () => {
    const built = build({
      picks: [{ entry_id: "e2", round_id: "r1", team_id: 3 }],
    });
    if (!built.ok) throw new Error(built.reason);

    // e1 has no history, so Arsenal — first alphabetically among those playing.
    expect(built.plan.auto_assign).toEqual([{ entry_id: "e1", team_id: 1 }]);
    // The assignment is settled in the same pass, not left pending.
    expect(built.plan.pick_outcomes).toContainEqual({
      entry_id: "e1",
      outcome: "survived",
    });
  });

  it("never auto-assigns a team the entry used in an earlier round", () => {
    const built = build({
      roundNumberById: new Map([
        ["r0", 0],
        ["r1", 1],
      ]),
      picks: [
        { entry_id: "e1", round_id: "r0", team_id: 1 }, // used Arsenal already
        { entry_id: "e2", round_id: "r1", team_id: 3 },
      ],
    });
    if (!built.ok) throw new Error(built.reason);

    expect(built.plan.auto_assign).toHaveLength(1);
    const assigned = built.plan.auto_assign[0];
    expect(assigned.entry_id).toBe("e1");
    expect(assigned.team_id).not.toBe(1); // Arsenal is used
    // Drawn from the teams actually playing this matchday.
    expect([2, 3, 4, 5, 6]).toContain(assigned.team_id);
  });

  it("draws the SAME team however many times the plan is built", () => {
    // The property the lock relies on: settlement's backstop and the lock draw
    // from one seed, so an unlocked round settles exactly as a locked one would.
    const first = build({ picks: [{ entry_id: "e2", round_id: "r1", team_id: 3 }] });
    if (!first.ok) throw new Error(first.reason);
    for (let i = 0; i < 5; i++) {
      const again = build({ picks: [{ entry_id: "e2", round_id: "r1", team_id: 3 }] });
      if (!again.ok) throw new Error(again.reason);
      expect(again.plan.auto_assign).toEqual(first.plan.auto_assign);
    }
  });

  it("marks a win resting only on a postponement as PROVISIONAL", () => {
    const built = build({
      picks: [
        { entry_id: "e1", round_id: "r1", team_id: 5 }, // Chelsea — postponed
        { entry_id: "e2", round_id: "r1", team_id: 3 }, // drew, out
      ],
    });
    if (!built.ok) throw new Error(built.reason);

    expect(built.provisional).toBe(true);
    // The plan LOCKS the round rather than settling it, and crowns nobody.
    expect(built.plan.end.kind).toBe("provisional");
    expect(built.plan.end.winner_entry_ids).toEqual([]);
    // The elimination still applies — only the ending is held back.
    expect(built.plan.eliminate_entry_ids).toEqual(["e2"]);
  });

  it("does NOT mark a normal win provisional just because someone else was postponed", () => {
    const built = build({
      entries: [entry("e1", "p1"), entry("e2", "p2"), entry("e3", "p1")],
      picks: [
        { entry_id: "e1", round_id: "r1", team_id: 1 }, // real win
        { entry_id: "e2", round_id: "r1", team_id: 3 }, // out
        { entry_id: "e3", round_id: "r1", team_id: 5 }, // postponed
      ],
    });
    if (!built.ok) throw new Error(built.reason);

    expect(built.provisional).toBe(false);
    expect(built.plan.end.kind).toBe("won");
    expect(built.plan.end.participant_id).toBe("p1");
    expect(built.plan.end.winner_entry_ids).toEqual(["e1", "e3"]);
  });

  it("rolls over when everyone goes out at once", () => {
    const built = build({
      picks: [
        { entry_id: "e1", round_id: "r1", team_id: 3 },
        { entry_id: "e2", round_id: "r1", team_id: 4 },
      ],
    });
    if (!built.ok) throw new Error(built.reason);

    expect(built.plan.end.kind).toBe("rollover");
    expect(built.plan.end.participant_id).toBeNull();
    expect(built.plan.eliminate_entry_ids).toEqual(["e1", "e2"]);
  });

  it("continues while two different people are still in", () => {
    const built = build({
      picks: [
        { entry_id: "e1", round_id: "r1", team_id: 1 },
        { entry_id: "e2", round_id: "r1", team_id: 5 },
      ],
    });
    if (!built.ok) throw new Error(built.reason);
    expect(built.plan.end.kind).toBe("continue");
    expect(built.plan.eliminate_entry_ids).toEqual([]);
  });

  it("refuses when a picked fixture has no result yet", () => {
    const built = build({
      fixtures: [
        fixture(10, 1, 2, "scheduled"),
        fixture(11, 3, 4, "played", "draw"),
        fixture(12, 5, 6, "postponed"),
      ],
    });
    // Named, not just counted: the organiser is told WHICH game they are
    // waiting on, which is the whole difference between a useful refusal and
    // "1 pick(s) can't be settled yet".
    expect(built).toEqual({
      ok: false,
      reason: "unsettled",
      count: 1,
      fixtures: ["Arsenal v Aston Villa"],
    });
  });

  it("assigns a NOT-PLAYING team rather than skipping an entry with none left", () => {
    // Decision 1 in docs/LMS-RULES.md: the old rule refused the whole
    // settlement here ('auto_assign_stuck'); now Ann is given an unused team
    // even though it has no game, and goes out on it.
    //
    // A FOUR-team league, so the two-fixture matchday is COMPLETE — every club
    // has a game. That matters: "no game" only settles as an elimination on a
    // matchday whose fixture list is finished, and this is the shape where the
    // fallback and completeness can both hold at once. (In a real 20-team
    // league all 20 play every matchday, so the fallback never fires at all.)
    const league = TEAMS.slice(0, 4);
    const built = build({
      teams: league,
      fixtures: [
        fixture(10, 1, 2, "played", "home"),
        fixture(11, 3, 4, "played", "draw"),
      ],
      entries: [{ ...entry("e1", "p1"), label: "Ann" }],
      roundNumberById: new Map([
        ["r0", 0],
        ["r1", 1],
      ]),
      // Ann has used three of the four; only team 4 is left to her, and it
      // drew — so she is assigned it and it does not save her.
      picks: [
        { entry_id: "e1", round_id: "r0", team_id: 1 },
        { entry_id: "e1", round_id: "r0", team_id: 2 },
        { entry_id: "e1", round_id: "r0", team_id: 3 },
      ],
    });
    if (!built.ok) throw new Error(built.reason);

    expect(built.plan.auto_assign).toEqual([{ entry_id: "e1", team_id: 4 }]);
    // Settled, not left pending: she is out.
    expect(built.plan.pick_outcomes).toEqual([
      { entry_id: "e1", outcome: "eliminated" },
    ]);
    expect(built.plan.eliminate_entry_ids).toEqual(["e1"]);
  });

  it("refuses when nobody is left to settle", () => {
    const built = build({
      entries: [entry("e1", "p1", "eliminated"), entry("e2", "p2", "eliminated")],
    });
    expect(built).toEqual({ ok: false, reason: "no_active_entries" });
  });

  it("never re-eliminates an entry that was already out", () => {
    const built = build({
      entries: [entry("e1", "p1"), entry("e2", "p2", "eliminated")],
      picks: [{ entry_id: "e1", round_id: "r1", team_id: 1 }],
    });
    if (!built.ok) throw new Error(built.reason);
    // e2's old pick is not re-settled and e2 is not re-stamped with this round.
    expect(built.plan.eliminate_entry_ids).toEqual([]);
    expect(built.plan.expected_active_entry_ids).toEqual(["e1"]);
  });
});

// ---------------------------------------------------------------------------
// The last two standing, across a Saturday and a Sunday
//
// The same four scenarios as tests/lms.test.ts, one level up: what the ORGANISER
// gets when they press Settle. Scenario B is the dangerous one — it must produce
// no plan at all, because a plan is a thing that gets applied.
// ---------------------------------------------------------------------------

describe("two entries left, Saturday and Sunday", () => {
  /** Arsenal beat Aston Villa on the Saturday, so P1 (Aston Villa) is out. */
  const SATURDAY = fixture(10, 1, 2, "played", "home");

  const build2 = (
    sundayStatus: Fixture["status"],
    sundayResult: Fixture["result"] = null
  ) =>
    build({
      // Chelsea v Crystal Palace on the Sunday; P2 has Chelsea.
      fixtures: [SATURDAY, fixture(11, 5, 6, sundayStatus, sundayResult)],
      entries: [entry("e1", "p1"), entry("e2", "p2")],
      picks: [
        { entry_id: "e1", round_id: "r1", team_id: 2 },
        { entry_id: "e2", round_id: "r1", team_id: 5 },
      ],
    });

  it("A — both lose: a rollover plan, and nobody named as winner", () => {
    const built = build2("played", "away"); // Palace win at Chelsea
    if (!built.ok) throw new Error(built.reason);

    expect(built.plan.end).toEqual({
      kind: "rollover",
      participant_id: null,
      winner_entry_ids: [],
    });
    expect(built.plan.eliminate_entry_ids).toEqual(["e1", "e2"]);
    expect(built.provisional).toBe(false);
  });

  it("B — Sunday not played: NO PLAN, named refusal, P2 not crowned", () => {
    const built = build2("scheduled");

    // The strong form of the assertion: not "the plan says rollover", but
    // "there is no plan". Nothing can be applied from a refusal.
    expect(built).toEqual({
      ok: false,
      reason: "unsettled",
      count: 1,
      fixtures: ["Chelsea v Crystal Palace"],
    });
    expect("plan" in built).toBe(false);
  });

  it("B — refuses even though P1's Saturday result is perfectly settleable", () => {
    // The temptation this rules out: settling the half of the round that IS
    // decided. P1 loses on the Saturday whichever way the Sunday goes, so
    // eliminating them looks free — but it would leave P2 the last entry
    // standing, and the very next thing that reads the board would call that a
    // win. Settlement is all-or-nothing for exactly this reason.
    const built = build2("scheduled");
    if (built.ok || built.reason !== "unsettled") {
      throw new Error("expected an unsettled refusal");
    }
    expect(built.count).toBe(1); // only P2 is unsettled — and it still refuses
  });

  it("C — Sunday postponed: a PROVISIONAL plan that crowns nobody", () => {
    const built = build2("postponed");
    if (!built.ok) throw new Error(built.reason);

    expect(built.provisional).toBe(true);
    // The engine knows P2 has won; the plan deliberately does not say so.
    expect(built.end).toEqual({
      kind: "won",
      participant_id: "p2",
      entry_ids: ["e2"],
    });
    expect(built.plan.end).toEqual({
      kind: "provisional",
      participant_id: "p2",
      winner_entry_ids: [], // nothing to stamp as winner
    });
    // The round's real work still happens: P1 is out on a result that stands.
    expect(built.plan.eliminate_entry_ids).toEqual(["e1"]);
  });

  it("D — P2 wins on the Sunday: a plan that crowns them", () => {
    const built = build2("played", "home");
    if (!built.ok) throw new Error(built.reason);

    expect(built.provisional).toBe(false);
    expect(built.plan.end).toEqual({
      kind: "won",
      participant_id: "p2",
      winner_entry_ids: ["e2"],
    });
    expect(built.plan.eliminate_entry_ids).toEqual(["e1"]);
  });
});

// ---------------------------------------------------------------------------
// Buy-back
// ---------------------------------------------------------------------------
//
// Same settlements as above, in a world where round 2 is still to come — so
// every entry knocked out in round 1 has a live window, and the competition's
// end is no longer decided by the round alone.

describe("buildSettlementPlan — buy-back windows", () => {
  const withWindow = (
    overrides: Partial<Parameters<typeof buildSettlementPlan>[0]> = {}
  ) => build({ allRounds: ROUNDS_WINDOW_OPEN, ...overrides });

  it("settles the round but leaves the COMPETITION pending when the field is wiped out", () => {
    const built = withWindow({
      picks: [
        { entry_id: "e1", round_id: "r1", team_id: 3 }, // drew
        { entry_id: "e2", round_id: "r1", team_id: 4 }, // drew
      ],
    });
    if (!built.ok) throw new Error(built.reason);

    // Both go out and the round settles as normal…
    expect(built.plan.eliminate_entry_ids).toEqual(["e1", "e2"]);
    // …but nothing is written to the competition. This is the whole rule.
    expect(built.plan.end.kind).toBe("pending");
    expect(built.plan.end.participant_id).toBeNull();
    expect(built.plan.end.winner_entry_ids).toEqual([]);

    expect(built.state).toEqual({
      kind: "pending_rollover",
      window_closes: WINDOW_OPEN,
      open_entry_ids: ["e1", "e2"],
    });
  });

  it("rolls over for good once that window has shut", () => {
    const built = build({
      picks: [
        { entry_id: "e1", round_id: "r1", team_id: 3 },
        { entry_id: "e2", round_id: "r1", team_id: 4 },
      ],
    });
    if (!built.ok) throw new Error(built.reason);
    expect(built.plan.end.kind).toBe("rollover");
    expect(built.state).toEqual({ kind: "rollover" });
  });

  it("does NOT crown a sole survivor while a competitor can still buy back", () => {
    const built = withWindow();
    if (!built.ok) throw new Error(built.reason);

    expect(built.plan.eliminate_entry_ids).toEqual(["e2"]);
    expect(built.plan.end.kind).toBe("pending");
    // The crown is the thing that must not be written early: once entries carry
    // status 'winner' and the competition is 'won', the buy-back that was still
    // being paid for has nowhere to land.
    expect(built.plan.end.winner_entry_ids).toEqual([]);
    expect(built.state).toMatchObject({
      kind: "pending_win",
      participant_id: "p1",
      entry_ids: ["e1"],
      open_entry_ids: ["e2"],
    });
  });

  it("crowns them once it has shut", () => {
    const built = build();
    if (!built.ok) throw new Error(built.reason);
    expect(built.plan.end.kind).toBe("won");
    expect(built.plan.end.winner_entry_ids).toEqual(["e1"]);
  });

  it("no window for an entry that already used its buy-back", () => {
    const built = withWindow({
      buybacks: [
        {
          id: "b1",
          entry_id: "e2",
          eliminated_round_number: 1,
          for_round_number: 2,
        },
      ],
    });
    if (!built.ok) throw new Error(built.reason);
    // e2 went out in round 1 having already bought back a round-1 elimination,
    // so there is nothing left to wait for and the win stands.
    expect(built.openWindows).toEqual([]);
    expect(built.plan.end.kind).toBe("won");
  });

  it("a round that leaves two people in never pends, window or no window", () => {
    const built = withWindow({
      picks: [
        { entry_id: "e1", round_id: "r1", team_id: 1 },
        { entry_id: "e2", round_id: "r1", team_id: 5 }, // postponed → survives
      ],
    });
    if (!built.ok) throw new Error(built.reason);
    expect(built.plan.end.kind).toBe("continue");
    expect(built.state.kind).toBe("continue");
  });

  it("a provisional win beats a pending window — the round is not settled at all", () => {
    // e2's game is postponed and it is the only thing keeping them in, so the
    // round LOCKS. There is nothing for a window to be pending on yet.
    const built = withWindow({
      entries: [entry("e1", "p1"), entry("e2", "p2"), entry("e3", "p3")],
      picks: [
        { entry_id: "e1", round_id: "r1", team_id: 3 }, // drew — out
        { entry_id: "e2", round_id: "r1", team_id: 5 }, // postponed — survives
        { entry_id: "e3", round_id: "r1", team_id: 4 }, // drew — out
      ],
    });
    if (!built.ok) throw new Error(built.reason);
    expect(built.provisional).toBe(true);
    expect(built.plan.end.kind).toBe("provisional");
  });
});

describe("buildFinalisationPlan", () => {
  const finalise = (
    overrides: Partial<Parameters<typeof buildFinalisationPlan>[0]> = {}
  ) =>
    buildFinalisationPlan({
      competitionId: "c1",
      entries: [
        { ...entry("e1", "p1", "eliminated"), eliminated_round_number: 1 },
        { ...entry("e2", "p2", "eliminated"), eliminated_round_number: 1 },
      ],
      allRounds: ALL_ROUNDS, // window shut
      buybacks: [],
      settledRoundNumber: 1,
      now: NOW,
      ...overrides,
    });

  it("refuses while the window is open, and says when it shuts", () => {
    const outcome = finalise({ allRounds: ROUNDS_WINDOW_OPEN });
    expect(outcome).toMatchObject({
      ok: false,
      reason: "window_open",
      closesAt: WINDOW_OPEN,
    });
  });

  it("confirms the rollover once it has shut", () => {
    const outcome = finalise();
    if (!outcome.ok) throw new Error(outcome.reason);

    expect(outcome.state).toEqual({ kind: "rollover" });
    expect(outcome.plan).toEqual({
      competition_id: "c1",
      // The instant the database is made to prove is in the past — the window
      // that HAS shut, not one that is open.
      window_closes_at: WINDOW_SHUT,
      expected_active_entry_ids: [],
      expected_buyback_ids: [],
      end: { kind: "rollover", participant_id: null, winner_entry_ids: [] },
    });
  });

  it("refuses outright while the competition is still running", () => {
    const outcome = finalise({
      entries: [
        entry("e1", "p1"),
        entry("e2", "p2"),
        { ...entry("e3", "p3", "eliminated"), eliminated_round_number: 1 },
      ],
    });
    expect(outcome).toMatchObject({ ok: false, reason: "not_ended" });
  });

  it("a bought-back entry that has not played yet keeps it running", () => {
    const outcome = finalise({
      // e1 paid to come back for round 2, which has not been settled.
      entries: [
        entry("e1", "p1"),
        { ...entry("e2", "p2", "eliminated"), eliminated_round_number: 1 },
      ],
      buybacks: [
        {
          id: "b1",
          entry_id: "e1",
          eliminated_round_number: 1,
          for_round_number: 2,
        },
      ],
    });
    // NOT a win for p1: they bought back into an empty field and have a round
    // to play. Finalising here would hand them the pot for nothing.
    expect(outcome).toMatchObject({ ok: false, reason: "not_ended" });
  });

  it("crowns the survivor, and fingerprints the buy-backs that exist", () => {
    const outcome = finalise({
      entries: [
        entry("e1", "p1"),
        { ...entry("e2", "p2", "eliminated"), eliminated_round_number: 1 },
      ],
      buybacks: [
        {
          id: "b1",
          entry_id: "e2",
          eliminated_round_number: 1,
          for_round_number: 2,
        },
      ],
      // e2 bought back for round 2 and went out again — settled, so it has
      // played since. Round 2 is where it went out this time.
      settledRoundNumber: 2,
    });
    if (!outcome.ok) throw new Error(outcome.reason);

    expect(outcome.plan.end).toEqual({
      kind: "won",
      participant_id: "p1",
      winner_entry_ids: ["e1"],
    });
    expect(outcome.plan.expected_active_entry_ids).toEqual(["e1"]);
    // The fingerprint that matters: a buy-back landing after this was worked
    // out means the competition is still running, and the transaction refuses.
    expect(outcome.plan.expected_buyback_ids).toEqual(["b1"]);
  });

  it("has nothing to wait for when no window ever existed", () => {
    const outcome = finalise({
      entries: [
        { ...entry("e1", "p1", "eliminated"), eliminated_round_number: 7 },
        { ...entry("e2", "p2", "eliminated"), eliminated_round_number: 7 },
      ],
      settledRoundNumber: 7,
    });
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(outcome.plan.window_closes_at).toBeNull();
  });
});

describe("buildFinalisationPlan — before anything has been settled", () => {
  it("refuses to finalise a competition whose first round is still to come", () => {
    // One entrant, no settled round. resolveEndState alone would call that a
    // win — this is the guard that stops the pot being handed over in the pub
    // on the Thursday before matchday 1.
    const outcome = buildFinalisationPlan({
      competitionId: "c1",
      entries: [entry("e1", "p1")],
      allRounds: ALL_ROUNDS,
      buybacks: [],
      settledRoundNumber: 0,
      now: NOW,
    });
    expect(outcome).toMatchObject({ ok: false, reason: "not_ended" });
  });
});

describe("buildSettlementPlan — a second elimination gets a second window", () => {
  // The offer is per ELIMINATION, not per entry. e2 went out in round 1, bought
  // back, played round 2 and went out again — that is a fresh elimination in
  // round 2, and a fresh window for round 3. Keying "already bought back" on
  // the entry alone would silently cancel it.
  const ROUND_TWO = { id: "r2", round_number: 2, matchday: 1 };

  const build2 = (
    overrides: Partial<Parameters<typeof buildSettlementPlan>[0]> = {}
  ) =>
    buildSettlementPlan({
      competitionId: "c1",
      round: ROUND_TWO,
      roundNumberById: new Map([
        ["r1", 1],
        ["r2", 2],
      ]),
      teams: TEAMS,
      fixtures: [
        fixture(10, 1, 2, "played", "home"), // Arsenal beat Aston Villa
        fixture(11, 3, 4, "played", "draw"), // Bournemouth v Brentford drawn
      ],
      entries: [entry("e1", "p1"), entry("e2", "p2")],
      picks: [
        { entry_id: "e1", round_id: "r2", team_id: 1 },
        { entry_id: "e2", round_id: "r2", team_id: 3 },
      ],
      allRounds: [
        ALL_ROUNDS[0],
        { round_number: 2, deadline: WINDOW_SHUT, status: "settled" },
        { round_number: 3, deadline: WINDOW_OPEN, status: "pending" },
      ],
      buybacks: [
        // e2 already bought its ROUND 1 elimination back.
        {
          id: "b1",
          entry_id: "e2",
          eliminated_round_number: 1,
          for_round_number: 2,
        },
      ],
      now: NOW,
      ...overrides,
    });

  it("opens a round-3 window for an entry that bought back and went out again", () => {
    const built = build2();
    if (!built.ok) throw new Error(built.reason);

    expect(built.plan.eliminate_entry_ids).toEqual(["e2"]);
    expect(built.openWindows).toEqual([
      {
        entry_id: "e2",
        participant_id: "p2",
        for_round_number: 3,
        closes_at: WINDOW_OPEN,
      },
    ]);
    // So the sole survivor is not crowned: e2 can pay to come back a second
    // time, for a second, separate elimination.
    expect(built.plan.end.kind).toBe("pending");
    expect(built.state.kind).toBe("pending_win");
  });

  it("but not a second window for the SAME elimination", () => {
    const built = build2({
      buybacks: [
        {
          id: "b1",
          entry_id: "e2",
          eliminated_round_number: 2,
          for_round_number: 3,
        },
      ],
    });
    if (!built.ok) throw new Error(built.reason);
    expect(built.openWindows).toEqual([]);
    expect(built.plan.end.kind).toBe("won");
  });
});

describe("buildSettlementPlan — a round-4 settlement is final on the spot", () => {
  // The plan, not just the engine: a round-4 wipeout must reach the transaction
  // as end kind 'rollover', not 'pending'. Pending would leave the competition
  // active with nobody in it, waiting on a window that cannot exist, until an
  // organiser noticed and pressed Finalise.
  const ROUND_FOUR = { id: "r4", round_number: 4, matchday: 1 };

  const build4 = (
    overrides: Partial<Parameters<typeof buildSettlementPlan>[0]> = {}
  ) =>
    buildSettlementPlan({
      competitionId: "c1",
      round: ROUND_FOUR,
      roundNumberById: new Map([["r4", 4]]),
      teams: TEAMS,
      fixtures: [
        fixture(10, 1, 2, "played", "home"), // Arsenal beat Aston Villa
        fixture(11, 3, 4, "played", "draw"), // Bournemouth v Brentford drawn
      ],
      entries: [entry("e1", "p1"), entry("e2", "p2")],
      picks: [
        { entry_id: "e1", round_id: "r4", team_id: 3 }, // drew — out
        { entry_id: "e2", round_id: "r4", team_id: 4 }, // drew — out
      ],
      // Round 5 is still to come, with its deadline in the future. Under the
      // rounds-1-to-3 band that buys nobody anything.
      allRounds: [
        { round_number: 4, deadline: WINDOW_SHUT, status: "pending" },
        { round_number: 5, deadline: WINDOW_OPEN, status: "pending" },
      ],
      buybacks: [],
      now: NOW,
      ...overrides,
    });

  it("all eliminated in round 4 → rollover, not pending", () => {
    const built = build4();
    if (!built.ok) throw new Error(built.reason);

    expect(built.openWindows).toEqual([]);
    expect(built.state).toEqual({ kind: "rollover" });
    expect(built.plan.end.kind).toBe("rollover");
  });

  it("a sole survivor of round 4 → won, and crowned in the same transaction", () => {
    const built = build4({
      picks: [
        { entry_id: "e1", round_id: "r4", team_id: 1 }, // Arsenal won — survives
        { entry_id: "e2", round_id: "r4", team_id: 4 }, // drew — out
      ],
    });
    if (!built.ok) throw new Error(built.reason);

    expect(built.openWindows).toEqual([]);
    expect(built.plan.end).toEqual({
      kind: "won",
      participant_id: "p1",
      winner_entry_ids: ["e1"],
    });
  });
});

describe("buildLockPlan", () => {
  const lockInput = (
    overrides: Partial<Parameters<typeof buildLockPlan>[0]> = {}
  ) => ({
    competitionId: "c1",
    round: ROUND,
    roundNumberById: ROUND_NUMBERS,
    teams: TEAMS,
    fixtures: [
      fixture(10, 1, 2, "played", "home"),
      fixture(11, 3, 4, "played", "draw"),
      fixture(12, 5, 6, "postponed"),
    ],
    entries: [entry("e1", "p1"), entry("e2", "p2"), entry("e3", "p3")],
    picks: [] as Parameters<typeof buildLockPlan>[0]["picks"],
    ...overrides,
  });

  it("covers ONLY the entries with no pick", () => {
    const built = buildLockPlan(
      lockInput({
        picks: [
          { entry_id: "e1", round_id: "r1", team_id: 1 },
          { entry_id: "e3", round_id: "r1", team_id: 3 },
        ],
      })
    );

    // e1 and e3 are already in and must not appear at all — not with their own
    // team, not with a drawn one. The database refuses to overwrite a pick
    // anyway, but a plan that names them is a plan that is lying about what it
    // intends to do.
    expect(built.plan.assign.map((a) => a.entry_id)).toEqual(["e2"]);
    expect(built.alreadyPicked).toBe(2);
    expect(built.stuck).toEqual([]);
  });

  it("ignores a pick from a DIFFERENT round", () => {
    const built = buildLockPlan(
      lockInput({
        roundNumberById: new Map([
          ["r0", 0],
          ["r1", 1],
        ]),
        picks: [{ entry_id: "e1", round_id: "r0", team_id: 1 }],
      })
    );
    // e1 picked last week, not this one — it is still a blank for this round.
    expect(built.plan.assign.map((a) => a.entry_id)).toEqual(["e1", "e2", "e3"]);
    expect(built.alreadyPicked).toBe(0);
    // …and last week's team is not drawn again.
    expect(built.plan.assign.find((a) => a.entry_id === "e1")!.team_id).not.toBe(1);
  });

  it("skips entries that are out", () => {
    const built = buildLockPlan(
      lockInput({
        entries: [entry("e1", "p1"), entry("e2", "p2", "eliminated")],
      })
    );
    expect(built.plan.assign.map((a) => a.entry_id)).toEqual(["e1"]);
  });

  it("is CONSTANT — the same plan however many times it is built", () => {
    const first = buildLockPlan(lockInput());
    for (let i = 0; i < 5; i++) {
      expect(buildLockPlan(lockInput()).plan).toEqual(first.plan);
    }
  });

  it("matches what settlement's backstop would assign, entry for entry", () => {
    // The guarantee the rules make: locking and not locking reach the same
    // picks. Same world, two builders, identical answers.
    const locked = buildLockPlan(lockInput());
    const settled = build({ picks: [] });
    if (!settled.ok) throw new Error(settled.reason);

    // The settlement plan covers the two entries it knows about; compare those.
    for (const assignment of settled.plan.auto_assign) {
      expect(locked.plan.assign).toContainEqual(assignment);
    }
  });

  it("reports an undrawable entry instead of failing the whole lock", () => {
    const built = buildLockPlan(
      lockInput({
        teams: [],
        entries: [{ ...entry("e1", "p1"), label: "Ann" }],
      })
    );
    expect(built.stuck).toEqual(["Ann"]);
    expect(built.plan.assign).toEqual([]);
  });
});

describe("buildSettlementPlan — an incomplete matchday REFUSES, never eliminates", () => {
  // The plan builder is where the completeness signal is derived, so this is
  // where a half-loaded matchday has to be stopped. The refusal names the team
  // rather than settling it: a fixture nobody has entered is not a result.
  it("refuses rather than settling a pick whose fixture is missing", () => {
    const built = build({
      // TEAMS has six clubs; only two of them have a game here, so the matchday
      // is plainly unfinished.
      fixtures: [fixture(10, 1, 2, "played", "home")],
      entries: [entry("e1", "p1"), entry("e2", "p2")],
      picks: [
        { entry_id: "e1", round_id: "r1", team_id: 1 }, // Arsenal, played
        { entry_id: "e2", round_id: "r1", team_id: 5 }, // Chelsea, no fixture
      ],
    });

    expect(built).toEqual({
      ok: false,
      reason: "unsettled",
      count: 1,
      fixtures: ["Chelsea (no matchday 1 fixture)"],
    });
  });

  it("settles the no-game pick once every club has a fixture", () => {
    // The same pick, on a matchday that accounts for all six clubs. Now Chelsea
    // having no game is a fact, and e2 is out on it.
    const built = build({
      teams: TEAMS.slice(0, 4),
      fixtures: [
        fixture(10, 1, 2, "played", "home"),
        fixture(11, 3, 4, "played", "draw"),
      ],
      entries: [entry("e1", "p1"), entry("e2", "p2")],
      picks: [
        { entry_id: "e1", round_id: "r1", team_id: 1 },
        { entry_id: "e2", round_id: "r1", team_id: 5 }, // not in this 4-team league
      ],
    });

    if (!built.ok) throw new Error(built.reason);
    expect(built.plan.pick_outcomes).toEqual(
      expect.arrayContaining([{ entry_id: "e2", outcome: "eliminated" }])
    );
  });
});
