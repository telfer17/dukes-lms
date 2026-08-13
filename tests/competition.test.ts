import { describe, expect, it } from "vitest";
import {
  clubPence,
  collectedPence,
  expectedBuyInPence,
  formatPence,
  potPence,
} from "@/lib/competition";

const paid = (pence: number) => ({ paid: true, amount_paid_pence: pence });
const unpaid = (pence: number) => ({ paid: false, amount_paid_pence: pence });

describe("expectedBuyInPence", () => {
  it("charges a returning player £10 whatever the rollover count", () => {
    expect(expectedBuyInPence(0, false)).toBe(1000);
    expect(expectedBuyInPence(3, false)).toBe(1000);
  });

  it("walks the newcomer ladder from docs/LMS-RULES.md", () => {
    expect(expectedBuyInPence(0, true)).toBe(1000); // first competition
    expect(expectedBuyInPence(1, true)).toBe(2000); // £20
    expect(expectedBuyInPence(2, true)).toBe(3000); // £30
    expect(expectedBuyInPence(3, true)).toBe(4000); // £40
  });
});

describe("collectedPence", () => {
  it("counts only entries actually paid", () => {
    expect(collectedPence([paid(1000), unpaid(1000), paid(2000)])).toBe(3000);
  });

  it("is zero for an empty field", () => {
    expect(collectedPence([])).toBe(0);
  });
});

describe("potPence / clubPence", () => {
  it("splits collected money 50/50", () => {
    const entries = [paid(1000), paid(1000)];
    expect(potPence(0, entries)).toBe(1000);
    expect(clubPence(entries)).toBe(1000);
  });

  it("halves the larger newcomer buy-in the same way", () => {
    const entries = [paid(1000), paid(2000)]; // returning + newcomer after 1 rollover
    expect(potPence(0, entries)).toBe(1500);
    expect(clubPence(entries)).toBe(1500);
  });

  it("adds the carried-in pot on top of the club's half only once", () => {
    const entries = [paid(1000), paid(2000)];
    expect(potPence(12000, entries)).toBe(13500);
    expect(clubPence(entries)).toBe(1500); // carry-in never goes to the club
  });

  it("ignores unpaid entries in both halves", () => {
    expect(potPence(0, [unpaid(1000)])).toBe(0);
    expect(clubPence([unpaid(1000)])).toBe(0);
  });

  it("never invents a penny when an odd amount somehow arrives", () => {
    const entries = [paid(101)];
    expect(potPence(0, entries) + clubPence(entries)).toBe(101);
    expect(potPence(0, entries)).toBe(50);
    expect(clubPence(entries)).toBe(51);
  });
});

describe("formatPence", () => {
  it("drops decimals for whole pounds", () => {
    expect(formatPence(1000)).toBe("£10");
    expect(formatPence(0)).toBe("£0");
    expect(formatPence(13500)).toBe("£135");
  });

  it("shows 2dp for part pounds", () => {
    expect(formatPence(1250)).toBe("£12.50");
    expect(formatPence(101)).toBe("£1.01");
  });
});
