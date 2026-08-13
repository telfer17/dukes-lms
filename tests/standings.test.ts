import { describe, expect, it } from "vitest";
import {
  computePlaces,
  computePodium,
  formatPrize,
  type StandingRow,
} from "@/lib/standings";

// Rows must be pre-sorted points desc, then exact_scores desc (as the
// leaderboard view provides).
const row = (name: string, points: number, exact_scores: number): StandingRow => ({
  name,
  points,
  exact_scores,
});

describe("computePlaces", () => {
  it("uses competition ranking — same points AND exact share a place, next skips", () => {
    const rows = [row("A", 10, 5), row("B", 10, 5), row("C", 8, 3), row("D", 8, 3), row("E", 6, 1)];
    expect(computePlaces(rows)).toEqual([1, 1, 3, 3, 5]);
  });

  it("does NOT tie when points match but exact differs", () => {
    // The real Turner 124/12 vs MacDougall 124/11 case.
    expect(computePlaces([row("T", 124, 12), row("M", 124, 11)])).toEqual([1, 2]);
  });
});

describe("computePodium prizes", () => {
  const prizes = (rows: StandingRow[]) =>
    computePodium(rows).map((e) => ({ name: e.name, place: e.place, prize: e.prize }));

  it("no tie: 1st £160, 2nd £80, 3rd £25 (4th unplaced)", () => {
    expect(prizes([row("A", 10, 5), row("B", 8, 3), row("C", 6, 2), row("D", 4, 1)])).toEqual([
      { name: "A", place: 1, prize: 160 },
      { name: "B", place: 2, prize: 80 },
      { name: "C", place: 3, prize: 25 },
    ]);
  });

  it("2 tie 1st → £120 each, next person is 3rd (£25)", () => {
    expect(prizes([row("A", 10, 5), row("B", 10, 5), row("C", 8, 3)])).toEqual([
      { name: "A", place: 1, prize: 120 },
      { name: "B", place: 1, prize: 120 },
      { name: "C", place: 3, prize: 25 },
    ]);
  });

  it("3 tie 1st → £88.33 each (265/3), no one else places", () => {
    const out = computePodium([row("A", 10, 5), row("B", 10, 5), row("C", 10, 5), row("D", 8, 3)]);
    expect(out.map((e) => [e.name, e.place])).toEqual([
      ["A", 1],
      ["B", 1],
      ["C", 1],
    ]);
    out.forEach((e) => expect(e.prize).toBeCloseTo(265 / 3, 6));
  });

  it("2 tie 2nd → 1st £160, two share £52.50 (4th unplaced)", () => {
    expect(prizes([row("A", 10, 5), row("B", 8, 3), row("C", 8, 3), row("D", 6, 2)])).toEqual([
      { name: "A", place: 1, prize: 160 },
      { name: "B", place: 2, prize: 52.5 },
      { name: "C", place: 2, prize: 52.5 },
    ]);
  });

  it("2 tie 3rd → 1st £160, 2nd £80, two share £12.50", () => {
    expect(
      prizes([row("A", 10, 5), row("B", 8, 3), row("C", 6, 2), row("D", 6, 2), row("E", 4, 1)])
    ).toEqual([
      { name: "A", place: 1, prize: 160 },
      { name: "B", place: 2, prize: 80 },
      { name: "C", place: 3, prize: 12.5 },
      { name: "D", place: 3, prize: 12.5 },
    ]);
  });

  it("only awards people who have scored (points > 0)", () => {
    expect(computePodium([row("A", 0, 0), row("B", 0, 0)])).toEqual([]);
  });
});

describe("formatPrize", () => {
  it("whole pounds have no decimals; fractional shows 2dp", () => {
    expect(formatPrize(160)).toBe("£160");
    expect(formatPrize(120)).toBe("£120");
    expect(formatPrize(52.5)).toBe("£52.50");
    expect(formatPrize(12.5)).toBe("£12.50");
    expect(formatPrize(265 / 3)).toBe("£88.33");
  });
});
