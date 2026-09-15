import { describe, expect, it } from "vitest";
import { reopenableRound, reopenVerdict } from "@/lib/reopen-round";

// The latest-round rule for reopening, in the pure form the results page and
// the action share. The database re-checks the same rule inside the
// transaction (tests/db/reopen-round.db.test.ts); this pins the copy the UI
// uses to decide whether to offer the button at all.

type R = { id: string; round_number: number; status: "pending" | "locked" | "settled" };
const r = (n: number, status: R["status"]): R => ({ id: `r${n}`, round_number: n, status });

describe("reopenableRound", () => {
  it("is null when nothing has been settled", () => {
    expect(reopenableRound([])).toBeNull();
    expect(reopenableRound([r(1, "pending"), r(2, "pending")])).toBeNull();
  });

  it("is the only settled round", () => {
    expect(reopenableRound([r(1, "settled"), r(2, "pending")])).toEqual(r(1, "settled"));
  });

  it("is the HIGHEST settled round, regardless of array order", () => {
    expect(reopenableRound([r(3, "settled"), r(1, "settled"), r(2, "settled"), r(4, "pending")]))
      .toEqual(r(3, "settled"));
  });

  it("is null when the latest touched round is a provisional lock", () => {
    // Round 2 is locked: its eliminations are applied. Round 1 is therefore
    // not the latest, and round 2 has nothing settled to reverse.
    expect(reopenableRound([r(1, "settled"), r(2, "locked"), r(3, "pending")])).toBeNull();
  });

  it("is the settled round even when every later round is pending", () => {
    expect(reopenableRound([r(1, "settled"), r(2, "pending"), r(3, "pending")]))
      .toEqual(r(1, "settled"));
  });
});

describe("reopenVerdict", () => {
  const rounds = [r(1, "settled"), r(2, "settled"), r(3, "pending")];

  it("allows the latest settled round", () => {
    expect(reopenVerdict(rounds, "r2")).toEqual({ ok: true, round: r(2, "settled") });
  });

  it("refuses an earlier settled round and names the later one", () => {
    expect(reopenVerdict(rounds, "r1")).toEqual({
      ok: false,
      reason: "not_latest",
      round: r(1, "settled"),
      later: r(2, "settled"),
    });
  });

  it("names a later provisional lock as the blocker", () => {
    expect(reopenVerdict([r(1, "settled"), r(2, "locked")], "r1")).toMatchObject({
      ok: false,
      reason: "not_latest",
      later: r(2, "locked"),
    });
  });

  it("refuses a pending or locked round as not settled", () => {
    expect(reopenVerdict(rounds, "r3")).toEqual({
      ok: false,
      reason: "not_settled",
      round: r(3, "pending"),
    });
    expect(reopenVerdict([r(1, "locked")], "r1")).toMatchObject({
      ok: false,
      reason: "not_settled",
    });
  });

  it("refuses an unknown round", () => {
    expect(reopenVerdict(rounds, "nope")).toEqual({ ok: false, reason: "round_not_found" });
  });

  it("agrees with reopenableRound", () => {
    const sets: R[][] = [
      [],
      [r(1, "settled")],
      [r(1, "settled"), r(2, "settled"), r(3, "pending")],
      [r(1, "settled"), r(2, "locked")],
      [r(2, "settled"), r(1, "settled")],
    ];
    for (const rs of sets) {
      const pick = reopenableRound(rs);
      for (const x of rs) {
        expect(reopenVerdict(rs, x.id).ok).toBe(pick?.id === x.id);
      }
    }
  });
});
