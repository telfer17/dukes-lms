// The two groups, their order, and the words for them.
//
// The leaderboard renders this split in two places at once — the headline
// count and the tables — so it is tested here rather than by eye. The ranking is the part worth pinning: an eliminated row's
// only remaining information is HOW FAR IT GOT, and sorting that column
// alphabetically throws it away.

import { describe, expect, it } from "vitest";
import {
  ELIMINATED_HEADING,
  NO_ELIMINATIONS_LINE,
  NO_OUT_SO_FAR_LINE,
  noStandingLine,
  OUT_SO_FAR_HEADING,
  OUT_SO_FAR_NOTE,
  partitionLive,
  rankEliminated,
  rankStanding,
  splitStandings,
  standingHeading,
} from "@/lib/standings";

type Row = {
  name: string;
  status: "active" | "eliminated" | "winner";
  eliminatedRound: number | null;
};

const alive = (name: string): Row => ({
  name,
  status: "active",
  eliminatedRound: null,
});
const won = (name: string): Row => ({
  name,
  status: "winner",
  eliminatedRound: null,
});
const out = (name: string, round: number | null): Row => ({
  name,
  status: "eliminated",
  eliminatedRound: round,
});

describe("rankStanding", () => {
  it("pins the winner first, then everyone else alphabetically", () => {
    const rows = rankStanding([alive("Cat"), won("Zoe"), alive("Ann")]);
    expect(rows.map((r) => r.name)).toEqual(["Zoe", "Ann", "Cat"]);
  });

  it("keeps a multi-entry winner's entries together at the top", () => {
    // One person, two surviving entries — both belong above the field.
    const rows = rankStanding([alive("Ann"), won("Zoe"), won("Zoe")]);
    expect(rows.map((r) => r.name)).toEqual(["Zoe", "Zoe", "Ann"]);
  });

  it("is plain alphabetical while nobody has won", () => {
    const rows = rankStanding([alive("Cat"), alive("Ann"), alive("Bob")]);
    expect(rows.map((r) => r.name)).toEqual(["Ann", "Bob", "Cat"]);
  });
});

describe("rankEliminated", () => {
  it("ranks by how far they got — latest exit first", () => {
    const rows = rankEliminated([out("Ann", 1), out("Bob", 5), out("Cat", 3)]);
    expect(rows.map((r) => r.name)).toEqual(["Bob", "Cat", "Ann"]);
  });

  it("is alphabetical within the same round", () => {
    const rows = rankEliminated([out("Cat", 4), out("Ann", 4), out("Bob", 4)]);
    expect(rows.map((r) => r.name)).toEqual(["Ann", "Bob", "Cat"]);
  });

  it("puts an unrecorded exit round at the bottom, not the top", () => {
    // Treating "unknown" as round 0 would rank it below a genuine round-one
    // exit — which is a claim the data does not make.
    const rows = rankEliminated([out("Ann", null), out("Bob", 1)]);
    expect(rows.map((r) => r.name)).toEqual(["Bob", "Ann"]);
  });
});

describe("splitStandings", () => {
  it("separates the living from the eliminated and ranks each", () => {
    const { standing, eliminated } = splitStandings([
      out("Ann", 2),
      alive("Cat"),
      won("Zoe"),
      out("Bob", 6),
    ]);

    expect(standing.map((r) => r.name)).toEqual(["Zoe", "Cat"]);
    expect(eliminated.map((r) => r.name)).toEqual(["Bob", "Ann"]);
  });

  it("counts a winner among the living, never among the out", () => {
    const { standing, eliminated } = splitStandings([won("Zoe")]);
    expect(standing).toHaveLength(1);
    expect(eliminated).toHaveLength(0);
  });

  it("handles a wipeout: everyone in the eliminated half", () => {
    const { standing, eliminated } = splitStandings([
      out("Ann", 3),
      out("Bob", 3),
    ]);
    expect(standing).toEqual([]);
    expect(eliminated).toHaveLength(2);
  });

  it("does not mutate its input", () => {
    const rows = [out("Ann", 1), alive("Cat"), won("Zoe")];
    const before = rows.map((r) => r.name);
    splitStandings(rows);
    expect(rows.map((r) => r.name)).toEqual(before);
  });
});

describe("the shared wording", () => {
  it("switches the survivors' heading to past tense once it is over", () => {
    expect(standingHeading(false)).toBe("Still standing");
    expect(standingHeading(true)).toBe("Made it to the end");
  });

  it("says where the pot went when a concluded competition has nobody left", () => {
    // Nobody standing at the end can only be a rollover — a win leaves a winner.
    expect(noStandingLine(true)).toContain("rolls over");
    expect(noStandingLine(false)).not.toContain("rolls over");
  });

  it("names the second group the same way for every screen", () => {
    expect(ELIMINATED_HEADING).toBe("Eliminated");
    expect(NO_ELIMINATIONS_LINE).toBe("No one's out yet.");
  });
});

describe("partitionLive", () => {
  const row = (name: string, liveOut: boolean) => ({
    name,
    status: "active" as const,
    eliminatedRound: null,
    liveOut,
  });

  it("reconciles: still in + out so far = exactly the rows passed in", () => {
    // The property the leaderboard's headline and its two live tables lean
    // on — the "out so far" list IS the subtraction from the top count, not a
    // second computation that could drift from it.
    const rows = [
      row("Ann", false),
      row("Bob", true),
      row("Cat", false),
      row("Dan", true),
    ];
    const { stillIn, outSoFar } = partitionLive(rows);
    expect(stillIn.map((r) => r.name)).toEqual(["Ann", "Cat"]);
    expect(outSoFar.map((r) => r.name)).toEqual(["Bob", "Dan"]);
    expect(stillIn.length + outSoFar.length).toBe(rows.length);
    expect([...stillIn, ...outSoFar].sort((a, b) => a.name.localeCompare(b.name)))
      .toEqual(rows);
  });

  it("preserves the incoming order in both halves — a filter, not a re-rank", () => {
    const rows = [row("Zoe", true), row("Ann", true), row("Mia", false)];
    const { stillIn, outSoFar } = partitionLive(rows);
    expect(outSoFar.map((r) => r.name)).toEqual(["Zoe", "Ann"]);
    expect(stillIn.map((r) => r.name)).toEqual(["Mia"]);
  });

  it("with nobody dropped, everyone is still in", () => {
    const rows = [row("Ann", false), row("Bob", false)];
    const { stillIn, outSoFar } = partitionLive(rows);
    expect(stillIn).toHaveLength(2);
    expect(outSoFar).toHaveLength(0);
  });
});

describe("the live window's words", () => {
  it("never calls the dropped group Eliminated — that word is settlement's", () => {
    expect(OUT_SO_FAR_HEADING).toBe("Out so far");
    expect(OUT_SO_FAR_HEADING).not.toContain(ELIMINATED_HEADING);
    // And the framing says provisional out loud.
    expect(OUT_SO_FAR_NOTE).toBe("Provisional — not settled yet");
    expect(NO_OUT_SO_FAR_LINE).toBe("No one's dropped out yet.");
  });
});
