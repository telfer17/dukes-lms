import { describe, expect, it } from "vitest";
import { resultsEnteredCount, validateResult } from "@/lib/admin-results";

describe("validateResult", () => {
  it("accepts two valid scores as integers", () => {
    expect(validateResult("3", "0")).toEqual({ ok: true, home: 3, away: 0 });
    expect(validateResult("10", "99")).toEqual({
      ok: true,
      home: 10,
      away: 99,
    });
  });

  it("treats both blank as a clear (null/null)", () => {
    expect(validateResult("", "")).toEqual({ ok: true, home: null, away: null });
    expect(validateResult("  ", " ")).toEqual({
      ok: true,
      home: null,
      away: null,
    });
  });

  it("rejects when only one side is filled", () => {
    expect(validateResult("2", "").ok).toBe(false);
    expect(validateResult("", "1").ok).toBe(false);
  });

  it("rejects non-integers", () => {
    expect(validateResult("1.5", "0").ok).toBe(false);
    expect(validateResult("abc", "2").ok).toBe(false);
  });

  it("rejects out-of-range scores (-1, 100)", () => {
    expect(validateResult("-1", "0").ok).toBe(false);
    expect(validateResult("0", "100").ok).toBe(false);
  });
});

describe("resultsEnteredCount", () => {
  it("counts only matches with both scores non-null", () => {
    expect(
      resultsEnteredCount([
        { home_score: 1, away_score: 0 },
        { home_score: null, away_score: null },
        { home_score: 2, away_score: null },
        { home_score: null, away_score: 3 },
        { home_score: 0, away_score: 0 },
      ])
    ).toBe(2);
  });

  it("is 0 for an empty list", () => {
    expect(resultsEnteredCount([])).toBe(0);
  });
});
