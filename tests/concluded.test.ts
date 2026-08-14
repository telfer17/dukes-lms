// The concluded summary — what a finished competition says about itself.
//
// Two things are pinned here. First the arithmetic and the naming: the pot is
// the same figure whether it was won or is rolling over, and a winner holding
// several surviving entries is still ONE person with ONE pot.
//
// Second, and more important: every part of this is allowed to fail on its own.
// The competition row alone proves the competition is over, so a dead
// participants lookup or a dead entries read must cost one LINE — never the
// page. Losing the winner's name is a shame; replacing the final standings with
// "no competition running" is the bug this whole feature exists to fix.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicCompetition } from "@/lib/public-read";

// lib/concluded is server-only, and the marker package throws outside a server
// bundle. The database layer is mocked because this is about how answers are
// combined, not about Supabase.
vi.mock("server-only", () => ({}));

const getEntries = vi.fn();
const getParticipantNames = vi.fn();
vi.mock("@/lib/lms-db", () => ({
  getEntries: (...args: unknown[]) => getEntries(...args),
  getParticipantNames: (...args: unknown[]) => getParticipantNames(...args),
}));

const { readConcludedSummary } = await import("@/lib/concluded");

const WON: PublicCompetition = {
  id: "comp-1",
  label: "Competition 1",
  status: "won",
  rollover_count: 0,
  pot_carried_in_pence: 5_000,
  winner_participant_id: "ann",
};

const ROLLED_OVER: PublicCompetition = {
  ...WON,
  status: "rolled_over",
  winner_participant_id: null,
};

/** Six paid £10 entries: Ann holds the two that survived. */
const ENTRIES = [
  { paid: true, amount_paid_pence: 1000, status: "winner" },
  { paid: true, amount_paid_pence: 1000, status: "winner" },
  { paid: true, amount_paid_pence: 1000, status: "eliminated" },
  { paid: true, amount_paid_pence: 1000, status: "eliminated" },
  { paid: true, amount_paid_pence: 1000, status: "eliminated" },
  // Never paid, so it adds nothing to the pot.
  { paid: false, amount_paid_pence: 0, status: "eliminated" },
];

beforeEach(() => {
  getEntries.mockReset();
  getParticipantNames.mockReset();
  getParticipantNames.mockResolvedValue(new Map([["ann", "Ann Rutherford"]]));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("readConcludedSummary", () => {
  it("names the winner once and counts their surviving entries", async () => {
    const summary = await readConcludedSummary(WON, ENTRIES);

    expect(summary.status).toBe("won");
    expect(summary.winnerName).toBe("Ann Rutherford");
    // Two entries survived; the name above is still a single person.
    expect(summary.winnerEntryCount).toBe(2);
    // £50 carried in + half of the £50 collected.
    expect(summary.potLabel).toBe("£75");
    expect(getParticipantNames).toHaveBeenCalledWith(["ann"]);
  });

  it("reads the entries itself when the caller has none", async () => {
    getEntries.mockResolvedValue(ENTRIES);

    const summary = await readConcludedSummary(WON);

    expect(getEntries).toHaveBeenCalledWith("comp-1");
    expect(summary.potLabel).toBe("£75");
  });

  it("does not read them twice when the caller passes them in", async () => {
    await readConcludedSummary(WON, ENTRIES);
    expect(getEntries).not.toHaveBeenCalled();
  });

  it("still reports the win when the winner's name can't be read", async () => {
    getParticipantNames.mockRejectedValue(new Error("participants unreachable"));

    const summary = await readConcludedSummary(WON, ENTRIES);

    expect(summary.winnerName).toBeNull();
    // The rest survives: the page says a competition was won, and how much for.
    expect(summary.status).toBe("won");
    expect(summary.label).toBe("Competition 1");
    expect(summary.potLabel).toBe("£75");
  });

  it("still reports the ending when the entries can't be read", async () => {
    getEntries.mockRejectedValue(new Error("entries unreachable"));

    const summary = await readConcludedSummary(WON);

    // No entries means no honest pot figure and no honest count — so it says
    // neither, rather than "£50" (carried-in alone) or "0 surviving entries".
    expect(summary.potLabel).toBeNull();
    expect(summary.winnerEntryCount).toBe(0);
    expect(summary.winnerName).toBe("Ann Rutherford");
    expect(summary.status).toBe("won");
  });

  it("carries the pot forward on a rollover, with nobody named", async () => {
    // Nobody survives a rollover, so every entry is eliminated.
    const wipedOut = ENTRIES.map((e) => ({ ...e, status: "eliminated" }));

    const summary = await readConcludedSummary(ROLLED_OVER, wipedOut);

    expect(summary.status).toBe("rolled_over");
    expect(summary.winnerName).toBeNull();
    expect(summary.winnerEntryCount).toBe(0);
    // Same arithmetic as a win — it is the same pot, going somewhere else.
    expect(summary.potLabel).toBe("£75");
    expect(getParticipantNames).not.toHaveBeenCalled();
  });

  it("never captions a crown on a rollover, whatever the entries say", async () => {
    // Contradictory data — a surviving entry in a competition that rolled over.
    // The crown is not drawn in this state, so its caption must not be either.
    const summary = await readConcludedSummary(ROLLED_OVER, ENTRIES);

    expect(summary.winnerEntryCount).toBe(0);
    expect(summary.winnerName).toBeNull();
  });
});
