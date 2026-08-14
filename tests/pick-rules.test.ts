// The rules both pick paths share.
//
// The organiser's /admin/picks entry point exists so a player who texts their
// pick in still gets one. It must NOT become a way round the competition's
// rules — the only thing it may relax is the deadline. These tests pin that:
// every rejection except deadline_passed applies identically with the override
// on and off, checked by running the same attempt both ways.

import { describe, expect, it } from "vitest";
import type { Fixture, Team } from "@/lib/lms";
import {
  selectableTeams,
  validatePick,
  type PickAttempt,
} from "@/lib/pick-rules";

const teams: Team[] = [
  { id: 1, name: "Arsenal" },
  { id: 2, name: "Aston Villa" },
  { id: 3, name: "Bournemouth" },
  { id: 4, name: "Brentford" },
];

const fixtures: Fixture[] = [
  {
    id: 10,
    matchday: 1,
    home_team_id: 1,
    away_team_id: 2,
    status: "scheduled",
    result: null,
  },
  {
    id: 11,
    matchday: 1,
    home_team_id: 3,
    away_team_id: 4,
    status: "scheduled",
    result: null,
  },
  // A later matchday, to prove the matchday scoping holds.
  {
    id: 12,
    matchday: 2,
    home_team_id: 1,
    away_team_id: 3,
    status: "scheduled",
    result: null,
  },
];

const OPEN_ROUND = {
  id: "r1",
  matchday: 1,
  status: "pending" as const,
  deadline: "2026-08-21T19:00:00.000Z",
};

const BEFORE = new Date("2026-08-21T18:00:00.000Z");
const AFTER = new Date("2026-08-21T19:30:00.000Z");

function attempt(over: Partial<PickAttempt> = {}): PickAttempt {
  return {
    entryStatus: "active",
    round: OPEN_ROUND,
    fixtures,
    teams,
    history: [],
    teamId: 1,
    allowAfterDeadline: false,
    now: BEFORE,
    ...over,
  };
}

describe("validatePick — before the deadline", () => {
  it("accepts a team playing this matchday that the entry hasn't used", () => {
    expect(validatePick(attempt())).toEqual({ ok: true, deadlinePassed: false });
  });

  it("refuses an eliminated entry", () => {
    expect(validatePick(attempt({ entryStatus: "eliminated" }))).toMatchObject({
      ok: false,
      code: "entry_not_active",
    });
  });

  it("refuses a round that isn't this competition's", () => {
    expect(validatePick(attempt({ round: undefined }))).toMatchObject({
      ok: false,
      code: "unknown_round",
    });
  });

  it("refuses when no fixtures are loaded", () => {
    expect(validatePick(attempt({ fixtures: [] }))).toMatchObject({
      ok: false,
      code: "no_fixtures",
    });
  });

  it("refuses a team not playing THIS matchday", () => {
    // Team 1 plays matchday 2 as well; picking for a matchday-1 round must not
    // be satisfied by a later fixture.
    const md2Only: Fixture[] = [fixtures[2]];
    expect(validatePick(attempt({ fixtures: md2Only }))).toMatchObject({
      ok: false,
      code: "team_not_playing",
    });
  });

  it("refuses a team this entry has already used", () => {
    expect(validatePick(attempt({ history: [1] }))).toMatchObject({
      ok: false,
      code: "team_used",
    });
  });

  it("allows a team again once the whole pool has been used", () => {
    // Four teams, four picks — the pool resets, so Arsenal is free again.
    expect(validatePick(attempt({ history: [1, 2, 3, 4] }))).toMatchObject({
      ok: true,
    });
  });

  it("does not let the pick being REPLACED block itself", () => {
    // The caller excludes this round's own pick from history; with that done,
    // re-picking the same team is fine.
    expect(validatePick(attempt({ history: [], teamId: 1 }))).toMatchObject({
      ok: true,
    });
  });

  it("refuses once the deadline has passed", () => {
    expect(validatePick(attempt({ now: AFTER }))).toMatchObject({
      ok: false,
      code: "deadline_passed",
    });
  });

  it("treats the deadline instant itself as closed", () => {
    expect(
      validatePick(attempt({ now: new Date(OPEN_ROUND.deadline) }))
    ).toMatchObject({ ok: false, code: "deadline_passed" });
  });
});

describe("validatePick — the organiser override", () => {
  it("allows a pick after the deadline, and says so", () => {
    expect(
      validatePick(attempt({ now: AFTER, allowAfterDeadline: true }))
    ).toEqual({ ok: true, deadlinePassed: true });
  });

  it("still refuses a SETTLED round", () => {
    // The one thing the override must never reach: those eliminations have
    // already been computed and published.
    expect(
      validatePick(
        attempt({
          now: AFTER,
          allowAfterDeadline: true,
          round: { ...OPEN_ROUND, status: "settled" },
        })
      )
    ).toMatchObject({ ok: false, code: "round_settled" });
  });

  it("refuses a settled round even before the deadline", () => {
    expect(
      validatePick(
        attempt({
          allowAfterDeadline: true,
          round: { ...OPEN_ROUND, status: "settled" },
        })
      )
    ).toMatchObject({ ok: false, code: "round_settled" });
  });

  it("works on a locked round (deadline gone, not yet settled)", () => {
    expect(
      validatePick(
        attempt({
          now: AFTER,
          allowAfterDeadline: true,
          round: { ...OPEN_ROUND, status: "locked" },
        })
      )
    ).toMatchObject({ ok: true });
  });
});

// The point of the whole refactor: one rule set, two callers.
describe("the admin path enforces the same rules as the player path", () => {
  const cases: [string, Partial<PickAttempt>][] = [
    ["a used team", { history: [1] }],
    ["a team not playing this matchday", { fixtures: [fixtures[2]] }],
    ["an eliminated entry", { entryStatus: "eliminated" }],
    ["a settled round", { round: { ...OPEN_ROUND, status: "settled" } }],
    ["no fixtures", { fixtures: [] }],
    ["an unknown round", { round: undefined }],
  ];

  it.each(cases)("refuses %s identically with and without the override", (_label, over) => {
    const asPlayer = validatePick(attempt({ ...over, allowAfterDeadline: false }));
    const asAdmin = validatePick(attempt({ ...over, allowAfterDeadline: true }));
    expect(asAdmin).toEqual(asPlayer);
    expect(asAdmin.ok).toBe(false);
  });

  it("differs ONLY on the deadline", () => {
    const over = { now: AFTER };
    expect(
      validatePick(attempt({ ...over, allowAfterDeadline: false }))
    ).toMatchObject({ ok: false, code: "deadline_passed" });
    expect(
      validatePick(attempt({ ...over, allowAfterDeadline: true }))
    ).toMatchObject({ ok: true });
  });

  it("cannot be used to give someone a team they already used, ever", () => {
    for (const now of [BEFORE, AFTER]) {
      expect(
        validatePick(attempt({ now, allowAfterDeadline: true, history: [1] }))
      ).toMatchObject({ ok: false, code: "team_used" });
    }
  });
});

describe("selectableTeams", () => {
  it("offers exactly what validatePick would accept", () => {
    const history = [2]; // Aston Villa used
    const offered = selectableTeams({ fixtures, matchday: 1, teams, history });
    expect(offered.map((t) => t.name)).toEqual([
      "Arsenal",
      "Bournemouth",
      "Brentford",
    ]);
    for (const team of offered) {
      expect(
        validatePick(attempt({ history, teamId: team.id }))
      ).toMatchObject({ ok: true });
    }
  });

  it("excludes teams not playing that matchday", () => {
    const offered = selectableTeams({
      fixtures,
      matchday: 2,
      teams,
      history: [],
    });
    expect(offered.map((t) => t.name)).toEqual(["Arsenal", "Bournemouth"]);
  });

  it("returns the full pool again after a reset", () => {
    const offered = selectableTeams({
      fixtures,
      matchday: 1,
      teams,
      history: [1, 2, 3, 4],
    });
    expect(offered).toHaveLength(4);
  });
});
