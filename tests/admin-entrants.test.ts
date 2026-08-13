import { describe, expect, it } from "vitest";
import {
  groupEntrants,
  type ParticipantRecord,
} from "@/lib/admin-entrants";

function participant(
  overrides: Partial<ParticipantRecord> & { id: string }
): ParticipantRecord {
  return {
    name: "Test Person",
    phone: "07123456789",
    paid: false,
    club_contact: "Contact",
    ...overrides,
  };
}

describe("groupEntrants", () => {
  it("groups entrants sharing a club_contact together", () => {
    const { groups } = groupEntrants(
      [
        participant({ id: "a", club_contact: "Alice" }),
        participant({ id: "b", club_contact: "Bob" }),
        participant({ id: "c", club_contact: "Alice" }),
      ],
      {}
    );
    expect(groups).toHaveLength(2);
    const alice = groups.find((g) => g.clubContact === "Alice");
    expect(alice?.entrants.map((e) => e.id).sort()).toEqual(["a", "c"]);
  });

  it("computes paidCount and total per group", () => {
    const { groups } = groupEntrants(
      [
        participant({ id: "a", club_contact: "Alice", paid: true }),
        participant({ id: "b", club_contact: "Alice", paid: false }),
        participant({ id: "c", club_contact: "Alice", paid: true }),
      ],
      {}
    );
    expect(groups[0].paidCount).toBe(2);
    expect(groups[0].total).toBe(3);
  });

  it("computes totals with collectedPounds = paid * 10", () => {
    const { totals } = groupEntrants(
      [
        participant({ id: "a", paid: true }),
        participant({ id: "b", paid: true }),
        participant({ id: "c", paid: false }),
      ],
      {}
    );
    expect(totals).toEqual({
      entrants: 3,
      paid: 2,
      unpaid: 1,
      collectedPounds: 20,
    });
  });

  it("defaults predicted to 0 when a participant has no predictions", () => {
    const { groups } = groupEntrants(
      [
        participant({ id: "a", name: "Anna" }),
        participant({ id: "b", name: "Bella" }),
      ],
      { a: 72 }
    );
    const entrants = groups[0].entrants;
    expect(entrants.find((e) => e.id === "a")?.predicted).toBe(72);
    expect(entrants.find((e) => e.id === "b")?.predicted).toBe(0);
  });

  it("sorts groups alphabetically and entrants by name", () => {
    const { groups } = groupEntrants(
      [
        participant({ id: "a", name: "Zoe", club_contact: "Bob" }),
        participant({ id: "b", name: "Amy", club_contact: "Bob" }),
        participant({ id: "c", name: "Cal", club_contact: "Alice" }),
      ],
      {}
    );
    expect(groups.map((g) => g.clubContact)).toEqual(["Alice", "Bob"]);
    expect(groups[1].entrants.map((e) => e.name)).toEqual(["Amy", "Zoe"]);
  });
});
