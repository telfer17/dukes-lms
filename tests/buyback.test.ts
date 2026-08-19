import { describe, expect, it } from "vitest";
import {
  availableTeams,
  buybackEligibility,
  BUYBACK_MAX_ELIMINATED_ROUND,
  openBuybackWindows,
  resolveCompetitionState,
  settleRound,
  type BuybackCandidate,
  type BuybackRound,
  type EntryRecord,
  type Fixture,
  type OpenBuybackWindow,
  type EntryStatus,
  type Team,
} from "@/lib/lms";
import {
  buybackOffers,
  planBuybacks,
  type BuybackEntry,
  type BuybackRoundRow,
} from "@/lib/buyback";

// docs/LMS-RULES.md § Buy-back, clause by clause.
//
// Time is pinned to a fixed NOW throughout: every deadline below is written
// relative to it, so no test can pass or fail because of when it was run.

const NOW = new Date("2026-01-10T12:00:00.000Z");
const LATER = "2026-01-11T12:00:00.000Z"; // window open
const EARLIER = "2026-01-09T12:00:00.000Z"; // window shut

function round(
  round_number: number,
  overrides: Partial<BuybackRound> = {}
): BuybackRound {
  return {
    round_number,
    deadline: LATER,
    status: "pending",
    ...overrides,
  };
}

function candidate(overrides: Partial<BuybackCandidate> = {}): BuybackCandidate {
  return {
    entry_id: "e1",
    participant_id: "p1",
    status: "eliminated",
    eliminated_round_number: 2,
    bought_back: false,
    ...overrides,
  };
}

function entry(
  id: string,
  participant_id: string,
  status: EntryRecord["status"]
): EntryRecord {
  return { id, participant_id, status };
}

function window(
  overrides: Partial<OpenBuybackWindow> = {}
): OpenBuybackWindow {
  return {
    entry_id: "gone",
    participant_id: "p9",
    for_round_number: 3,
    closes_at: LATER,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

describe("buybackEligibility — which round you went out in", () => {
  it("out in round 1 can buy back for round 2", () => {
    const verdict = buybackEligibility(
      candidate({ eliminated_round_number: 1 }),
      round(2),
      NOW
    );
    expect(verdict).toEqual({
      eligible: true,
      for_round_number: 2,
      closes_at: LATER,
    });
  });

  it("out in round 2 can buy back for round 3", () => {
    const verdict = buybackEligibility(
      candidate({ eliminated_round_number: 2 }),
      round(3),
      NOW
    );
    expect(verdict.eligible).toBe(true);
  });

  // The boundary the rule is written around: round 3 is the LAST elimination
  // that can ever buy back, and it comes back for round 4.
  it("out in round 3 can buy back for round 4 — the last one that can", () => {
    const verdict = buybackEligibility(
      candidate({ eliminated_round_number: 3 }),
      round(4),
      NOW
    );
    expect(verdict).toEqual({
      eligible: true,
      for_round_number: 4,
      closes_at: LATER,
    });
  });

  it("out in round 4 CANNOT buy back", () => {
    const verdict = buybackEligibility(
      candidate({ eliminated_round_number: 4 }),
      round(5),
      NOW
    );
    expect(verdict).toMatchObject({
      eligible: false,
      code: "eliminated_too_late",
    });
  });

  it("out in round 5 and later cannot either", () => {
    for (const out of [5, 6, 12, 38]) {
      expect(
        buybackEligibility(
          candidate({ eliminated_round_number: out }),
          round(out + 1),
          NOW
        )
      ).toMatchObject({ eligible: false, code: "eliminated_too_late" });
    }
  });

  it("the boundary is exactly BUYBACK_MAX_ELIMINATED_ROUND", () => {
    expect(BUYBACK_MAX_ELIMINATED_ROUND).toBe(3);
    const max = BUYBACK_MAX_ELIMINATED_ROUND;
    expect(
      buybackEligibility(
        candidate({ eliminated_round_number: max }),
        round(max + 1),
        NOW
      ).eligible
    ).toBe(true);
    expect(
      buybackEligibility(
        candidate({ eliminated_round_number: max + 1 }),
        round(max + 2),
        NOW
      ).eligible
    ).toBe(false);
  });
});

describe("buybackEligibility — the immediately following round only", () => {
  it("refuses a round that is not the one after the elimination", () => {
    const verdict = buybackEligibility(
      candidate({ eliminated_round_number: 1 }),
      round(3),
      NOW
    );
    expect(verdict).toMatchObject({ eligible: false, code: "wrong_round" });
  });

  // "Out in R1, sit out R2, rejoin R3" — explicitly NOT allowed. The offer is a
  // single time-boxed window, not a standing option.
  it("cannot skip a round and rejoin later", () => {
    const outInOne = candidate({ eliminated_round_number: 1 });
    // R2 was their window and it has been and gone.
    expect(
      buybackEligibility(outInOne, round(2, { deadline: EARLIER }), NOW)
    ).toMatchObject({ eligible: false, code: "window_closed" });
    // R3 is not their window at all, open or not.
    expect(buybackEligibility(outInOne, round(3), NOW)).toMatchObject({
      eligible: false,
      code: "wrong_round",
    });
  });

  it("refuses the round they went out in", () => {
    expect(
      buybackEligibility(
        candidate({ eliminated_round_number: 2 }),
        round(2),
        NOW
      )
    ).toMatchObject({ eligible: false, code: "wrong_round" });
  });

  it("refuses when the competition has no such round", () => {
    expect(
      buybackEligibility(
        candidate({ eliminated_round_number: 3 }),
        undefined,
        NOW
      )
    ).toMatchObject({ eligible: false, code: "no_next_round" });
  });
});

describe("buybackEligibility — the window closes at the deadline", () => {
  it("open while the deadline is still ahead", () => {
    expect(
      buybackEligibility(candidate(), round(3, { deadline: LATER }), NOW)
        .eligible
    ).toBe(true);
  });

  it("shut once the deadline has passed", () => {
    expect(
      buybackEligibility(candidate(), round(3, { deadline: EARLIER }), NOW)
    ).toMatchObject({ eligible: false, code: "window_closed" });
  });

  it("shut AT the deadline, not a moment after — picks lock on the instant", () => {
    const deadline = "2026-01-10T12:00:00.000Z"; // exactly NOW
    expect(
      buybackEligibility(candidate(), round(3, { deadline }), NOW)
    ).toMatchObject({ eligible: false, code: "window_closed" });

    const aMomentBefore = new Date(NOW.getTime() - 1);
    expect(
      buybackEligibility(candidate(), round(3, { deadline }), aMomentBefore)
        .eligible
    ).toBe(true);
  });

  it("shut once that round is locked or settled, whatever the clock says", () => {
    for (const status of ["locked", "settled"] as const) {
      expect(
        buybackEligibility(
          candidate(),
          round(3, { deadline: LATER, status }),
          NOW
        )
      ).toMatchObject({ eligible: false, code: "window_closed" });
    }
  });

  // Fails CLOSED. `now >= NaN` is false, so a naive check would read an
  // unreadable deadline as a window that is still open.
  it("shut when the deadline cannot be parsed", () => {
    expect(
      buybackEligibility(candidate(), round(3, { deadline: "not a date" }), NOW)
    ).toMatchObject({ eligible: false, code: "window_closed" });
  });
});

describe("buybackEligibility — one buy-back per elimination", () => {
  it("refuses when this elimination has already been bought back", () => {
    expect(
      buybackEligibility(candidate({ bought_back: true }), round(3), NOW)
    ).toMatchObject({ eligible: false, code: "already_bought_back" });
  });

  it("an active entry has nothing to buy back", () => {
    expect(
      buybackEligibility(
        candidate({ status: "active", eliminated_round_number: null }),
        round(3),
        NOW
      )
    ).toMatchObject({ eligible: false, code: "not_eliminated" });
  });

  it("a winner cannot buy back", () => {
    expect(
      buybackEligibility(candidate({ status: "winner" }), round(3), NOW)
    ).toMatchObject({ eligible: false, code: "not_eliminated" });
  });

  it("an eliminated entry with no known round cannot be worked out", () => {
    expect(
      buybackEligibility(
        candidate({ eliminated_round_number: null }),
        round(3),
        NOW
      )
    ).toMatchObject({ eligible: false, code: "unknown_elimination_round" });
  });
});

describe("buy-back is per ENTRY, not per person", () => {
  // One owner, two entries, both out in round 1. Each has its own offer, and
  // taking one says nothing about the other.
  const first = candidate({
    entry_id: "smith-1",
    participant_id: "smith",
    eliminated_round_number: 1,
    bought_back: true, // already came back
  });
  const second = candidate({
    entry_id: "smith-2",
    participant_id: "smith",
    eliminated_round_number: 1,
    bought_back: false,
  });

  it("one entry's used buy-back does not consume the other's", () => {
    expect(buybackEligibility(first, round(2), NOW)).toMatchObject({
      eligible: false,
      code: "already_bought_back",
    });
    expect(buybackEligibility(second, round(2), NOW).eligible).toBe(true);
  });

  it("two entries of the same person out in different rounds get different windows", () => {
    const outR1 = candidate({
      entry_id: "smith-1",
      participant_id: "smith",
      eliminated_round_number: 1,
    });
    const outR3 = candidate({
      entry_id: "smith-2",
      participant_id: "smith",
      eliminated_round_number: 3,
    });
    const rounds = new Map([
      [2, round(2, { deadline: EARLIER })], // R1's window: gone
      [4, round(4, { deadline: LATER })], // R3's window: open
    ]);

    const open = openBuybackWindows(
      [outR1, outR3],
      (n) => rounds.get(n),
      NOW
    );
    expect(open).toEqual([
      {
        entry_id: "smith-2",
        participant_id: "smith",
        for_round_number: 4,
        closes_at: LATER,
      },
    ]);
  });
});

describe("openBuybackWindows", () => {
  const rounds = new Map([
    [2, round(2, { deadline: LATER })],
    [3, round(3, { deadline: LATER })],
    [5, round(5, { deadline: LATER })],
  ]);
  const lookup = (n: number) => rounds.get(n);

  it("keeps only the entries whose window is genuinely open", () => {
    const open = openBuybackWindows(
      [
        candidate({ entry_id: "a", eliminated_round_number: 1 }), // → R2, open
        candidate({ entry_id: "b", eliminated_round_number: 2 }), // → R3, open
        candidate({ entry_id: "c", eliminated_round_number: 4 }), // too late
        candidate({ entry_id: "d", eliminated_round_number: 2, bought_back: true }),
        candidate({ entry_id: "e", status: "active", eliminated_round_number: null }),
      ],
      lookup,
      NOW
    );
    expect(open.map((w) => w.entry_id)).toEqual(["a", "b"]);
  });

  it("is empty when nobody is eligible", () => {
    expect(
      openBuybackWindows(
        [candidate({ eliminated_round_number: 9 })],
        lookup,
        NOW
      )
    ).toEqual([]);
  });

  it("reports the round each entry would come back for", () => {
    const open = openBuybackWindows(
      [candidate({ entry_id: "a", eliminated_round_number: 1 })],
      lookup,
      NOW
    );
    expect(open[0].for_round_number).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// The zero-survivor pending state
// ---------------------------------------------------------------------------

describe("resolveCompetitionState — zero survivors", () => {
  const wipedOut = [
    entry("a", "p1", "eliminated"),
    entry("b", "p2", "eliminated"),
  ];

  it("PENDS rather than rolling over while a window is open", () => {
    const state = resolveCompetitionState(wipedOut, [
      window({ entry_id: "a", closes_at: LATER }),
    ]);
    expect(state).toEqual({
      kind: "pending_rollover",
      window_closes: LATER,
      open_entry_ids: ["a"],
    });
  });

  it("rolls over once no window is open", () => {
    expect(resolveCompetitionState(wipedOut, [])).toEqual({ kind: "rollover" });
  });

  it("waits for the LATEST window, not the first", () => {
    const state = resolveCompetitionState(wipedOut, [
      window({ entry_id: "a", closes_at: "2026-01-11T12:00:00.000Z" }),
      window({ entry_id: "b", closes_at: "2026-01-13T12:00:00.000Z" }),
      window({ entry_id: "c", closes_at: "2026-01-12T12:00:00.000Z" }),
    ]);
    expect(state).toMatchObject({
      kind: "pending_rollover",
      window_closes: "2026-01-13T12:00:00.000Z",
    });
  });

  // pend → CONTINUE. The buy-back landed, so the entry is active again and the
  // competition is simply running. It is NOT a win: nobody survived the round,
  // somebody returned to play the next one.
  it("continues once a bought-back entry is active again", () => {
    const afterBuyback = [
      entry("a", "p1", "active"), // bought back in — returning, not surviving
      entry("b", "p2", "eliminated"),
    ];
    // b's own window may still be open — that never stops a live competition.
    expect(
      resolveCompetitionState(afterBuyback, [window({ entry_id: "b" })], ["a"])
    ).toEqual({ kind: "continue", entry_ids: ["a"] });
  });

  it("continues even with every window shut, if the field is a returning entry", () => {
    const afterBuyback = [
      entry("a", "p1", "active"),
      entry("b", "p2", "eliminated"),
    ];
    // The crown must NOT go to someone who bought back into an empty field and
    // has not played a round since.
    expect(resolveCompetitionState(afterBuyback, [], ["a"])).toEqual({
      kind: "continue",
      entry_ids: ["a"],
    });
  });

  it("a survivor is still a survivor — the flag is only for returning entries", () => {
    const survived = [
      entry("a", "p1", "active"),
      entry("b", "p2", "eliminated"),
    ];
    expect(resolveCompetitionState(survived, [], [])).toEqual({
      kind: "won",
      participant_id: "p1",
      entry_ids: ["a"],
    });
  });
});

describe("resolveCompetitionState — a returning entry re-opens a decided field", () => {
  it("a sole survivor is not crowned once a competitor has bought back", () => {
    const field = [
      entry("a", "p1", "active"), // survived
      entry("b", "p2", "active"), // bought back in
    ];
    expect(resolveCompetitionState(field, [], ["b"])).toEqual({
      kind: "continue",
      entry_ids: ["a", "b"],
    });
  });

  it("an entry that bought back for the round just settled is an ordinary survivor", () => {
    // It returned for THIS round and came through it — nothing returning about
    // it any more, so the sole-survivor read stands.
    const field = [entry("a", "p1", "active"), entry("b", "p2", "eliminated")];
    expect(resolveCompetitionState(field, [], [])).toMatchObject({
      kind: "won",
      participant_id: "p1",
    });
  });
});

describe("resolveCompetitionState — a round that leaves survivors never pends", () => {
  it("two owners still in → continue, window open or not", () => {
    const alive = [
      entry("a", "p1", "active"),
      entry("b", "p2", "active"),
      entry("c", "p3", "eliminated"),
    ];
    expect(resolveCompetitionState(alive, [])).toEqual({
      kind: "continue",
      entry_ids: ["a", "b"],
    });
    expect(resolveCompetitionState(alive, [window({ entry_id: "c" })])).toEqual({
      kind: "continue",
      entry_ids: ["a", "b"],
    });
  });
});

describe("resolveCompetitionState — a sole survivor is not crowned early", () => {
  const soleSurvivor = [
    entry("a", "p1", "active"),
    entry("b", "p2", "eliminated"),
  ];

  it("wins once every window has closed", () => {
    expect(resolveCompetitionState(soleSurvivor, [])).toEqual({
      kind: "won",
      participant_id: "p1",
      entry_ids: ["a"],
    });
  });

  it("does NOT win while an eliminated competitor could still come back", () => {
    expect(
      resolveCompetitionState(soleSurvivor, [
        window({ entry_id: "b", participant_id: "p2", closes_at: LATER }),
      ])
    ).toEqual({
      kind: "pending_win",
      participant_id: "p1",
      entry_ids: ["a"],
      window_closes: LATER,
      open_entry_ids: ["b"],
    });
  });

  it("last entries all belonging to one person still wins — one pot, one crown", () => {
    const twoOfTheirs = [
      entry("a", "p1", "active"),
      entry("b", "p1", "active"),
      entry("c", "p2", "eliminated"),
    ];
    expect(resolveCompetitionState(twoOfTheirs, [])).toEqual({
      kind: "won",
      participant_id: "p1",
      entry_ids: ["a", "b"],
    });
  });
});

// ---------------------------------------------------------------------------
// Used teams persist across a buy-back
// ---------------------------------------------------------------------------

describe("a bought-back entry keeps its used teams", () => {
  const TEAMS: Team[] = [
    "Arsenal",
    "Aston Villa",
    "Bournemouth",
    "Brentford",
    "Chelsea",
  ].map((name, i) => ({ id: i + 1, name }));

  // Out in round 2 on Chelsea, having used Arsenal in round 1.
  const history = [1, 5]; // Arsenal, then Chelsea

  it("the team that put it out is still unavailable after buying back", () => {
    const available = availableTeams(history, TEAMS).map((t) => t.name);
    expect(available).not.toContain("Chelsea");
    expect(available).not.toContain("Arsenal");
    expect(available).toEqual(["Aston Villa", "Bournemouth", "Brentford"]);
  });

  // The engine has no "reset on buy-back" path at all, which is the point:
  // eligibility and availability share no state, so coming back cannot touch
  // the pool. Pinned as a test because it is a rule, not an accident.
  it("eligibility does not alter what the entry may pick", () => {
    const before = availableTeams(history, TEAMS);
    const verdict = buybackEligibility(
      candidate({ eliminated_round_number: 2 }),
      round(3),
      NOW
    );
    expect(verdict.eligible).toBe(true);
    expect(availableTeams(history, TEAMS)).toEqual(before);
  });

  it("and it settles in the round it returns for like anyone else", () => {
    const fixtures: Fixture[] = [
      {
        id: 1,
        matchday: 3,
        home_team_id: 2, // Aston Villa
        away_team_id: 5, // Chelsea
        status: "played",
        result: "home",
      },
    ];
    const revived: EntryRecord[] = [entry("a", "p1", "active")];
    const settled = settleRound(revived, [{ entry_id: "a", team_id: 2 }], fixtures, 3);
    expect(settled.entries[0].status).toBe("active");
    expect(settled.outcomes[0].outcome).toBe("survived");
  });
});

// ---------------------------------------------------------------------------
// lib/buyback.ts — the adapters between database rows and the rules
// ---------------------------------------------------------------------------

describe("buybackOffers", () => {
  const rounds: BuybackRoundRow[] = [
    { id: "r1", round_number: 1, deadline: EARLIER, status: "settled" },
    { id: "r2", round_number: 2, deadline: LATER, status: "pending" },
    { id: "r3", round_number: 3, deadline: LATER, status: "pending" },
    { id: "r4", round_number: 4, deadline: LATER, status: "pending" },
    { id: "r5", round_number: 5, deadline: LATER, status: "pending" },
  ];

  const dbEntry = (
    id: string,
    status: EntryStatus,
    eliminated_round_id: string | null
  ): BuybackEntry => ({
    id,
    participant_id: `p-${id}`,
    status,
    eliminated_round_id,
  });

  it("offers a buy-back to an entry out in round 1, for round 2", () => {
    const offers = buybackOffers({
      entries: [dbEntry("e1", "eliminated", "r1")],
      rounds,
      buybacks: [],
      now: NOW,
    });
    expect(offers.get("e1")?.verdict).toMatchObject({
      eligible: true,
      for_round_number: 2,
    });
    expect(offers.get("e1")?.round?.id).toBe("r2");
  });

  it("says nothing at all about entries that are still in", () => {
    const offers = buybackOffers({
      entries: [dbEntry("e1", "active", null), dbEntry("e2", "winner", null)],
      rounds,
      buybacks: [],
      now: NOW,
    });
    expect(offers.size).toBe(0);
  });

  it("refuses an entry out in round 4", () => {
    const offers = buybackOffers({
      entries: [dbEntry("e1", "eliminated", "r4")],
      rounds,
      buybacks: [],
      now: NOW,
    });
    expect(offers.get("e1")?.verdict).toMatchObject({
      eligible: false,
      code: "eliminated_too_late",
    });
  });

  // The join this module exists for: a recorded buy-back has to be matched to
  // the ELIMINATION it bought, not merely to the entry.
  it("matches a recorded buy-back to the elimination it paid for", () => {
    const boughtRoundOne = {
      id: "b1",
      entry_id: "e1",
      eliminated_round_id: "r1",
      round_id: "r2",
      paid: true,
      amount_paid_pence: 1000,
    };

    // Out in round 1, already bought that back → nothing left.
    expect(
      buybackOffers({
        entries: [dbEntry("e1", "eliminated", "r1")],
        rounds,
        buybacks: [boughtRoundOne],
        now: NOW,
      }).get("e1")?.verdict
    ).toMatchObject({ eligible: false, code: "already_bought_back" });

    // Same entry, same paid buy-back — but it came back, played, and went out
    // AGAIN in round 2. That is a fresh elimination and a fresh offer.
    expect(
      buybackOffers({
        entries: [dbEntry("e1", "eliminated", "r2")],
        rounds,
        buybacks: [boughtRoundOne],
        now: NOW,
      }).get("e1")?.verdict
    ).toMatchObject({ eligible: true, for_round_number: 3 });
  });

  it("one person's two entries are answered independently", () => {
    const offers = buybackOffers({
      entries: [
        { ...dbEntry("smith-1", "eliminated", "r1"), participant_id: "smith" },
        { ...dbEntry("smith-2", "eliminated", "r1"), participant_id: "smith" },
      ],
      rounds,
      buybacks: [
        {
          id: "b1",
          entry_id: "smith-1",
          eliminated_round_id: "r1",
          round_id: "r2",
          paid: true,
          amount_paid_pence: 1000,
        },
      ],
      now: NOW,
    });
    expect(offers.get("smith-1")?.verdict.eligible).toBe(false);
    expect(offers.get("smith-2")?.verdict.eligible).toBe(true);
  });

  it("refuses once the window's round is no longer pending", () => {
    const offers = buybackOffers({
      entries: [dbEntry("e1", "eliminated", "r1")],
      rounds: rounds.map((r) =>
        r.round_number === 2 ? { ...r, status: "settled" as const } : r
      ),
      buybacks: [],
      now: NOW,
    });
    expect(offers.get("e1")?.verdict).toMatchObject({
      eligible: false,
      code: "window_closed",
    });
  });
});

describe("planBuybacks", () => {
  const rounds: BuybackRoundRow[] = [
    { id: "r1", round_number: 1, deadline: EARLIER, status: "settled" },
    { id: "r2", round_number: 2, deadline: LATER, status: "pending" },
  ];

  it("resolves round ids to the numbers the rules are written in", () => {
    expect(
      planBuybacks(
        [
          {
            id: "b1",
            entry_id: "e1",
            eliminated_round_id: "r1",
            round_id: "r2",
            paid: true,
            amount_paid_pence: 1000,
          },
        ],
        rounds
      )
    ).toEqual([
      {
        id: "b1",
        entry_id: "e1",
        eliminated_round_number: 1,
        for_round_number: 2,
      },
    ]);
  });

  it("drops a row whose rounds cannot be resolved rather than guessing", () => {
    expect(
      planBuybacks(
        [
          {
            id: "b1",
            entry_id: "e1",
            eliminated_round_id: "r1",
            round_id: "gone",
            paid: true,
            amount_paid_pence: 1000,
          },
        ],
        rounds
      )
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The round boundary: pending is a rounds-1-to-3 state, and only that
// ---------------------------------------------------------------------------
//
// Nothing pends unless a window actually exists, and a window only exists for
// an elimination in rounds 1–3. So a round-4 settlement decides the competition
// outright — there is nothing to wait for, and waiting would strand a finished
// competition until an organiser pressed something.
//
// This falls out of the eligibility band rather than being a separate gate, and
// that is exactly why it is pinned here: the two rules are one rule, and a
// change to the band silently moves this boundary too.

describe("round 4 and later — settlement decides it there and then", () => {
  const rounds = new Map([
    [4, round(4, { deadline: LATER })],
    [5, round(5, { deadline: LATER })],
  ]);
  const lookup = (n: number) => rounds.get(n);

  it("a field wiped out in round 4 rolls over IMMEDIATELY, never pending", () => {
    const out = [
      candidate({ entry_id: "a", participant_id: "p1", eliminated_round_number: 4 }),
      candidate({ entry_id: "b", participant_id: "p2", eliminated_round_number: 4 }),
    ];
    // Round 5 is still to come, and it makes no difference: neither elimination
    // is eligible, so neither has a window.
    expect(openBuybackWindows(out, lookup, NOW)).toEqual([]);

    expect(
      resolveCompetitionState(
        [entry("a", "p1", "eliminated"), entry("b", "p2", "eliminated")],
        openBuybackWindows(out, lookup, NOW)
      )
    ).toEqual({ kind: "rollover" });
  });

  it("a sole survivor of round 4 WINS immediately", () => {
    const out = [
      candidate({ entry_id: "b", participant_id: "p2", eliminated_round_number: 4 }),
    ];
    expect(openBuybackWindows(out, lookup, NOW)).toEqual([]);

    expect(
      resolveCompetitionState(
        [entry("a", "p1", "active"), entry("b", "p2", "eliminated")],
        openBuybackWindows(out, lookup, NOW)
      )
    ).toEqual({ kind: "won", participant_id: "p1", entry_ids: ["a"] });
  });

  it("but round 3 — one round earlier — still pends both ways", () => {
    const r3 = new Map([[4, round(4, { deadline: LATER })]]);
    const wipedOut = [
      candidate({ entry_id: "a", participant_id: "p1", eliminated_round_number: 3 }),
      candidate({ entry_id: "b", participant_id: "p2", eliminated_round_number: 3 }),
    ];
    expect(
      resolveCompetitionState(
        [entry("a", "p1", "eliminated"), entry("b", "p2", "eliminated")],
        openBuybackWindows(wipedOut, (n) => r3.get(n), NOW)
      )
    ).toMatchObject({ kind: "pending_rollover", window_closes: LATER });

    const soleSurvivor = [
      candidate({ entry_id: "b", participant_id: "p2", eliminated_round_number: 3 }),
    ];
    expect(
      resolveCompetitionState(
        [entry("a", "p1", "active"), entry("b", "p2", "eliminated")],
        openBuybackWindows(soleSurvivor, (n) => r3.get(n), NOW)
      )
    ).toMatchObject({ kind: "pending_win", participant_id: "p1" });
  });

  it("a round-3 elimination's window is shut by the time round 4 is settled", () => {
    // Round 4 cannot be settled until its own deadline has passed, and that
    // deadline IS the window. So even the last entry that could ever buy back
    // has no live offer once round 4 settles — this is the belt to the band's
    // braces.
    const shut = new Map([[4, round(4, { deadline: EARLIER, status: "settled" })]]);
    expect(
      openBuybackWindows(
        [candidate({ eliminated_round_number: 3 })],
        (n) => shut.get(n),
        NOW
      )
    ).toEqual([]);
  });
});
