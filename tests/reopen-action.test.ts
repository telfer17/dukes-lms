import { beforeEach, describe, expect, it, vi } from "vitest";

// reopenRound, driven for real, with Supabase replaced by a stand-in.
//
// The reversal itself is proved against a real Postgres in
// tests/db/reopen-round.db.test.ts. What is NOT covered there is the thing an
// organiser touches: the Reopen button, which round id it sends, and what it
// says when the database refuses — in particular the not-latest refusal, which
// has to tell the organiser what to do instead rather than just "no".

const h = vi.hoisted(() => {
  const rpc = vi.fn(
    async (): Promise<{ data: unknown; error: unknown }> => ({
      data: null,
      error: null,
    })
  );
  const round = {
    id: "r2",
    competition_id: "c1",
    round_number: 2,
    matchday: 2,
    deadline: new Date(Date.now() - 25 * 3600_000).toISOString(),
    status: "settled" as const,
    locked_at: null,
  };
  return { rpc, round };
});

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: async () => {} }));
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { rpc: h.rpc },
}));
vi.mock("@/lib/lms-db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/lms-db")>()),
  getRound: async (id: string) => (id === h.round.id ? h.round : null),
}));

const { reopenRound } = await import("@/app/admin/results/actions");

type State = Awaited<ReturnType<typeof reopenRound>>;
const errorOf = (s: State) => (s && "error" in s ? s.error : null);
const okOf = (s: State) => (s && "ok" in s ? s.ok : null);

function form(roundId: string | null): FormData {
  const fd = new FormData();
  if (roundId !== null) fd.set("round_id", roundId);
  return fd;
}

describe("reopenRound", () => {
  beforeEach(() => {
    h.rpc.mockReset();
    h.rpc.mockResolvedValue({ data: null, error: null });
  });

  it("sends the form's round id to lms_reopen_round and reports what moved", async () => {
    h.rpc.mockResolvedValue({
      data: {
        ok: true,
        code: "reopened",
        round_number: 2,
        revived: 3,
        winners_reverted: 0,
        outcomes_reset: 5,
        competition_reverted_from: null,
        buybacks_on_round: 0,
      },
      error: null,
    });

    const state = await reopenRound(null, form("r2"));

    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith("lms_reopen_round", { p_round_id: "r2" });
    expect(okOf(state)).toMatch(/Round 2 is reopened — 3 entries back in/);
    expect(okOf(state)).toMatch(/settle round 2 again/);
    expect(okOf(state)).not.toMatch(/buy-back/);
  });

  it("says when a winner was un-crowned, and flags buy-backs left in place", async () => {
    h.rpc.mockResolvedValue({
      data: {
        ok: true,
        code: "reopened",
        round_number: 2,
        revived: 1,
        winners_reverted: 1,
        outcomes_reset: 2,
        competition_reverted_from: "won",
        buybacks_on_round: 1,
      },
      error: null,
    });

    const state = await reopenRound(null, form("r2"));
    expect(okOf(state)).toMatch(/1 entry back in, the winner is un-crowned/);
    expect(okOf(state)).toMatch(/1 buy-back was taken .* left as it was/);
    expect(okOf(state)).toMatch(/£10 is yours to refund/);
  });

  it("never calls the database without a round id, or for a round that is gone", async () => {
    expect(errorOf(await reopenRound(null, form(null)))).toMatch(/No round was named/);
    expect(errorOf(await reopenRound(null, form("gone")))).toMatch(/no longer exists/);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("explains the not-latest refusal and what to do instead", async () => {
    h.rpc.mockResolvedValue({
      data: {
        ok: false,
        code: "not_latest",
        detail: { round_number: 2, later_round_number: 3, later_status: "settled" },
      },
      error: null,
    });

    const error = errorOf(await reopenRound(null, form("r2")));
    expect(error).toMatch(/Round 2 is not the most recently settled round/);
    expect(error).toMatch(/round 3 was settled after it/);
    expect(error).toMatch(/Only the most recent settled round can be reopened/);
    expect(error).toMatch(/reopen the later rounds first/);
  });

  it("names a later provisional lock as the blocker", async () => {
    h.rpc.mockResolvedValue({
      data: {
        ok: false,
        code: "not_latest",
        detail: { round_number: 2, later_round_number: 3, later_status: "locked" },
      },
      error: null,
    });
    expect(errorOf(await reopenRound(null, form("r2")))).toMatch(
      /round 3 was provisionally locked after it/
    );
  });

  it("treats an already-reopened round as done, not as a failure to explain", async () => {
    h.rpc.mockResolvedValue({
      data: { ok: false, code: "not_settled", detail: { round_number: 2, status: "locked" } },
      error: null,
    });
    expect(errorOf(await reopenRound(null, form("r2")))).toMatch(
      /Round 2 is already reopened — correct the result and settle it again/
    );
  });

  it("refuses when another competition is active, and says nothing changed", async () => {
    h.rpc.mockResolvedValue({
      data: { ok: false, code: "another_competition_active", detail: { round_number: 2 } },
      error: null,
    });
    const error = errorOf(await reopenRound(null, form("r2")));
    expect(error).toMatch(/another competition is already active/);
    expect(error).toMatch(/Nothing was changed/);
  });

  it("reports a transport failure as nothing changed", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(errorOf(await reopenRound(null, form("r2")))).toMatch(
      /nothing was changed .* one transaction/
    );
  });
});
