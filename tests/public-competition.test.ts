// Which competition the public pages render — the rule that decides whether a
// visitor sees a live board, a finished one, or nothing at all.
//
// The failure this pins was found in a live rehearsal: a competition ended and
// every public page fell back to "no competition running", because the read
// only ever asked for an active one. The data was all still there. So there are
// two things to hold in place here, and they pull in opposite directions:
//
//   1. A concluded competition IS shown when nothing is running — otherwise the
//      site goes blank at the moment of maximum interest.
//   2. It is NEVER shown while something is running, and never shown because a
//      read failed. "Here's who won" on top of a live competition, or on top of
//      a database blink, is worse than the blank page this replaced.
//
// The Supabase client is faked rather than the whole database: what is under
// test is the sequence of queries and how their answers are combined, and that
// is exactly what the fake records.

import { beforeEach, describe, expect, it, vi } from "vitest";

type QueryResponse = { data: unknown[] | null; error: unknown };

type RecordedQuery = {
  table: string;
  select?: string;
  eq?: [string, unknown];
  in?: [string, unknown[]];
  order?: string;
  limit?: number;
};

// vi.mock is hoisted above the imports, so the queue it reads from has to be
// hoisted too.
const state = vi.hoisted(() => ({
  queue: [] as QueryResponse[],
  queries: [] as RecordedQuery[],
}));

vi.mock("@/lib/supabase-browser", () => {
  const from = (table: string) => {
    const recorded: RecordedQuery = { table };
    state.queries.push(recorded);

    const response =
      state.queue.shift() ?? ({ data: [], error: null } as QueryResponse);

    const builder: Record<string, unknown> = {
      select: (columns: string) => {
        recorded.select = columns;
        return builder;
      },
      eq: (column: string, value: unknown) => {
        recorded.eq = [column, value];
        return builder;
      },
      in: (column: string, values: unknown[]) => {
        recorded.in = [column, values];
        return builder;
      },
      order: (column: string) => {
        recorded.order = column;
        return builder;
      },
      limit: (n: number) => {
        recorded.limit = n;
        return builder;
      },
      abortSignal: () => builder,
      returns: () => builder,
      // A PostgrestBuilder is a thenable, and the code under test awaits it.
      then: (
        resolve: (value: QueryResponse) => unknown,
        reject: (reason: unknown) => unknown
      ) => Promise.resolve(response).then(resolve, reject),
    };
    return builder;
  };

  return { supabaseBrowser: { from } };
});

const { isConcluded, readPublicCompetition } = await import(
  "@/lib/public-read"
);

const ACTIVE = {
  id: "comp-active",
  label: "Competition 2",
  status: "active",
  rollover_count: 1,
  pot_carried_in_pence: 12_000,
  winner_participant_id: null,
};

const WON = {
  id: "comp-won",
  label: "Competition 1",
  status: "won",
  rollover_count: 0,
  pot_carried_in_pence: 0,
  winner_participant_id: "participant-1",
};

const ROLLED_OVER = { ...WON, id: "comp-rolled", status: "rolled_over" };

beforeEach(() => {
  state.queue = [];
  state.queries = [];
});

describe("readPublicCompetition", () => {
  it("returns the active competition and never asks for a concluded one", async () => {
    state.queue = [{ data: [ACTIVE], error: null }];

    const { data, error } = await readPublicCompetition();

    expect(error).toBeNull();
    expect(data?.id).toBe("comp-active");
    // One query, and it asked for the active row by name rather than trusting
    // created_at ordering to put it first.
    expect(state.queries).toHaveLength(1);
    expect(state.queries[0].eq).toEqual(["status", "active"]);
  });

  it("falls back to the most recently concluded competition", async () => {
    state.queue = [
      { data: [], error: null },
      { data: [WON], error: null },
    ];

    const { data, error } = await readPublicCompetition();

    expect(error).toBeNull();
    expect(data?.id).toBe("comp-won");
    expect(data?.status).toBe("won");

    const fallback = state.queries[1];
    expect(fallback.in).toEqual(["status", ["won", "rolled_over"]]);
    expect(fallback.order).toBe("created_at");
    expect(fallback.limit).toBe(1);
  });

  it("falls back to a rolled-over competition too", async () => {
    state.queue = [
      { data: [], error: null },
      { data: [ROLLED_OVER], error: null },
    ];

    const { data } = await readPublicCompetition();

    expect(data?.status).toBe("rolled_over");
  });

  it("does not show a concluded competition when the active read fails", async () => {
    // The whole point: a database blink must read as "can't load", not as
    // "the season's over".
    state.queue = [
      { data: null, error: { message: "boom" } },
      { data: [WON], error: null },
    ];

    const { data, error } = await readPublicCompetition();

    expect(data).toBeNull();
    expect(error).toEqual({ message: "boom" });
    expect(state.queries).toHaveLength(1);
  });

  it("reports no competition at all as an empty, error-free answer", async () => {
    state.queue = [
      { data: [], error: null },
      { data: [], error: null },
    ];

    const { data, error } = await readPublicCompetition();

    expect(data).toBeNull();
    expect(error).toBeNull();
  });

  it("surfaces a failed fallback read as an error, not as emptiness", async () => {
    state.queue = [
      { data: [], error: null },
      { data: null, error: { message: "boom" } },
    ];

    const { data, error } = await readPublicCompetition();

    expect(data).toBeNull();
    expect(error).toEqual({ message: "boom" });
  });

  it("selects the winner id and nothing private", async () => {
    state.queue = [{ data: [ACTIVE], error: null }];
    await readPublicCompetition();

    const columns = state.queries[0].select ?? "";
    // The winning PERSON is what the concluded view names; the id is public
    // (competitions is anon-readable), the name is not and is looked up
    // server-side.
    expect(columns).toContain("winner_participant_id");
    for (const forbidden of ["phone", "amount_paid_pence", "club_contact"]) {
      expect(columns).not.toContain(forbidden);
    }
  });
});

describe("isConcluded", () => {
  it("is true for the two ways a competition ends", () => {
    expect(isConcluded("won")).toBe(true);
    expect(isConcluded("rolled_over")).toBe(true);
  });

  it("is false while it is running", () => {
    expect(isConcluded("active")).toBe(false);
  });
});
