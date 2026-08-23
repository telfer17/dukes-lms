// The live round view: who the leaderboard shows as still in WHILE results
// land, before the organiser settles anything.
//
// Two properties matter and both are pinned here. The ANSWER: still in =
// active entries minus those whose pick has confirmedly drawn or lost — a
// team that won and a team still to play read the SAME (still in), computed
// through the same settleRound() real settlement uses so the live list can
// never disagree with the settlement that follows. And the POSTURE: this is
// display-only. computeProvisionalView is pure — the last tests prove it
// writes nothing, mutates nothing, and cannot even reach a database, because
// the module has no path to one.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { EntryRecord, Fixture, PickRecord } from "@/lib/lms";
import {
  computeProvisionalView,
  type ProvisionalRound,
} from "@/lib/provisional";

// A four-team league keeps "complete matchday" cheap to stage: two fixtures
// and every club is on the card.
const TEAM_COUNT = 4;

function fixture(
  id: number,
  home: number,
  away: number,
  status: Fixture["status"] = "scheduled",
  result: Fixture["result"] = null,
  matchday = 1
): Fixture {
  return { id, matchday, home_team_id: home, away_team_id: away, status, result };
}

function entry(id: string, status: EntryRecord["status"] = "active"): EntryRecord {
  return { id, participant_id: `person-${id}`, status };
}

function pick(entry_id: string, team_id: number): PickRecord {
  return { entry_id, team_id };
}

const lockedRound: ProvisionalRound = {
  round_number: 3,
  matchday: 1,
  status: "locked",
};

// Home win for 1v2, nothing yet for 3v4 — the mid-afternoon state.
const partialResults = [
  fixture(101, 1, 2, "played", "home"),
  fixture(102, 3, 4),
];

describe("computeProvisionalView — who drops off the live list", () => {
  it("drops only a confirmed loser; a winner and a not-yet-played pick both stay in", () => {
    const view = computeProvisionalView({
      round: lockedRound,
      entries: [entry("winner"), entry("loser"), entry("waiting")],
      picks: [pick("winner", 1), pick("loser", 2), pick("waiting", 3)],
      fixtures: partialResults,
      teamCount: TEAM_COUNT,
    });
    expect(view?.outEntryIds).toEqual(new Set(["loser"]));
    // The property the whole view exists for: an unplayed fixture keeps the
    // entry in, indistinguishable from one whose team already won.
    expect(view?.outEntryIds.has("waiting")).toBe(false);
    expect(view?.outEntryIds.has("winner")).toBe(false);
  });

  it("drops a draw — a draw is never a win", () => {
    const view = computeProvisionalView({
      round: lockedRound,
      entries: [entry("e1")],
      picks: [pick("e1", 1)],
      fixtures: [fixture(101, 1, 2, "played", "draw"), fixture(102, 3, 4)],
      teamCount: TEAM_COUNT,
    });
    expect(view?.outEntryIds).toEqual(new Set(["e1"]));
  });

  it("keeps a postponed game in — the pick counts as a win", () => {
    const view = computeProvisionalView({
      round: lockedRound,
      entries: [entry("e1")],
      picks: [pick("e1", 3)],
      fixtures: [fixture(101, 1, 2), fixture(102, 3, 4, "postponed")],
      teamCount: TEAM_COUNT,
    });
    expect(view?.outEntryIds.size).toBe(0);
  });

  it("keeps an entry with no pick in — a blank is not a failure", () => {
    const view = computeProvisionalView({
      round: lockedRound,
      entries: [entry("no-pick")],
      picks: [],
      fixtures: partialResults,
      teamCount: TEAM_COUNT,
    });
    expect(view?.outEntryIds.size).toBe(0);
  });

  it("drops a pick with no game on a COMPLETE matchday (the auto-assign fallback)", () => {
    // Team 5 has no fixture, but all four league clubs do — "no game" is a
    // fact, not a half-loaded fixture list, so no game means no win.
    const view = computeProvisionalView({
      round: lockedRound,
      entries: [entry("e1")],
      picks: [pick("e1", 5)],
      fixtures: [fixture(101, 1, 2, "played", "home"), fixture(102, 3, 4)],
      teamCount: TEAM_COUNT,
    });
    expect(view?.outEntryIds).toEqual(new Set(["e1"]));
  });

  it("keeps that same pick in while the matchday is INCOMPLETE", () => {
    // Only one of the two fixtures loaded: the missing game could be team
    // 5's. Same safety default as real settlement — never out on a gap.
    const view = computeProvisionalView({
      round: lockedRound,
      entries: [entry("e1")],
      picks: [pick("e1", 5)],
      fixtures: [fixture(101, 1, 2, "played", "home")],
      teamCount: TEAM_COUNT,
    });
    expect(view?.outEntryIds.size).toBe(0);
  });

  it("never lists an eliminated or winner entry — confirmed fates are not re-answered", () => {
    // Both hold team 2, which lost. Only the ACTIVE entry drops off.
    const view = computeProvisionalView({
      round: lockedRound,
      entries: [entry("alive"), entry("gone", "eliminated"), entry("champ", "winner")],
      picks: [pick("alive", 2), pick("gone", 2), pick("champ", 2)],
      fixtures: partialResults,
      teamCount: TEAM_COUNT,
    });
    expect(view?.outEntryIds).toEqual(new Set(["alive"]));
  });
});

describe("computeProvisionalView — the framing numbers", () => {
  it("counts played (and postponed) fixtures against the matchday total", () => {
    const view = computeProvisionalView({
      round: lockedRound,
      entries: [entry("e1")],
      picks: [pick("e1", 1)],
      fixtures: [
        fixture(101, 1, 2, "played", "home"),
        fixture(102, 3, 4, "postponed"), // decided — the rules score it a win
        fixture(103, 5, 6), // still to play
        fixture(999, 1, 3, "played", "away", 2), // another matchday: ignored
      ],
      teamCount: 6,
    });
    expect(view?.played).toBe(2);
    expect(view?.total).toBe(3);
    expect(view?.roundNumber).toBe(3);
  });
});

describe("computeProvisionalView — only in the locked-but-unsettled window", () => {
  it("is null while the round is still pending (picks may be incomplete)", () => {
    const view = computeProvisionalView({
      round: { ...lockedRound, status: "pending" },
      entries: [entry("e1")],
      picks: [pick("e1", 1)],
      fixtures: partialResults,
      teamCount: TEAM_COUNT,
    });
    expect(view).toBeNull();
  });

  it("is null once the round is settled — the confirmed tables take over", () => {
    const view = computeProvisionalView({
      round: { ...lockedRound, status: "settled" },
      entries: [entry("e1")],
      picks: [pick("e1", 1)],
      fixtures: partialResults,
      teamCount: TEAM_COUNT,
    });
    expect(view).toBeNull();
  });
});

// ---- the read-only property ----------------------------------------------

/** Freeze a value and everything reachable from it, so any write throws. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

describe("computeProvisionalView — writes nothing", () => {
  it("never mutates its inputs (all of them frozen — a write would throw)", () => {
    const input = deepFreeze({
      round: { round_number: 3, matchday: 1, status: "locked" as const },
      entries: [entry("winner"), entry("loser"), entry("gone", "eliminated")],
      picks: [pick("winner", 1), pick("loser", 2)],
      fixtures: [fixture(101, 1, 2, "played", "home"), fixture(102, 3, 4)],
      teamCount: TEAM_COUNT,
    });
    const before = JSON.stringify(input);

    const view = computeProvisionalView(input);

    expect(view?.outEntryIds).toEqual(new Set(["loser"]));
    expect(JSON.stringify(input)).toBe(before);
    // The entries came through with their statuses untouched — nobody was
    // eliminated by looking at the board.
    expect(input.entries.map((e) => e.status)).toEqual([
      "active",
      "active",
      "eliminated",
    ]);
  });

  it("cannot reach a database: the module imports the pure engine and nothing else", () => {
    // The structural half of "display-only". lib/provisional.ts must not
    // import the Supabase clients, lib/lms-db, or anything else with I/O in
    // it — with no import there is no code path that could settle, eliminate,
    // crown or write, whatever future edits do inside the functions.
    const source = readFileSync(
      fileURLToPath(new URL("../lib/provisional.ts", import.meta.url)),
      "utf8"
    );
    // Both import forms: `import ... from "x"` and the side-effect
    // `import "x"` (how server-only modules mark themselves).
    const imports = [
      ...source.matchAll(/^import\s+(?:[^;]+?from\s+)?"([^"]+)"/gm),
    ].map((m) => m[1]);
    expect(imports).toEqual(["@/lib/lms"]);
  });
});
