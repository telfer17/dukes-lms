import { beforeEach, describe, expect, it, vi } from "vitest";

// setPickForEntry is the ONLY door a pick comes through now, and it is driven
// from a row on a phone. Its reads can THROW rather than return an error —
// lib/lms-db fails loudly, and an entryId that isn't a uuid reaches Postgres as
// a type error — so a throw that escapes leaves the organiser looking at a
// generic boundary message with nothing beside the entrant they were trying to
// enter. These tests pin that every read failure comes back as ActionState,
// which is what AdminEntryRow renders inline under the row.

const h = vi.hoisted(() => {
  const round = {
    id: "r1",
    competition_id: "c1",
    round_number: 1,
    matchday: 1,
    status: "pending" as const,
    deadline: "2099-01-01T00:00:00.000Z",
    created_at: "",
  };
  const entry = {
    id: "e1",
    competition_id: "c1",
    participant_id: "p1",
    paid: true,
    amount_paid_pence: 1000,
    is_newcomer: false,
    status: "active" as const,
    eliminated_round_id: null,
    joined_at: "",
    participant: {
      id: "p1",
      name: "Alice",
      phone: null,
      club_contact: null,
      created_at: "",
    },
  };

  // Each read is swappable per test, so a throw can be planted at any depth.
  // Rebuilt before every test — a planted throw must not leak into the next.
  const defaults = () => ({
    getActiveCompetition: async () => ({
      id: "c1",
      label: "Test",
      status: "active",
      rollover_count: 0,
      pot_carried_in_pence: 0,
      winner_participant_id: null,
      created_at: "",
    }),
    getEntry: async () => entry,
    getRounds: async () => [round],
    getFixturesForMatchday: async () => [
      {
        id: 1,
        matchday: 1,
        home_team_id: 1,
        away_team_id: 2,
        status: "scheduled",
        result: null,
        kickoff: "2099-01-01T00:00:00.000Z",
      },
    ],
    getTeams: async () => [
      { id: 1, name: "Arsenal" },
      { id: 2, name: "Aston Villa" },
    ],
    getPicksForEntry: async () => [],
  });

  const reads = defaults();
  const upsert = vi.fn(async () => ({ error: null }));

  return { reads, defaults, upsert, round, entry };
});

// importOriginal below pulls in the REAL lib/lms-db, which imports
// lib/supabase-server, which imports "server-only" — a module that throws
// outside a React Server Component. Neutralised here so the pure helpers in
// lms-db can be used as-is.
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: async () => {} }));
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: () => ({ upsert: h.upsert }) },
}));
vi.mock("@/lib/lms-db", async (importOriginal) => ({
  // currentRound and pickHistoryTeamIds are pure — keep the real ones so the
  // action's round selection and history logic are genuinely exercised.
  ...(await importOriginal<typeof import("@/lib/lms-db")>()),
  getActiveCompetition: () => h.reads.getActiveCompetition(),
  getEntry: () => h.reads.getEntry(),
  getRounds: () => h.reads.getRounds(),
  getFixturesForMatchday: () => h.reads.getFixturesForMatchday(),
  getTeams: () => h.reads.getTeams(),
  getPicksForEntry: () => h.reads.getPicksForEntry(),
}));

const { setPickForEntry } = await import("@/app/admin/entrants/actions");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const good = { entry_id: "e1", round_id: "r1", team_id: "1" };

describe("setPickForEntry read failures", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    Object.assign(h.reads, h.defaults());
    h.upsert.mockClear();
  });

  it("saves normally when every read succeeds", async () => {
    const result = await setPickForEntry(null, form(good));
    expect(result).toEqual({ ok: "Alice: Arsenal saved." });
    expect(h.upsert).toHaveBeenCalled();
  });

  // docs/LMS-RULES.md § Editing after the lock. Correcting a randomly-assigned
  // pick to the player's real choice must STRIP the auto marker: the pick is a
  // person's choice now, and the board says "auto" only where the site actually
  // drew the team. The upsert overwrites the existing row for (entry, round),
  // so this flag is what decides whether the marker survives the edit.
  it("writes auto_assigned = false, so editing an assigned pick clears the marker", async () => {
    await setPickForEntry(null, form(good));

    expect(h.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        entry_id: "e1",
        round_id: "r1",
        team_id: 1,
        auto_assigned: false,
        outcome: "pending",
      }),
      { onConflict: "entry_id,round_id" }
    );
  });

  // One case per read, because the try/catch has to cover the whole sequence
  // and not just the first await — a throw four reads deep is the likelier one.
  const reads = [
    "getActiveCompetition",
    "getEntry",
    "getRounds",
    "getFixturesForMatchday",
    "getTeams",
    "getPicksForEntry",
  ] as const;

  for (const read of reads) {
    it(`returns an inline error instead of throwing when ${read} throws`, async () => {
      h.reads[read] = async () => {
        throw new Error(`${read} failed`);
      };
      const result = await setPickForEntry(null, form(good));
      expect(result).toEqual({
        error: "Could not save that pick — please try again.",
      });
    });
  }

  it("catches a malformed entryId rather than letting it escape", async () => {
    // What Postgres actually does with a non-uuid id: lib/lms-db turns the
    // 22P02 into a throw, which used to leave the action with no answer.
    h.reads.getEntry = async () => {
      throw new Error('invalid input syntax for type uuid: "not-a-uuid"');
    };
    const result = await setPickForEntry(
      null,
      form({ ...good, entry_id: "not-a-uuid" })
    );
    expect(result).toEqual({
      error: "Could not save that pick — please try again.",
    });
  });

  it("never writes when a read failed", async () => {
    h.reads.getTeams = async () => {
      throw new Error("teams failed");
    };
    await setPickForEntry(null, form(good));
    expect(h.upsert).not.toHaveBeenCalled();
  });
});
