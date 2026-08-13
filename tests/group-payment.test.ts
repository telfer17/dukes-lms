import { describe, expect, it } from "vitest";
import { partitionByNewcomer } from "@/lib/group-payment";
import { expectedBuyInPence } from "@/lib/competition";

describe("partitionByNewcomer", () => {
  it("splits a mixed group so each half can be billed its own amount", () => {
    const { newcomerIds, returningIds } = partitionByNewcomer([
      { id: "a", is_newcomer: false },
      { id: "b", is_newcomer: true },
      { id: "c", is_newcomer: false },
      { id: "d", is_newcomer: true },
    ]);
    expect(newcomerIds).toEqual(["b", "d"]);
    expect(returningIds).toEqual(["a", "c"]);
  });

  it("never drops or duplicates a row", () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({
      id: `e${i}`,
      is_newcomer: i % 3 === 0,
    }));
    const { newcomerIds, returningIds } = partitionByNewcomer(rows);
    expect(newcomerIds.length + returningIds.length).toBe(rows.length);
    expect(new Set([...newcomerIds, ...returningIds]).size).toBe(rows.length);
  });

  it("yields empty halves for an empty group", () => {
    expect(partitionByNewcomer([])).toEqual({
      newcomerIds: [],
      returningIds: [],
    });
  });

  it("handles an all-newcomer and an all-returning group", () => {
    expect(partitionByNewcomer([{ id: "a", is_newcomer: true }])).toEqual({
      newcomerIds: ["a"],
      returningIds: [],
    });
    expect(partitionByNewcomer([{ id: "a", is_newcomer: false }])).toEqual({
      newcomerIds: [],
      returningIds: ["a"],
    });
  });

  it("pairs with the ladder so a bulk update bills each half correctly", () => {
    // After one rollover: newcomers owe £20, returning players £10. Mixing the
    // halves would overcharge or undercharge a whole group at once.
    const { newcomerIds, returningIds } = partitionByNewcomer([
      { id: "new", is_newcomer: true },
      { id: "old", is_newcomer: false },
    ]);
    expect(newcomerIds).toHaveLength(1);
    expect(returningIds).toHaveLength(1);
    expect(expectedBuyInPence(1, true)).toBe(2000);
    expect(expectedBuyInPence(1, false)).toBe(1000);
  });
});
