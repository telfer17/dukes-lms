import { describe, expect, it } from "vitest";
import {
  autoAssignTeam,
  availableTeams,
  fixtureForTeam,
  isUnplayed,
  isWinPendingUnplayedFixtures,
  resolveEndState,
  settlePick,
  settleRound,
  teamsPlayingIn,
  usedSinceReset,
  type EntryRecord,
  type Fixture,
  type PickRecord,
  type Team,
} from "@/lib/lms";

// The 20-team pool, deliberately NOT in alphabetical order — auto-assign must
// sort by name itself rather than lean on input order.
const TEAM_NAMES = [
  "Manchester United",
  "Arsenal",
  "Tottenham Hotspur",
  "Aston Villa",
  "Liverpool",
  "Bournemouth",
  "Newcastle United",
  "Brentford",
  "Chelsea",
  "Brighton & Hove Albion",
  "Everton",
  "Coventry City",
  "Fulham",
  "Crystal Palace",
  "Leeds United",
  "Hull City",
  "Manchester City",
  "Ipswich Town",
  "Nottingham Forest",
  "Sunderland",
];

const TEAMS: Team[] = TEAM_NAMES.map((name, i) => ({ id: i + 1, name }));

const byName = (name: string): Team => {
  const team = TEAMS.find((t) => t.name === name);
  if (!team) throw new Error(`no such team in fixture data: ${name}`);
  return team;
};
const idOf = (name: string): number => byName(name).id;

let nextFixtureId = 1;
function fixture(
  home: string,
  away: string,
  overrides: Partial<Fixture> = {}
): Fixture {
  return {
    id: nextFixtureId++,
    matchday: 1,
    home_team_id: idOf(home),
    away_team_id: idOf(away),
    status: "played",
    result: null,
    ...overrides,
  };
}

const entry = (
  id: string,
  participant_id: string,
  status: EntryRecord["status"] = "active"
): EntryRecord => ({ id, participant_id, status });

const pick = (entry_id: string, team: string): PickRecord => ({
  entry_id,
  team_id: idOf(team),
});

// ---------------------------------------------------------------------------
// Rule 1 — settling a pick
// ---------------------------------------------------------------------------

describe("settlePick", () => {
  it("survives when the picked team won at home", () => {
    const f = fixture("Arsenal", "Chelsea", { result: "home" });
    expect(settlePick(idOf("Arsenal"), f)).toBe("survived");
  });

  it("survives when the picked team won away", () => {
    const f = fixture("Arsenal", "Chelsea", { result: "away" });
    expect(settlePick(idOf("Chelsea"), f)).toBe("survived");
  });

  it("eliminates the losing side of the same fixture", () => {
    const f = fixture("Arsenal", "Chelsea", { result: "home" });
    expect(settlePick(idOf("Chelsea"), f)).toBe("eliminated");
  });

  it("eliminates BOTH sides on a draw", () => {
    const f = fixture("Arsenal", "Chelsea", { result: "draw" });
    expect(settlePick(idOf("Arsenal"), f)).toBe("eliminated");
    expect(settlePick(idOf("Chelsea"), f)).toBe("eliminated");
  });

  it("survives a POSTPONED fixture — the pick counts as a win", () => {
    const f = fixture("Arsenal", "Chelsea", {
      status: "postponed",
      result: null,
    });
    expect(settlePick(idOf("Arsenal"), f)).toBe("survived");
    expect(settlePick(idOf("Chelsea"), f)).toBe("survived");
  });

  it("survives an ABANDONED fixture", () => {
    const f = fixture("Arsenal", "Chelsea", {
      status: "abandoned",
      result: null,
    });
    expect(settlePick(idOf("Arsenal"), f)).toBe("survived");
  });

  it("is pending for a fixture that has not been played yet", () => {
    const f = fixture("Arsenal", "Chelsea", {
      status: "scheduled",
      result: null,
    });
    expect(settlePick(idOf("Arsenal"), f)).toBe("pending");
  });

  it("is pending when marked played but the result has not been entered", () => {
    const f = fixture("Arsenal", "Chelsea", { status: "played", result: null });
    expect(settlePick(idOf("Arsenal"), f)).toBe("pending");
  });

  it("is pending when the team has no fixture at all", () => {
    expect(settlePick(idOf("Arsenal"), undefined)).toBe("pending");
  });
});

describe("fixture helpers", () => {
  it("finds a team's fixture from either side", () => {
    const fixtures = [
      fixture("Arsenal", "Chelsea"),
      fixture("Everton", "Fulham"),
    ];
    expect(fixtureForTeam(fixtures, idOf("Chelsea"), 1)?.home_team_id).toBe(
      idOf("Arsenal")
    );
    expect(fixtureForTeam(fixtures, idOf("Everton"), 1)?.away_team_id).toBe(
      idOf("Fulham")
    );
  });

  it("returns undefined for a team not playing", () => {
    expect(
      fixtureForTeam([fixture("Arsenal", "Chelsea")], idOf("Liverpool"), 1)
    ).toBeUndefined();
  });

  it("selects the fixture for the REQUESTED matchday, not the first team match", () => {
    // Arsenal play in both. Season-wide fixture lists are the norm, so matching
    // on team alone would return matchday 1's game when asked for matchday 2.
    const fixtures = [
      fixture("Arsenal", "Chelsea", { matchday: 1 }),
      fixture("Everton", "Arsenal", { matchday: 2 }),
    ];
    expect(fixtureForTeam(fixtures, idOf("Arsenal"), 1)?.matchday).toBe(1);
    expect(fixtureForTeam(fixtures, idOf("Arsenal"), 1)?.away_team_id).toBe(
      idOf("Chelsea")
    );
    expect(fixtureForTeam(fixtures, idOf("Arsenal"), 2)?.matchday).toBe(2);
    expect(fixtureForTeam(fixtures, idOf("Arsenal"), 2)?.home_team_id).toBe(
      idOf("Everton")
    );
  });

  it("returns undefined when the team plays, but not on that matchday", () => {
    const fixtures = [fixture("Arsenal", "Chelsea", { matchday: 1 })];
    expect(fixtureForTeam(fixtures, idOf("Arsenal"), 2)).toBeUndefined();
  });

  it("teamsPlayingIn counts only the requested matchday", () => {
    const fixtures = [
      fixture("Arsenal", "Chelsea", { matchday: 1 }),
      fixture("Everton", "Fulham", { matchday: 2 }),
    ];
    const md1 = teamsPlayingIn(fixtures, 1);
    expect(md1.has(idOf("Arsenal"))).toBe(true);
    expect(md1.has(idOf("Everton"))).toBe(false);
    expect(md1.size).toBe(2);
  });

  it("flags postponed and abandoned as unplayed, played and scheduled as not", () => {
    expect(isUnplayed(fixture("Arsenal", "Chelsea", { status: "postponed" }))).toBe(true);
    expect(isUnplayed(fixture("Arsenal", "Chelsea", { status: "abandoned" }))).toBe(true);
    expect(isUnplayed(fixture("Arsenal", "Chelsea", { status: "played" }))).toBe(false);
    expect(isUnplayed(fixture("Arsenal", "Chelsea", { status: "scheduled" }))).toBe(false);
  });

  it("collects both sides of every fixture as playing", () => {
    const playing = teamsPlayingIn(
      [fixture("Arsenal", "Chelsea"), fixture("Everton", "Fulham")],
      1
    );
    expect([...playing].sort((a, b) => a - b)).toEqual(
      [idOf("Arsenal"), idOf("Chelsea"), idOf("Everton"), idOf("Fulham")].sort(
        (a, b) => a - b
      )
    );
  });
});

// ---------------------------------------------------------------------------
// Rule 2 — no-repeat-team with the 20-team reset
// ---------------------------------------------------------------------------

describe("availableTeams", () => {
  it("offers all 20 to an entry that has picked nothing", () => {
    expect(availableTeams([], TEAMS)).toHaveLength(20);
  });

  it("removes a team the entry has already used", () => {
    const available = availableTeams([idOf("Arsenal")], TEAMS);
    expect(available).toHaveLength(19);
    expect(available.map((t) => t.name)).not.toContain("Arsenal");
  });

  it("counts a team as used from the pick history alone, whatever the outcome", () => {
    // availableTeams reads history, never outcomes — which is exactly why a
    // team picked in a postponed game stays spent. (The postponed -> survived
    // path itself is covered in the settlePick and settleRound suites.)
    const available = availableTeams([idOf("Chelsea")], TEAMS);
    expect(available.map((t) => t.name)).not.toContain("Chelsea");
  });

  it("leaves exactly one team after 19 picks", () => {
    const history = TEAMS.slice(0, 19).map((t) => t.id);
    const available = availableTeams(history, TEAMS);
    expect(available).toHaveLength(1);
    expect(available[0].id).toBe(TEAMS[19].id);
  });

  it("RESETS the pool once all 20 are used", () => {
    const history = TEAMS.map((t) => t.id);
    expect(availableTeams(history, TEAMS)).toHaveLength(20);
  });

  it("makes a repeat legal on pick 21, then unavailable again", () => {
    const fullCycle = TEAMS.map((t) => t.id);
    expect(
      availableTeams(fullCycle, TEAMS).map((t) => t.name)
    ).toContain("Arsenal");

    // Arsenal re-picked as pick 21 — spent again within the new cycle.
    const afterRepick = [...fullCycle, idOf("Arsenal")];
    expect(
      availableTeams(afterRepick, TEAMS).map((t) => t.name)
    ).not.toContain("Arsenal");
    expect(availableTeams(afterRepick, TEAMS)).toHaveLength(19);
  });

  it("resets again after a second full cycle (40 picks)", () => {
    const twoCycles = [...TEAMS, ...TEAMS].map((t) => t.id);
    expect(availableTeams(twoCycles, TEAMS)).toHaveLength(20);
  });

  it("usedSinceReset keeps only the current cycle's tail", () => {
    const history = [...TEAMS.map((t) => t.id), idOf("Arsenal"), idOf("Chelsea")];
    expect(usedSinceReset(history, 20)).toEqual([
      idOf("Arsenal"),
      idOf("Chelsea"),
    ]);
  });
});

// ---------------------------------------------------------------------------
// Rule 3 — auto-assign on a missed pick
// ---------------------------------------------------------------------------

describe("autoAssignTeam", () => {
  it("picks the first alphabetically among teams PLAYING this matchday", () => {
    // Arsenal + Aston Villa are alphabetically first overall but are NOT
    // playing — the answer must be Bournemouth, not Arsenal.
    const fixtures = [
      fixture("Chelsea", "Bournemouth"),
      fixture("Everton", "Fulham"),
    ];
    expect(autoAssignTeam([], TEAMS, fixtures, 1)?.name).toBe("Bournemouth");
  });

  it("sorts by NAME, not by the order teams arrive in", () => {
    // Manchester United sits before Arsenal in TEAMS, and Tottenham before
    // Aston Villa. Anything relying on input order picks the wrong team here.
    expect(
      autoAssignTeam([], TEAMS, [fixture("Manchester United", "Arsenal")], 1)?.name
    ).toBe("Arsenal");
    expect(
      autoAssignTeam([], TEAMS, [fixture("Tottenham Hotspur", "Aston Villa")], 1)
        ?.name
    ).toBe("Aston Villa");
    expect(
      autoAssignTeam([], TEAMS, [
        fixture("Manchester United", "Liverpool"),
        fixture("Newcastle United", "Brentford"),
      ], 1)?.name
    ).toBe("Brentford");
  });

  it("only considers teams playing THIS matchday when a season is passed in", () => {
    // Bournemouth is alphabetically first overall but plays matchday 2.
    const fixtures = [
      fixture("Everton", "Fulham", { matchday: 1 }),
      fixture("Chelsea", "Bournemouth", { matchday: 2 }),
    ];
    expect(autoAssignTeam([], TEAMS, fixtures, 1)?.name).toBe("Everton");
    expect(autoAssignTeam([], TEAMS, fixtures, 2)?.name).toBe("Bournemouth");
  });

  it("breaks a name tie deterministically on team id", () => {
    // Names equal under sensitivity "base" — the lower id must win regardless
    // of the order they arrive in.
    const tied: Team[] = [
      { id: 9, name: "Ryhope Colliery" },
      { id: 4, name: "ryhope colliery" },
    ];
    const md = [
      {
        id: 1,
        matchday: 1,
        home_team_id: 9,
        away_team_id: 4,
        status: "scheduled" as const,
        result: null,
      },
    ];
    expect(autoAssignTeam([], tied, md, 1)?.id).toBe(4);
    expect(autoAssignTeam([], [...tied].reverse(), md, 1)?.id).toBe(4);
  });

  it("skips teams the entry has already used", () => {
    const fixtures = [
      fixture("Chelsea", "Bournemouth"),
      fixture("Everton", "Fulham"),
    ];
    // Bournemouth used → next alphabetical playing team is Chelsea.
    expect(
      autoAssignTeam([idOf("Bournemouth")], TEAMS, fixtures, 1)?.name
    ).toBe("Chelsea");
  });

  it("skips both used AND not-playing teams together", () => {
    const fixtures = [
      fixture("Chelsea", "Bournemouth"),
      fixture("Everton", "Fulham"),
    ];
    expect(
      autoAssignTeam(
        [idOf("Bournemouth"), idOf("Chelsea"), idOf("Everton")],
        TEAMS,
        fixtures
      , 1)?.name
    ).toBe("Fulham");
  });

  it("is INDEPENDENT per entry — different histories, different assignments", () => {
    const fixtures = [
      fixture("Chelsea", "Bournemouth"),
      fixture("Everton", "Fulham"),
    ];
    const entryA = autoAssignTeam([], TEAMS, fixtures, 1);
    const entryB = autoAssignTeam(
      [idOf("Bournemouth"), idOf("Chelsea")],
      TEAMS,
      fixtures,
      1
    );
    expect(entryA?.name).toBe("Bournemouth");
    expect(entryB?.name).toBe("Everton");
    expect(entryA?.id).not.toBe(entryB?.id);
  });

  it("uses the post-reset pool, so a used team is assignable again after 20", () => {
    const fixtures = [fixture("Chelsea", "Bournemouth")];
    const fullCycle = TEAMS.map((t) => t.id);
    expect(autoAssignTeam(fullCycle, TEAMS, fixtures, 1)?.name).toBe("Bournemouth");
  });

  it("returns null when every playing team is already used", () => {
    const fixtures = [fixture("Chelsea", "Bournemouth")];
    expect(
      autoAssignTeam([idOf("Chelsea"), idOf("Bournemouth")], TEAMS, fixtures, 1)
    ).toBeNull();
  });

  it("returns null when there are no fixtures at all", () => {
    expect(autoAssignTeam([], TEAMS, [], 1)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Settling a whole round
// ---------------------------------------------------------------------------

describe("settleRound", () => {
  it("advances winners and eliminates losers and drawers", () => {
    const entries = [entry("e1", "p1"), entry("e2", "p2"), entry("e3", "p3")];
    const fixtures = [
      fixture("Arsenal", "Chelsea", { result: "home" }),
      fixture("Everton", "Fulham", { result: "draw" }),
    ];
    const picks = [
      pick("e1", "Arsenal"), // won
      pick("e2", "Chelsea"), // lost
      pick("e3", "Everton"), // drew
    ];

    const settled = settleRound(entries, picks, fixtures, 1);
    const status = (id: string) =>
      settled.entries.find((e) => e.id === id)?.status;

    expect(status("e1")).toBe("active");
    expect(status("e2")).toBe("eliminated");
    expect(status("e3")).toBe("eliminated");
    expect(settled.outcomes).toEqual([
      { entry_id: "e1", team_id: idOf("Arsenal"), outcome: "survived" },
      { entry_id: "e2", team_id: idOf("Chelsea"), outcome: "eliminated" },
      { entry_id: "e3", team_id: idOf("Everton"), outcome: "eliminated" },
    ]);
  });

  it("survives a postponed pick and records it as survived-via-unplayed", () => {
    const entries = [entry("e1", "p1")];
    const fixtures = [
      fixture("Arsenal", "Chelsea", { status: "postponed", result: null }),
    ];
    const settled = settleRound(entries, [pick("e1", "Arsenal")], fixtures, 1);

    expect(settled.entries[0].status).toBe("active");
    expect(settled.outcomes[0].outcome).toBe("survived");
    expect(settled.survivedViaUnplayed.has("e1")).toBe(true);
  });

  it("does not flag a normal win as survived-via-unplayed", () => {
    const entries = [entry("e1", "p1")];
    const fixtures = [fixture("Arsenal", "Chelsea", { result: "home" })];
    const settled = settleRound(entries, [pick("e1", "Arsenal")], fixtures, 1);
    expect(settled.survivedViaUnplayed.size).toBe(0);
  });

  it("leaves already-eliminated entries untouched", () => {
    const entries = [entry("e1", "p1", "eliminated"), entry("e2", "p2")];
    const fixtures = [fixture("Arsenal", "Chelsea", { result: "home" })];
    const settled = settleRound(entries, [pick("e2", "Arsenal")], fixtures, 1);

    expect(settled.entries[0].status).toBe("eliminated");
    expect(settled.outcomes).toHaveLength(1);
    expect(settled.outcomes[0].entry_id).toBe("e2");
  });

  it("reports an unplayed fixture as unsettled without eliminating anyone", () => {
    const entries = [entry("e1", "p1")];
    const fixtures = [
      fixture("Arsenal", "Chelsea", { status: "scheduled", result: null }),
    ];
    const settled = settleRound(entries, [pick("e1", "Arsenal")], fixtures, 1);

    expect(settled.entries[0].status).toBe("active");
    expect(settled.unsettled).toEqual(["e1"]);
  });

  it("never eliminates an active entry that has no pick at all", () => {
    const entries = [entry("e1", "p1")];
    const settled = settleRound(
      entries,
      [],
      [fixture("Arsenal", "Chelsea", { result: "home" })],
      1
    );
    expect(settled.entries[0].status).toBe("active");
    expect(settled.unsettled).toEqual(["e1"]);
  });

  it("settles against the requested matchday only", () => {
    const entries = [entry("e1", "p1")];
    // Arsenal LOSE on matchday 1 and WIN on matchday 2. Settling matchday 2
    // must not reach back and eliminate them on matchday 1's result.
    const fixtures = [
      fixture("Arsenal", "Chelsea", { matchday: 1, result: "away" }),
      fixture("Everton", "Arsenal", { matchday: 2, result: "away" }),
    ];
    expect(
      settleRound(entries, [pick("e1", "Arsenal")], fixtures, 2).entries[0]
        .status
    ).toBe("active");
    expect(
      settleRound(entries, [pick("e1", "Arsenal")], fixtures, 1).entries[0]
        .status
    ).toBe("eliminated");
  });

  it("does not mutate the entries it was given", () => {
    const entries = [entry("e1", "p1")];
    const fixtures = [fixture("Arsenal", "Chelsea", { result: "away" })];
    settleRound(entries, [pick("e1", "Arsenal")], fixtures, 1);
    expect(entries[0].status).toBe("active");
  });
});

// ---------------------------------------------------------------------------
// Rule 4 — end states
// ---------------------------------------------------------------------------

describe("resolveEndState", () => {
  it("declares a winner when ONE entry is left", () => {
    const end = resolveEndState([
      entry("e1", "p1"),
      entry("e2", "p2", "eliminated"),
    ]);
    expect(end).toEqual({
      kind: "won",
      participant_id: "p1",
      entry_ids: ["e1"],
    });
  });

  it("continues when several entries from different people are left", () => {
    const end = resolveEndState([
      entry("e1", "p1"),
      entry("e2", "p2"),
      entry("e3", "p3", "eliminated"),
    ]);
    expect(end).toEqual({ kind: "continue", entry_ids: ["e1", "e2"] });
  });

  it("rolls over when EVERYONE is eliminated in the same round", () => {
    const end = resolveEndState([
      entry("e1", "p1", "eliminated"),
      entry("e2", "p2", "eliminated"),
    ]);
    expect(end).toEqual({ kind: "rollover" });
  });

  it("rolls over on an empty field", () => {
    expect(resolveEndState([])).toEqual({ kind: "rollover" });
  });

  it("MULTI-ENTRY ENDGAME: last two entries own by one person → that person wins", () => {
    const end = resolveEndState([
      entry("e1", "p1"),
      entry("e2", "p1"), // same person, second entry
      entry("e3", "p2", "eliminated"),
    ]);
    expect(end).toEqual({
      kind: "won",
      participant_id: "p1",
      entry_ids: ["e1", "e2"],
    });
  });

  it("does NOT declare a winner while a rival entry is still alive", () => {
    const end = resolveEndState([
      entry("e1", "p1"),
      entry("e2", "p1"),
      entry("e3", "p2"), // rival still in
    ]);
    expect(end.kind).toBe("continue");
  });

  it("keeps a person alive through their surviving entry when the other goes out", () => {
    const end = resolveEndState([
      entry("e1", "p1", "eliminated"), // one entry out…
      entry("e2", "p1"), // …the other survives
      entry("e3", "p2"),
    ]);
    expect(end).toEqual({ kind: "continue", entry_ids: ["e2", "e3"] });
  });

  it("ignores entries already marked winner when counting the active field", () => {
    const end = resolveEndState([
      entry("e1", "p1", "winner"),
      entry("e2", "p2", "eliminated"),
    ]);
    expect(end).toEqual({ kind: "rollover" });
  });
});

// ---------------------------------------------------------------------------
// "Cannot win outright on a postponed game"
// ---------------------------------------------------------------------------

describe("isWinPendingUnplayedFixtures", () => {
  it("holds the result when the sole survivor got there on a postponed game", () => {
    const end = resolveEndState([entry("e1", "p1"), entry("e2", "p2", "eliminated")]);
    expect(isWinPendingUnplayedFixtures(end, new Set(["e1"]))).toBe(true);
  });

  it("settles normally when the survivor's team actually won", () => {
    const end = resolveEndState([entry("e1", "p1"), entry("e2", "p2", "eliminated")]);
    expect(isWinPendingUnplayedFixtures(end, new Set())).toBe(false);
  });

  it("settles when a multi-entry winner has at least one real win", () => {
    const end = resolveEndState([entry("e1", "p1"), entry("e2", "p1")]);
    // e2 survived a postponement, but e1 won on the pitch — the win stands.
    expect(isWinPendingUnplayedFixtures(end, new Set(["e2"]))).toBe(false);
  });

  it("holds when EVERY surviving entry of the winner was postponed", () => {
    const end = resolveEndState([entry("e1", "p1"), entry("e2", "p1")]);
    expect(isWinPendingUnplayedFixtures(end, new Set(["e1", "e2"]))).toBe(true);
  });

  it("is irrelevant to a continuing competition", () => {
    const end = resolveEndState([entry("e1", "p1"), entry("e2", "p2")]);
    expect(isWinPendingUnplayedFixtures(end, new Set(["e1", "e2"]))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: settle then resolve
// ---------------------------------------------------------------------------

describe("settle then resolve", () => {
  it("plays a round out to a single winner", () => {
    const entries = [entry("e1", "p1"), entry("e2", "p2"), entry("e3", "p3")];
    const fixtures = [
      fixture("Arsenal", "Chelsea", { result: "home" }),
      fixture("Everton", "Fulham", { result: "draw" }),
    ];
    const picks = [
      pick("e1", "Arsenal"),
      pick("e2", "Chelsea"),
      pick("e3", "Fulham"),
    ];

    const settled = settleRound(entries, picks, fixtures, 1);
    expect(resolveEndState(settled.entries)).toEqual({
      kind: "won",
      participant_id: "p1",
      entry_ids: ["e1"],
    });
  });

  it("rolls over when the whole field draws out together", () => {
    const entries = [entry("e1", "p1"), entry("e2", "p2")];
    const fixtures = [fixture("Arsenal", "Chelsea", { result: "draw" })];
    const settled = settleRound(
      entries,
      [pick("e1", "Arsenal"), pick("e2", "Chelsea")],
      fixtures,
      1
    );
    expect(resolveEndState(settled.entries)).toEqual({ kind: "rollover" });
  });

  it("hands a multi-entry player the win when their two entries are last standing", () => {
    const entries = [entry("e1", "p1"), entry("e2", "p1"), entry("e3", "p2")];
    const fixtures = [
      fixture("Arsenal", "Chelsea", { result: "home" }),
      fixture("Everton", "Fulham", { result: "away" }),
      fixture("Liverpool", "Sunderland", { result: "draw" }),
    ];
    const picks = [
      pick("e1", "Arsenal"), // won
      pick("e2", "Fulham"), // won away
      pick("e3", "Liverpool"), // drew → out
    ];

    const settled = settleRound(entries, picks, fixtures, 1);
    const end = resolveEndState(settled.entries);

    expect(end).toEqual({
      kind: "won",
      participant_id: "p1",
      entry_ids: ["e1", "e2"],
    });
    expect(isWinPendingUnplayedFixtures(end, settled.survivedViaUnplayed)).toBe(
      false
    );
  });
});

// ---------------------------------------------------------------------------
// The last two standing, across a Saturday and a Sunday
//
// The owner's scenario, and the one that decides a real competition: two
// entries left, their games on different days. Every branch of it is here at
// engine level, and again at plan level (tests/settlement-plan.test.ts) and
// against a real Postgres (tests/db/settlement.db.test.ts), because the answer
// has to be the same at all three.
//
// P1 always picks Aston Villa, who lose at Arsenal on the Saturday.
// P2 always picks Chelsea, whose Sunday game is what varies.
// ---------------------------------------------------------------------------

describe("two entries left, Saturday and Sunday", () => {
  const ENTRIES = [entry("e1", "p1"), entry("e2", "p2")];
  const PICKS = [pick("e1", "Aston Villa"), pick("e2", "Chelsea")];

  /** Saturday is always the same: Arsenal beat Aston Villa, so P1 is out. */
  const saturday = fixture("Arsenal", "Aston Villa", { result: "home" });

  const sunday = (overrides: Partial<Fixture>) =>
    fixture("Chelsea", "Everton", overrides);

  it("A — both lose: nobody is crowned, the competition rolls over", () => {
    const settled = settleRound(
      ENTRIES,
      PICKS,
      [saturday, sunday({ result: "away" })], // Everton win at Chelsea
      1
    );

    expect(settled.unsettled).toEqual([]);
    expect(settled.entries.map((e) => e.status)).toEqual([
      "eliminated",
      "eliminated",
    ]);
    // The whole point: the survivor of the Saturday is NOT the winner, because
    // there is no survivor of the Sunday either.
    expect(resolveEndState(settled.entries)).toEqual({ kind: "rollover" });
  });

  it("B — Sunday has no result: the round is UNSETTLED, and P2 is not a winner", () => {
    const settled = settleRound(
      ENTRIES,
      PICKS,
      [saturday, sunday({ status: "scheduled", result: null })],
      1
    );

    expect(settled.unsettled).toEqual(["e2"]);
    expect(settled.outcomes).toEqual([
      { entry_id: "e1", team_id: idOf("Aston Villa"), outcome: "eliminated" },
      { entry_id: "e2", team_id: idOf("Chelsea"), outcome: "pending" },
    ]);
    // P2's status is untouched — a fixture with no result eliminates nobody and
    // crowns nobody.
    expect(settled.entries[1].status).toBe("active");
  });

  it("B — and this is exactly why `unsettled` is a REFUSAL, not a detail", () => {
    // resolveEndState only counts who is still active. Handed a half-settled
    // round it will happily report P2 as the winner — P1 is out, P2 is active,
    // one owner left — on a game that has not kicked off.
    //
    // That is not a bug in resolveEndState: it is a pure function answering the
    // question it was asked. It is the reason nothing may call it until
    // `unsettled` is empty, which is enforced in lib/settlement-plan.ts (reason
    // 'unsettled') and again in lms_settle_round (code 'missing_results'). This
    // test pins the hazard so that neither guard can be removed as redundant.
    const settled = settleRound(
      ENTRIES,
      PICKS,
      [saturday, sunday({ status: "scheduled", result: null })],
      1
    );

    expect(settled.unsettled).not.toEqual([]);
    expect(resolveEndState(settled.entries)).toEqual({
      kind: "won",
      participant_id: "p2",
      entry_ids: ["e2"],
    });
  });

  it("C — Sunday postponed: P2 survives, but the win is PROVISIONAL", () => {
    const settled = settleRound(
      ENTRIES,
      PICKS,
      [saturday, sunday({ status: "postponed", result: null })],
      1
    );

    expect(settled.unsettled).toEqual([]);
    expect(settled.survivedViaUnplayed).toEqual(new Set(["e2"]));

    const end = resolveEndState(settled.entries);
    expect(end).toEqual({
      kind: "won",
      participant_id: "p2",
      entry_ids: ["e2"],
    });
    // Decided, but not declarable: the only thing keeping P2 in is a game that
    // was never played, so the round locks instead of settling.
    expect(isWinPendingUnplayedFixtures(end, settled.survivedViaUnplayed)).toBe(
      true
    );
  });

  it("C — once the postponed game is played and lost, it is a rollover", () => {
    // The TRANSITION, not just the destination: settle the same round twice,
    // first with the game still postponed and then with the real result. Only
    // the pair proves the lock is temporary — asserting the rollover alone is
    // indistinguishable from test A, where the game was played all along and no
    // provisional lock ever existed.

    // 1. Postponed. P2 survives on it, so the win is provisional and the round
    //    LOCKS rather than settling.
    const locked = settleRound(
      ENTRIES,
      PICKS,
      [saturday, sunday({ status: "postponed", result: null })],
      1
    );
    const provisionalEnd = resolveEndState(locked.entries);
    expect(provisionalEnd).toEqual({
      kind: "won",
      participant_id: "p2",
      entry_ids: ["e2"],
    });
    expect(
      isWinPendingUnplayedFixtures(provisionalEnd, locked.survivedViaUnplayed)
    ).toBe(true);
    // Nobody has been eliminated by the postponement itself.
    expect(locked.entries[1].status).toBe("active");

    // 2. The game is played and Chelsea lose it. Re-settling the SAME round
    //    from the SAME starting entries — which is what a re-settle does, the
    //    lock having left P2 active — now takes P2 out too.
    const resettled = settleRound(
      locked.entries,
      PICKS,
      [saturday, sunday({ result: "away" })],
      1
    );

    expect(resettled.survivedViaUnplayed.size).toBe(0);
    expect(resettled.entries.map((e) => e.status)).toEqual([
      "eliminated",
      "eliminated",
    ]);

    const finalEnd = resolveEndState(resettled.entries);
    expect(finalEnd).toEqual({ kind: "rollover" });
    // And the provisional flag is gone with it — there is no win left to hold.
    expect(
      isWinPendingUnplayedFixtures(finalEnd, resettled.survivedViaUnplayed)
    ).toBe(false);
  });

  it("D — P2 wins on the Sunday: crowned outright, nothing provisional", () => {
    const settled = settleRound(
      ENTRIES,
      PICKS,
      [saturday, sunday({ result: "home" })],
      1
    );

    expect(settled.unsettled).toEqual([]);
    expect(settled.survivedViaUnplayed.size).toBe(0);

    const end = resolveEndState(settled.entries);
    expect(end).toEqual({
      kind: "won",
      participant_id: "p2",
      entry_ids: ["e2"],
    });
    expect(isWinPendingUnplayedFixtures(end, settled.survivedViaUnplayed)).toBe(
      false
    );
  });
});
