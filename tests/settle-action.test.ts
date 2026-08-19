import { beforeEach, describe, expect, it, vi } from "vitest";

// settleCurrentRound, driven for real, with Supabase replaced by a stand-in.
//
// The engine and the plan builder are proved pure elsewhere, and the
// transaction is proved against a real Postgres in tests/db/. What is NOT
// covered by either is the thing an organiser actually touches: the Settle
// button, and what it says when it refuses.
//
// The scenario is the one that has to be right on a Saturday night. Two entries
// are left. P1 picked Aston Villa, who have lost. P2 picked Chelsea, who play
// tomorrow. Press Settle now and the action must refuse, name the game it is
// waiting on, and — the part that matters — never send a plan at all, because a
// plan is a thing the database applies.

const h = vi.hoisted(() => {
  const rpc = vi.fn(async () => ({ data: null, error: null }));

  const competition = {
    id: "c1",
    label: "Test competition",
    status: "active" as const,
    rollover_count: 0,
    pot_carried_in_pence: 0,
    winner_participant_id: null,
    created_at: "",
  };

  const round = {
    id: "r1",
    competition_id: "c1",
    round_number: 1,
    matchday: 1,
    // Yesterday: picks are locked, so the round is settleable.
    deadline: new Date(Date.now() - 25 * 3600_000).toISOString(),
    status: "pending" as const,
  };

  const teams = [
    { id: 1, name: "Arsenal" },
    { id: 2, name: "Aston Villa" },
    { id: 3, name: "Chelsea" },
    { id: 4, name: "Crystal Palace" },
  ];

  const state = {
    /** Saturday is decided; the Sunday fixture is what the tests vary. */
    sunday: { status: "scheduled", result: null } as {
      status: "scheduled" | "played" | "postponed";
      result: "home" | "away" | "draw" | null;
    },
  };

  const entry = (id: string, participantId: string, name: string) => ({
    id,
    competition_id: "c1",
    participant_id: participantId,
    paid: true,
    amount_paid_pence: 1000,
    is_newcomer: false,
    status: "active" as const,
    eliminated_round_id: null,
    joined_at: "",
    participant: { id: participantId, name, phone: null, club_contact: null },
  });

  return { rpc, competition, round, teams, state, entry };
});

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: async () => {} }));
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { rpc: h.rpc },
}));
vi.mock("@/lib/lms-db", async (importOriginal) => ({
  // currentRound and isRoundOpen are pure — keep the real ones so the action's
  // own round selection and open/closed decision are genuinely exercised.
  ...(await importOriginal<typeof import("@/lib/lms-db")>()),
  getActiveCompetition: async () => h.competition,
  getRounds: async () => [h.round],
  getTeams: async () => h.teams,
  getFixturesForMatchday: async () => [
    {
      id: 10,
      matchday: 1,
      home_team_id: 1,
      away_team_id: 2,
      status: "played",
      result: "home",
    },
    {
      id: 11,
      matchday: 1,
      home_team_id: 3,
      away_team_id: 4,
      status: h.state.sunday.status,
      result: h.state.sunday.result,
    },
  ],
  getEntries: async () => [
    h.entry("e1", "p1", "P1"),
    h.entry("e2", "p2", "P2"),
  ],
  getPicksForCompetition: async () => [
    { id: "k1", competition_id: "c1", entry_id: "e1", round_id: "r1", team_id: 2, auto_assigned: false, outcome: "pending" },
    { id: "k2", competition_id: "c1", entry_id: "e2", round_id: "r1", team_id: 3, auto_assigned: false, outcome: "pending" },
  ],
  // Nobody has bought back. The buy-back windows this round would open are
  // exercised in tests/buyback.test.ts and tests/settlement-plan.test.ts; what
  // this file is about is the Settle button's refusals.
  getBuybacks: async () => [],
}));

const { settleCurrentRound } = await import("@/app/admin/results/actions");

// ActionState is a union of { error } | { ok } | { notice, confirm } | null, so
// reading either field needs a narrow. These keep the assertions about the
// message rather than about TypeScript.
type State = Awaited<ReturnType<typeof settleCurrentRound>>;
const errorOf = (s: State) => (s && "error" in s ? s.error : undefined);
const okOf = (s: State) => (s && "ok" in s ? s.ok : undefined);

describe("settleCurrentRound — the Saturday-night press", () => {
  beforeEach(() => {
    h.rpc.mockClear();
    h.state.sunday = { status: "scheduled", result: null };
  });

  it("REFUSES while the Sunday fixture has no result, and names it", async () => {
    const result = await settleCurrentRound();

    expect(errorOf(result)).toBe(
      "Can't settle yet — no result for Chelsea v Crystal Palace. Every fixture a surviving entry picked has to be in first. Nothing has been changed."
    );
    expect(okOf(result)).toBeUndefined();
  });

  it("sends NOTHING to the database when it refuses", async () => {
    await settleCurrentRound();
    // Not "the RPC refused" — the RPC was never called. There is no plan to
    // apply, so there is nothing that could be applied by mistake.
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("does not treat the settleable half of the round as settleable", async () => {
    // P1 is out whatever happens on Sunday, and it is tempting to bank that.
    // Banking it would leave P2 the last entry standing on an unplayed game.
    const result = await settleCurrentRound();
    expect(errorOf(result)).toContain("Can't settle yet");
    expect(errorOf(result)).not.toContain("still standing");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("settles once the Sunday result is in — the refusal is about the result, not the shape", async () => {
    h.state.sunday = { status: "played", result: "home" }; // Chelsea win
    h.rpc.mockResolvedValueOnce({
      data: {
        ok: true,
        code: "settled",
        end_kind: "won",
        round_number: 1,
        eliminated: 1,
        survivors: 1,
      },
      error: null,
    } as never);

    const result = await settleCurrentRound();

    expect(h.rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = h.rpc.mock.calls[0] as unknown as [
      string,
      { p_plan: { end: { kind: string; participant_id: string | null } } },
    ];
    expect(fn).toBe("lms_settle_round");
    expect(args.p_plan.end).toMatchObject({
      kind: "won",
      participant_id: "p2",
    });
    expect(okOf(result)).toContain("P2 is the Last Man Standing");
  });

  it("relays the database's own missing-result refusal, named", async () => {
    // Belt and braces: if the plan builder ever stopped catching this, the
    // function's guard would, and the organiser must still get a usable
    // sentence rather than a code.
    h.state.sunday = { status: "played", result: "home" };
    h.rpc.mockResolvedValueOnce({
      data: {
        ok: false,
        code: "missing_results",
        detail: { fixtures: ["Chelsea v Crystal Palace"] },
      },
      error: null,
    } as never);

    const result = await settleCurrentRound();

    expect(errorOf(result)).toBe(
      "Can't settle yet — no result for Chelsea v Crystal Palace. Every fixture a surviving entry picked has to be in first. Nothing has been changed."
    );
  });
});
