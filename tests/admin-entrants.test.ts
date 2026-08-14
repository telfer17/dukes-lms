import { describe, expect, it } from "vitest";
import {
  findDuplicateEntrant,
  groupEntries,
  type EntryRecord,
  type ExistingEntrant,
} from "@/lib/admin-entrants";

function entry(
  overrides: Partial<EntryRecord> & { id: string }
): EntryRecord {
  return {
    name: "Test Person",
    phone: "07123456789",
    club_contact: "Contact",
    paid: false,
    amount_paid_pence: 0,
    is_newcomer: false,
    status: "active",
    ...overrides,
  };
}

describe("groupEntries", () => {
  it("groups entries sharing a club_contact together", () => {
    const { groups } = groupEntries(
      [
        entry({ id: "a", club_contact: "Alice" }),
        entry({ id: "b", club_contact: "Bob" }),
        entry({ id: "c", club_contact: "Alice" }),
      ],
      0
    );
    expect(groups).toHaveLength(2);
    expect(
      groups.find((g) => g.clubContact === "Alice")?.entries.map((e) => e.id).sort()
    ).toEqual(["a", "c"]);
  });

  it("keeps BOTH entries when one person holds two", () => {
    const { groups, totals } = groupEntries(
      [
        entry({ id: "a", name: "David Smith" }),
        entry({ id: "b", name: "David Smith 2" }),
      ],
      0
    );
    expect(totals.entries).toBe(2);
    expect(groups[0].entries).toHaveLength(2);
  });

  it("computes paidCount and total per group", () => {
    const { groups } = groupEntries(
      [
        entry({ id: "a", paid: true, amount_paid_pence: 1000 }),
        entry({ id: "b" }),
        entry({ id: "c", paid: true, amount_paid_pence: 1000 }),
      ],
      0
    );
    expect(groups[0].paidCount).toBe(2);
    expect(groups[0].total).toBe(3);
  });

  it("counts active entries in the totals", () => {
    const { totals } = groupEntries(
      [
        entry({ id: "a" }),
        entry({ id: "b", status: "eliminated" }),
        entry({ id: "c", status: "winner" }),
      ],
      0
    );
    expect(totals).toEqual({ entries: 3, paid: 0, unpaid: 3, active: 1 });
  });

  it("expects the newcomer ladder amount after a rollover", () => {
    const { groups } = groupEntries(
      [
        entry({ id: "a", name: "Returning", is_newcomer: false }),
        entry({ id: "b", name: "Newcomer", is_newcomer: true }),
      ],
      1 // one prior rollover -> newcomer pays £20
    );
    const [newcomer, returning] = groups[0].entries;
    expect(newcomer.name).toBe("Newcomer");
    expect(newcomer.expected_pence).toBe(2000);
    expect(returning.expected_pence).toBe(1000);
  });

  it("flags a paid entry whose amount does not match the ladder", () => {
    const { groups } = groupEntries(
      [
        entry({ id: "a", name: "Short", paid: true, amount_paid_pence: 500 }),
        entry({ id: "b", name: "Right", paid: true, amount_paid_pence: 1000 }),
        entry({ id: "c", name: "Unpaid", paid: false, amount_paid_pence: 0 }),
      ],
      0
    );
    const byName = new Map(groups[0].entries.map((e) => [e.name, e]));
    expect(byName.get("Short")?.amount_mismatch).toBe(true);
    expect(byName.get("Right")?.amount_mismatch).toBe(false);
    // An unpaid entry is not a mismatch — it just hasn't been paid yet.
    expect(byName.get("Unpaid")?.amount_mismatch).toBe(false);
  });

  it("sorts groups alphabetically and entries by name", () => {
    const { groups } = groupEntries(
      [
        entry({ id: "a", name: "Zoe", club_contact: "Bob" }),
        entry({ id: "b", name: "Amy", club_contact: "Bob" }),
        entry({ id: "c", name: "Cal", club_contact: "Alice" }),
      ],
      0
    );
    expect(groups.map((g) => g.clubContact)).toEqual(["Alice", "Bob"]);
    expect(groups[1].entries.map((e) => e.name)).toEqual(["Amy", "Zoe"]);
  });
});

describe("findDuplicateEntrant", () => {
  const existing: ExistingEntrant[] = [
    { participantId: "p1", name: "David Smith", phone: "07123456789" },
    { participantId: "p2", name: "Jo Bloggs", phone: null },
  ];

  it("finds nothing for a genuinely new person", () => {
    expect(
      findDuplicateEntrant(
        { participantId: null, name: "Ann Other", phone: "07999999999" },
        existing
      )
    ).toBeNull();
  });

  it("matches a name regardless of case or surrounding space", () => {
    expect(
      findDuplicateEntrant(
        { participantId: null, name: "  david smith ", phone: null },
        existing
      )
    ).toMatchObject({ participantId: "p1" });
  });

  it("matches a phone number written a different way", () => {
    expect(
      findDuplicateEntrant(
        { participantId: null, name: "Someone Else", phone: "+44 7123 456789" },
        existing
      )
    ).toMatchObject({ participantId: "p1" });
  });

  it("matches the person picked from the existing-people list", () => {
    expect(
      findDuplicateEntrant(
        { participantId: "p2", name: "", phone: null },
        existing
      )
    ).toMatchObject({ participantId: "p2" });
  });

  it("does not treat two missing phone numbers as the same number", () => {
    expect(
      findDuplicateEntrant(
        { participantId: null, name: "Ann Other", phone: null },
        existing
      )
    ).toBeNull();
    expect(
      findDuplicateEntrant(
        { participantId: null, name: "Ann Other", phone: "" },
        [{ participantId: "p3", name: "Someone", phone: "" }]
      )
    ).toBeNull();
  });

  it("does not treat two blank names as the same person", () => {
    expect(
      findDuplicateEntrant(
        { participantId: null, name: "", phone: "07000000000" },
        [{ participantId: "p3", name: "", phone: null }]
      )
    ).toBeNull();
  });

  it("finds nothing in an empty competition", () => {
    expect(
      findDuplicateEntrant(
        { participantId: "p1", name: "David Smith", phone: "07123456789" },
        []
      )
    ).toBeNull();
  });
});
