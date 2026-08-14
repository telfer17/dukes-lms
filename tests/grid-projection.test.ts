// What the public picks grid hands to the browser.
//
// The inputs hold entry ids, participant ids, phone numbers and payment
// amounts. The output must hold none of them: entries.id is the credential for
// /pick/[entryId], and anything on a component's props is serialised into the
// RSC payload whether or not it is rendered. So the whole projected structure
// is stringified and searched for the private values, not just spot-checked
// field by field.

import { describe, expect, it } from "vitest";
import { buildGridRows, relevantRoundCount } from "@/lib/grid-projection";

const ENTRY_UUID = "11111111-2222-3333-4444-555555555555";
const ENTRY_UUID_2 = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const PARTICIPANT_UUID = "99999999-8888-7777-6666-555555555555";
const PHONE = "+447700900123";

const rounds = [
  { id: "r1", round_number: 1, status: "settled" },
  { id: "r2", round_number: 2, status: "settled" },
  { id: "r3", round_number: 3, status: "pending" },
  { id: "r4", round_number: 4, status: "pending" },
];

const teamNameById = new Map([
  [1, "Arsenal"],
  [2, "Chelsea"],
  [3, "Everton"],
]);

function entry(overrides: Partial<Parameters<typeof buildGridRows>[0]["entries"][number]> = {}) {
  return {
    id: ENTRY_UUID,
    status: "active" as const,
    eliminated_round_id: null,
    participant: { name: "Zoe Adams" },
    ...overrides,
  };
}

describe("relevantRoundCount", () => {
  it("counts started rounds", () => {
    expect(relevantRoundCount(rounds, [])).toBe(2);
  });

  it("includes a pending round that already has picks (the one being played)", () => {
    expect(relevantRoundCount(rounds, [3])).toBe(3);
  });

  it("is zero before anything starts", () => {
    expect(
      relevantRoundCount(
        [{ id: "r1", round_number: 1, status: "pending" }],
        []
      )
    ).toBe(0);
  });
});

describe("buildGridRows", () => {
  const picks = [
    {
      entry_id: ENTRY_UUID,
      round_id: "r1",
      team_id: 1,
      auto_assigned: false,
      outcome: "survived" as const,
    },
    {
      entry_id: ENTRY_UUID,
      round_id: "r2",
      team_id: 2,
      auto_assigned: true,
      outcome: "eliminated" as const,
    },
  ];

  it("puts each pick in its round's column", () => {
    const { rows, roundLabels } = buildGridRows({
      rounds,
      entries: [entry()],
      picks,
      teamNameById,
    });
    expect(roundLabels).toEqual(["Week 1", "Week 2"]);
    expect(rows[0].cells).toEqual([
      { team: "Arsenal", outcome: "survived", auto: false },
      { team: "Chelsea", outcome: "eliminated", auto: true },
    ]);
  });

  it("sorts rows alphabetically by name", () => {
    const { rows } = buildGridRows({
      rounds,
      entries: [
        entry({ participant: { name: "Zoe Adams" } }),
        entry({ id: ENTRY_UUID_2, participant: { name: "Alan Brown" } }),
        entry({ id: "e3", participant: { name: "Mo Khan" } }),
      ],
      picks: [],
      teamNameById,
    });
    expect(rows.map((r) => r.name)).toEqual([
      "Alan Brown",
      "Mo Khan",
      "Zoe Adams",
    ]);
  });

  it("keeps two entries of the same person as separate rows", () => {
    // The same NAME, twice — the actual multi-entry case. Rows carry no entry
    // id, so nothing but the row count distinguishes them; collapsing on name
    // would silently drop one person's second entry from the grid.
    const { rows } = buildGridRows({
      rounds,
      entries: [
        entry({ id: ENTRY_UUID, participant: { name: "David Smith" } }),
        entry({ id: ENTRY_UUID_2, participant: { name: "David Smith" } }),
      ],
      picks: [
        { ...picks[0], entry_id: ENTRY_UUID },
        { ...picks[0], entry_id: ENTRY_UUID_2, team_id: 3 },
      ],
      teamNameById,
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.name)).toEqual(["David Smith", "David Smith"]);
    // Each row keeps its OWN entry's pick.
    expect(rows[0].cells[0]?.team).toBe("Arsenal");
    expect(rows[1].cells[0]?.team).toBe("Everton");
  });

  it("resolves the elimination round to its number", () => {
    const { rows } = buildGridRows({
      rounds,
      entries: [entry({ status: "eliminated", eliminated_round_id: "r2" })],
      picks,
      teamNameById,
    });
    expect(rows[0].status).toBe("eliminated");
    expect(rows[0].eliminatedRound).toBe(2);
  });

  it("pads rounds with no pick as null rather than shifting later picks left", () => {
    const { rows } = buildGridRows({
      rounds,
      entries: [entry()],
      picks: [{ ...picks[1], round_id: "r2" }],
      teamNameById,
    });
    expect(rows[0].cells[0]).toBeNull();
    expect(rows[0].cells[1]?.team).toBe("Chelsea");
  });

  it("shows an unrecognised team as a dash rather than an id", () => {
    const { rows } = buildGridRows({
      rounds,
      entries: [entry()],
      picks: [{ ...picks[0], team_id: 999 }],
      teamNameById,
    });
    expect(rows[0].cells[0]?.team).toBe("—");
    expect(JSON.stringify(rows)).not.toContain("999");
  });

  // ---- the security property -------------------------------------------
  it("leaks no entry id, participant id, phone or payment amount", () => {
    const { rows } = buildGridRows({
      rounds,
      entries: [
        {
          id: ENTRY_UUID,
          status: "eliminated",
          eliminated_round_id: "r2",
          participant: { name: "Zoe Adams" },
          // Fields the real EntryWithParticipant carries. They must not survive
          // the projection even when handed straight in.
          ...({
            participant_id: PARTICIPANT_UUID,
            phone: PHONE,
            amount_paid_pence: 1000,
            paid: true,
          } as Record<string, unknown>),
        },
      ],
      picks,
      teamNameById,
    });

    const payload = JSON.stringify(rows);
    for (const secret of [
      ENTRY_UUID,
      PARTICIPANT_UUID,
      PHONE,
      "amount_paid_pence",
      "participant_id",
      "1000",
      "r1",
      "r2",
    ]) {
      expect(payload).not.toContain(secret);
    }
    // Nothing uuid-shaped at all.
    expect(payload).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    );
    // And the row still says what it should.
    expect(rows[0]).toEqual({
      name: "Zoe Adams",
      status: "eliminated",
      eliminatedRound: 2,
      cells: [
        { team: "Arsenal", outcome: "survived", auto: false },
        { team: "Chelsea", outcome: "eliminated", auto: true },
      ],
    });
  });
});
