import { describe, expect, it } from "vitest";
import { buildSettlementPlan, type PlanEntry } from "@/lib/settlement-plan";
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

const entry = (
  id: string,
  participant_id: string,
  status: EntryStatus = "active"
): PlanEntry => ({ id, participant_id, status, label: id });

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

  it("skips teams the entry used in earlier rounds when auto-assigning", () => {
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
    // Arsenal is out, so the next playing team alphabetically: Aston Villa.
    expect(built.plan.auto_assign).toEqual([{ entry_id: "e1", team_id: 2 }]);
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
    expect(built).toEqual({ ok: false, reason: "unsettled", count: 1 });
  });

  it("refuses — by name — when an entry has no team left to assign", () => {
    const built = build({
      // Only one fixture, and this entry has used both teams in it.
      fixtures: [fixture(10, 1, 2, "played", "home")],
      entries: [{ ...entry("e1", "p1"), label: "Ann" }],
      roundNumberById: new Map([
        ["r0", 0],
        ["r1", 1],
      ]),
      picks: [
        { entry_id: "e1", round_id: "r0", team_id: 1 },
        { entry_id: "e1", round_id: "r0", team_id: 2 },
      ],
    });
    expect(built).toEqual({
      ok: false,
      reason: "auto_assign_stuck",
      stuck: ["Ann"],
    });
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
