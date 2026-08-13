import { describe, expect, it } from "vitest";
import {
  DEFAULT_GRACE_MS,
  isAbandoned,
  isDue,
  isFinished,
  matchFeedToFixtures,
  resultFromScore,
  type DueFixture,
  type FeedMatch,
} from "@/lib/results-feed";

const fixture = (
  id: number,
  home: string,
  away: string,
  kickoff = "2026-08-21T19:00:00.000Z"
): DueFixture =>
  ({ id, matchday: 1, kickoff, home, away }) as DueFixture;

const feedMatch = (
  homeRaw: string,
  awayRaw: string,
  homeGoals: number | null,
  awayGoals: number | null,
  statusShort = "FT"
): FeedMatch => ({
  homeRaw,
  awayRaw,
  homeGoals,
  awayGoals,
  statusShort,
  kickoff: "2026-08-21T19:00:00+00:00",
});

describe("status classification", () => {
  it("treats FT, AET and PEN as finished", () => {
    for (const s of ["FT", "AET", "PEN", "ft"]) expect(isFinished(s)).toBe(true);
  });

  it("does not treat an in-play or upcoming match as finished", () => {
    for (const s of ["NS", "1H", "HT", "2H", "ET", "LIVE"]) {
      expect(isFinished(s)).toBe(false);
    }
  });

  it("recognises called-off statuses", () => {
    for (const s of ["PST", "CANC", "ABD", "SUSP", "AWD", "WO", "INT"]) {
      expect(isAbandoned(s)).toBe(true);
    }
    expect(isAbandoned("FT")).toBe(false);
  });
});

describe("isDue", () => {
  const kickoff = "2026-08-21T19:00:00.000Z";
  const at = (offsetMs: number) => Date.parse(kickoff) + offsetMs;

  it("is not due at kick-off, nor an hour in", () => {
    expect(isDue({ kickoff }, at(0))).toBe(false);
    expect(isDue({ kickoff }, at(60 * 60 * 1000))).toBe(false);
  });

  it("is due once the grace period has passed", () => {
    expect(isDue({ kickoff }, at(DEFAULT_GRACE_MS))).toBe(true);
    expect(isDue({ kickoff }, at(DEFAULT_GRACE_MS + 1))).toBe(true);
  });

  it("is not due one millisecond early", () => {
    expect(isDue({ kickoff }, at(DEFAULT_GRACE_MS - 1))).toBe(false);
  });
});

describe("resultFromScore", () => {
  it("reads a home win, an away win and a draw", () => {
    expect(resultFromScore(2, 0)).toBe("home");
    expect(resultFromScore(0, 2)).toBe("away");
    expect(resultFromScore(1, 1)).toBe("draw");
    expect(resultFromScore(0, 0)).toBe("draw");
  });
});

describe("matchFeedToFixtures", () => {
  it("fills a finished match, resolving the feed's short names", () => {
    const out = matchFeedToFixtures(
      [fixture(1, "Arsenal", "Coventry City")],
      [feedMatch("Arsenal", "Coventry", 3, 1)]
    );
    expect(out.updates).toEqual([
      { fixtureId: 1, home_score: 3, away_score: 1, result: "home" },
    ]);
    expect(out.notReported).toEqual([]);
    expect(out.unmapped).toEqual([]);
  });

  it("records a draw and an away win correctly", () => {
    const out = matchFeedToFixtures(
      [fixture(1, "Arsenal", "Chelsea"), fixture(2, "Everton", "Liverpool")],
      [feedMatch("Arsenal", "Chelsea", 2, 2), feedMatch("Everton", "Liverpool", 0, 1)]
    );
    expect(out.updates).toEqual([
      { fixtureId: 1, home_score: 2, away_score: 2, result: "draw" },
      { fixtureId: 2, home_score: 0, away_score: 1, result: "away" },
    ]);
  });

  it("does NOT fill a match that is still in play", () => {
    const out = matchFeedToFixtures(
      [fixture(1, "Arsenal", "Chelsea")],
      [feedMatch("Arsenal", "Chelsea", 1, 0, "2H")]
    );
    expect(out.updates).toEqual([]);
    expect(out.notReported).toEqual([1]);
  });

  it("does NOT fill a finished match with missing goals", () => {
    const out = matchFeedToFixtures(
      [fixture(1, "Arsenal", "Chelsea")],
      [feedMatch("Arsenal", "Chelsea", null, null, "FT")]
    );
    expect(out.updates).toEqual([]);
    expect(out.notReported).toEqual([1]);
  });

  it("reports a postponement instead of writing one", () => {
    // The rules make a postponed pick a WIN, which is an organiser's call —
    // the cron surfaces it and leaves the fixture alone.
    const out = matchFeedToFixtures(
      [fixture(1, "Arsenal", "Chelsea")],
      [feedMatch("Arsenal", "Chelsea", null, null, "PST")]
    );
    expect(out.updates).toEqual([]);
    expect(out.abandoned).toEqual([{ fixtureId: 1, statusShort: "PST" }]);
    expect(out.notReported).toEqual([]);
  });

  it("leaves a fixture alone when the feed has not reported it", () => {
    const out = matchFeedToFixtures([fixture(1, "Arsenal", "Chelsea")], []);
    expect(out.updates).toEqual([]);
    expect(out.notReported).toEqual([1]);
  });

  it("never pairs a fixture with the reverse tie", () => {
    // Arsenal v Chelsea and Chelsea v Arsenal are different matchdays.
    const out = matchFeedToFixtures(
      [fixture(1, "Arsenal", "Chelsea")],
      [feedMatch("Chelsea", "Arsenal", 4, 0)]
    );
    expect(out.updates).toEqual([]);
    expect(out.notReported).toEqual([1]);
  });

  it("ignores feed clubs we do not track when nothing of ours is missing", () => {
    // The feed covers the whole league; other clubs are not our problem so
    // long as every fixture we asked about got reported.
    const out = matchFeedToFixtures(
      [fixture(1, "Arsenal", "Chelsea")],
      [feedMatch("Arsenal", "Chelsea", 1, 0), feedMatch("Wolves", "Leicester", 2, 2)]
    );
    expect(out.updates).toHaveLength(1);
    expect(out.unmapped).toEqual([]);
  });

  it("reports unmapped names when one of OUR fixtures went unreported", () => {
    const out = matchFeedToFixtures(
      [fixture(1, "Arsenal", "Chelsea")],
      [feedMatch("Arsenal FC XI", "Chelsea", 1, 0)]
    );
    expect(out.updates).toEqual([]);
    expect(out.notReported).toEqual([1]);
    expect(out.unmapped).toContain("Arsenal FC XI");
  });

  it("fills what it can and reports the rest — never all-or-nothing guessing", () => {
    const out = matchFeedToFixtures(
      [
        fixture(1, "Arsenal", "Chelsea"),
        fixture(2, "Everton", "Fulham"),
        fixture(3, "Hull City", "Leeds United"),
      ],
      [
        feedMatch("Arsenal", "Chelsea", 1, 0),
        feedMatch("Everton", "Fulham", null, null, "PST"),
        // fixture 3 simply absent
      ]
    );
    expect(out.updates.map((u) => u.fixtureId)).toEqual([1]);
    expect(out.abandoned.map((a) => a.fixtureId)).toEqual([2]);
    expect(out.notReported).toEqual([3]);
  });

  it("handles an empty due list", () => {
    const out = matchFeedToFixtures([], [feedMatch("Arsenal", "Chelsea", 1, 0)]);
    expect(out).toEqual({
      updates: [],
      unmapped: [],
      notReported: [],
      abandoned: [],
    });
  });
});
