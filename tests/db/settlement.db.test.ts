// Settlement, end to end, against a real Postgres.
//
// See tests/db/harness.ts for how to run these (and why they skip themselves
// when there is no database).
//
// Everything here goes through the production path: the real schema, the real
// plan builder (lib/settlement-plan.ts, driving the real engine in lib/lms.ts),
// and the real lms_settle_round / lms_apply_fixture_results /
// lms_set_fixture_result functions from db/settlement-fn.sql. Nothing is
// re-implemented for the test.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  hasDatabase,
  planFromDatabase,
  SKIP_NOTICE,
  TestDb,
  type Row,
} from "./harness";
import type { PlanOutcome, SettlementPlan } from "@/lib/settlement-plan";

const SUITE = hasDatabase
  ? "settlement (integration, real Postgres)"
  : `settlement (integration) — ${SKIP_NOTICE}`;

if (!hasDatabase) {
  // The default reporter counts skipped tests but does not say why. Settlement
  // is the part of this app most worth proving, so a run that proved none of it
  // should say so out loud rather than leaving a green tick to be misread.
  console.warn(`\n⚠  tests/db/settlement.db.test.ts: ${SKIP_NOTICE}\n`);
}

describe.skipIf(!hasDatabase)(SUITE, () => {
  let db: TestDb;
  let team: Map<string, number>;

  beforeAll(async () => {
    db = await TestDb.connect();
    await db.applySchema();
    team = await db.teamIds();
  });

  afterAll(async () => {
    await db?.end();
  });

  beforeEach(async () => {
    await db.reset();
  });

  /** Narrow a plan outcome, failing loudly with the reason if it refused. */
  function plan(outcome: PlanOutcome): SettlementPlan {
    if (!outcome.ok) {
      throw new Error(`expected a plan, got refusal: ${outcome.reason}`);
    }
    return outcome.plan;
  }

  /**
   * The world of a single matchday: four fixtures covering every outcome the
   * rules distinguish — a home win, a draw, a postponement, and an away win.
   */
  async function seedMatchday1() {
    return {
      arsenal: await db.addFixture({
        matchday: 1,
        homeTeamId: team.get("Arsenal")!,
        awayTeamId: team.get("Aston Villa")!,
        status: "played",
        result: "home",
      }),
      draw: await db.addFixture({
        matchday: 1,
        homeTeamId: team.get("Bournemouth")!,
        awayTeamId: team.get("Brentford")!,
        status: "played",
        result: "draw",
      }),
      postponed: await db.addFixture({
        matchday: 1,
        homeTeamId: team.get("Chelsea")!,
        awayTeamId: team.get("Crystal Palace")!,
        status: "postponed",
      }),
      awayWin: await db.addFixture({
        matchday: 1,
        homeTeamId: team.get("Everton")!,
        awayTeamId: team.get("Fulham")!,
        status: "played",
        result: "away",
      }),
    };
  }

  // =========================================================================
  // Full lifecycle
  // =========================================================================

  describe("a full round", () => {
    it("eliminates a draw, survives a postponement, and auto-assigns a missed pick", async () => {
      await seedMatchday1();
      const competitionId = await db.addCompetition();
      const roundId = await db.addRound({
        competitionId,
        roundNumber: 1,
        matchday: 1,
      });

      const ann = await db.addEntry(competitionId, await db.addParticipant("Ann"));
      const bob = await db.addEntry(competitionId, await db.addParticipant("Bob"));
      const cid = await db.addEntry(competitionId, await db.addParticipant("Cid"));
      // Dee never picks — auto-assign has to cover her.
      await db.addEntry(competitionId, await db.addParticipant("Dee"));

      await db.addPick({ competitionId, entryId: ann, roundId, teamId: team.get("Arsenal")! });
      await db.addPick({ competitionId, entryId: bob, roundId, teamId: team.get("Bournemouth")! });
      await db.addPick({ competitionId, entryId: cid, roundId, teamId: team.get("Chelsea")! });

      const result = await db.settle(
        plan(await planFromDatabase(db, competitionId, roundId))
      );

      expect(result).toMatchObject({ ok: true, code: "settled", end_kind: "continue" });
      expect(await db.roundStatus(roundId)).toBe("settled");
      expect(await db.entryStatuses(competitionId)).toEqual({
        Ann: "active", // Arsenal won
        Bob: "eliminated", // a draw is not a win
        Cid: "active", // postponed counts as a win
        Dee: "active", // auto-assigned Arsenal, which won
      });

      // The eliminated entry records WHICH round did it; nobody else does.
      const stamped = await db.sql(
        `select p.name from entries e join participants p on p.id = e.participant_id
          where e.competition_id = $1 and e.eliminated_round_id = $2`,
        [competitionId, roundId]
      );
      expect(stamped.map((r) => r.name)).toEqual(["Bob"]);

      const picks = await db.picksForRound(roundId);
      expect(picks).toHaveLength(4);
      expect(picks.map((p) => [p.team, p.outcome, p.auto_assigned])).toEqual([
        ["Arsenal", "survived", false],
        ["Arsenal", "survived", true], // Dee, first alphabetically and playing
        ["Bournemouth", "eliminated", false],
        ["Chelsea", "survived", false],
      ]);

      // The competition itself is untouched by a round that merely continues.
      expect(await db.competitionRow(competitionId)).toMatchObject({
        status: "active",
        winner_participant_id: null,
      });
    });

    it("counts a postponed pick's team as USED in later rounds", async () => {
      await seedMatchday1();
      const competitionId = await db.addCompetition();
      const round1 = await db.addRound({
        competitionId,
        roundNumber: 1,
        matchday: 1,
      });
      const cid = await db.addEntry(competitionId, await db.addParticipant("Cid"));
      const eve = await db.addEntry(competitionId, await db.addParticipant("Eve"));
      await db.addPick({ competitionId, entryId: cid, roundId: round1, teamId: team.get("Chelsea")! });
      await db.addPick({ competitionId, entryId: eve, roundId: round1, teamId: team.get("Arsenal")! });

      await db.settle(plan(await planFromDatabase(db, competitionId, round1)));

      // Matchday 2, where Chelsea is the alphabetically FIRST team playing.
      await db.addFixture({
        matchday: 2,
        homeTeamId: team.get("Chelsea")!,
        awayTeamId: team.get("Everton")!,
        status: "played",
        result: "home",
      });
      await db.addFixture({
        matchday: 2,
        homeTeamId: team.get("Fulham")!,
        awayTeamId: team.get("Liverpool")!,
        status: "played",
        result: "home",
      });
      const round2 = await db.addRound({
        competitionId,
        roundNumber: 2,
        matchday: 2,
      });

      // Neither picks, so both get auto-assigned.
      await db.settle(plan(await planFromDatabase(db, competitionId, round2)));

      const picks = await db.picksForRound(round2);
      const byEntry = new Map(picks.map((p) => [p.entry_id as string, p.team as string]));
      // Chelsea was consumed by the POSTPONED pick even though the game was
      // never played — so Cid skips past it to Everton.
      expect(byEntry.get(cid)).toBe("Everton");
      // Eve never used Chelsea, so she gets it.
      expect(byEntry.get(eve)).toBe("Chelsea");
    });
  });

  // =========================================================================
  // End states
  // =========================================================================

  describe("end states", () => {
    it("records ONE winner when the last entries all belong to the same person", async () => {
      await seedMatchday1();
      const competitionId = await db.addCompetition();
      const roundId = await db.addRound({ competitionId, roundNumber: 1, matchday: 1 });

      const annId = await db.addParticipant("Ann");
      const ann1 = await db.addEntry(competitionId, annId);
      const ann2 = await db.addEntry(competitionId, annId);
      const bob = await db.addEntry(competitionId, await db.addParticipant("Bob"));

      // Both of Ann's entries survive on different teams; Bob goes out.
      await db.addPick({ competitionId, entryId: ann1, roundId, teamId: team.get("Arsenal")! });
      await db.addPick({ competitionId, entryId: ann2, roundId, teamId: team.get("Fulham")! });
      await db.addPick({ competitionId, entryId: bob, roundId, teamId: team.get("Chelsea")! });
      // Chelsea's game is postponed by default in the seed — give Bob a real
      // loss instead so the win is not provisional.
      await db.sql("update picks set team_id = $1 where entry_id = $2", [
        team.get("Everton")!,
        bob,
      ]);

      const result = await db.settle(
        plan(await planFromDatabase(db, competitionId, roundId))
      );

      expect(result).toMatchObject({ ok: true, code: "settled", end_kind: "won" });
      expect(await db.entryStatuses(competitionId)).toEqual({
        Ann: "winner", // both of Ann's entries — the map keys by name
        Bob: "eliminated",
      });

      // Winner-takes-all: TWO winning entries, ONE winning person.
      const winners = await db.sql(
        "select count(*)::int as n from entries where competition_id = $1 and status = 'winner'",
        [competitionId]
      );
      expect(winners[0].n).toBe(2);
      expect(await db.competitionRow(competitionId)).toMatchObject({
        status: "won",
        winner_participant_id: annId,
      });
      expect(await db.roundStatus(roundId)).toBe("settled");
    });

    it("rolls the competition over when everyone goes out in the same round", async () => {
      await seedMatchday1();
      const competitionId = await db.addCompetition();
      const roundId = await db.addRound({ competitionId, roundNumber: 1, matchday: 1 });

      const ann = await db.addEntry(competitionId, await db.addParticipant("Ann"));
      const bob = await db.addEntry(competitionId, await db.addParticipant("Bob"));
      // Aston Villa lost; Brentford drew. Both are out.
      await db.addPick({ competitionId, entryId: ann, roundId, teamId: team.get("Aston Villa")! });
      await db.addPick({ competitionId, entryId: bob, roundId, teamId: team.get("Brentford")! });

      const result = await db.settle(
        plan(await planFromDatabase(db, competitionId, roundId))
      );

      expect(result).toMatchObject({ ok: true, code: "settled", end_kind: "rollover" });
      expect(await db.entryStatuses(competitionId)).toEqual({
        Ann: "eliminated",
        Bob: "eliminated",
      });
      // No winner on a rollover — the pot carries, nobody is paid.
      expect(await db.competitionRow(competitionId)).toMatchObject({
        status: "rolled_over",
        winner_participant_id: null,
      });
      expect(await db.roundStatus(roundId)).toBe("settled");
    });
  });

  // =========================================================================
  // The provisional win — "you cannot win outright on a postponed game"
  // =========================================================================

  describe("a win resting only on a postponed fixture", () => {
    /** Ann survives on the postponed game alone; Bob is genuinely out. */
    async function seedProvisional() {
      await seedMatchday1();
      const competitionId = await db.addCompetition();
      const roundId = await db.addRound({ competitionId, roundNumber: 1, matchday: 1 });
      const annId = await db.addParticipant("Ann");
      const ann = await db.addEntry(competitionId, annId);
      const bob = await db.addEntry(competitionId, await db.addParticipant("Bob"));
      await db.addPick({ competitionId, entryId: ann, roundId, teamId: team.get("Chelsea")! });
      await db.addPick({ competitionId, entryId: bob, roundId, teamId: team.get("Aston Villa")! });
      return { competitionId, roundId, annId };
    }

    it("LOCKS the round instead of settling it, and crowns nobody", async () => {
      const { competitionId, roundId } = await seedProvisional();

      const result = await db.settle(
        plan(await planFromDatabase(db, competitionId, roundId))
      );

      expect(result).toMatchObject({ ok: true, code: "locked_provisional" });
      // Locked, NOT settled: still the current round, picks stay closed, and it
      // can be settled again once the game is played.
      expect(await db.roundStatus(roundId)).toBe("locked");
      expect(await db.competitionRow(competitionId)).toMatchObject({
        status: "active",
        winner_participant_id: null,
      });
      expect(await db.entryStatuses(competitionId)).toEqual({
        Ann: "active", // decided, but not declared
        Bob: "eliminated",
      });
      // The round's real work still happened in the same transaction.
      const picks = await db.picksForRound(roundId);
      expect(picks.map((p) => [p.team, p.outcome])).toEqual([
        ["Aston Villa", "eliminated"],
        ["Chelsea", "survived"],
      ]);
    });

    it("settles properly once the postponed game is played", async () => {
      const { competitionId, roundId, annId } = await seedProvisional();
      await db.settle(plan(await planFromDatabase(db, competitionId, roundId)));
      expect(await db.roundStatus(roundId)).toBe("locked");

      // The game is replayed and Chelsea win it. The round is not settled, so
      // the fixture guard lets this through.
      const fixture = await db.value<number>(
        "select id from fixtures where matchday = 1 and status = 'postponed'"
      );
      expect(await db.setFixtureResult(fixture, "played", "home")).toMatchObject({
        ok: true,
      });

      // Re-settling a LOCKED round is expected, not an error.
      const result = await db.settle(
        plan(await planFromDatabase(db, competitionId, roundId))
      );

      expect(result).toMatchObject({ ok: true, code: "settled", end_kind: "won" });
      expect(await db.roundStatus(roundId)).toBe("settled");
      expect(await db.entryStatuses(competitionId)).toEqual({
        Ann: "winner",
        Bob: "eliminated",
      });
      expect(await db.competitionRow(competitionId)).toMatchObject({
        status: "won",
        winner_participant_id: annId,
      });
    });
  });

  // =========================================================================
  // Idempotency
  // =========================================================================

  it("refuses to settle a round twice", async () => {
    await seedMatchday1();
    const competitionId = await db.addCompetition();
    const roundId = await db.addRound({ competitionId, roundNumber: 1, matchday: 1 });
    const ann = await db.addEntry(competitionId, await db.addParticipant("Ann"));
    const bob = await db.addEntry(competitionId, await db.addParticipant("Bob"));
    await db.addPick({ competitionId, entryId: ann, roundId, teamId: team.get("Arsenal")! });
    await db.addPick({ competitionId, entryId: bob, roundId, teamId: team.get("Fulham")! });

    const settlementPlan = plan(await planFromDatabase(db, competitionId, roundId));
    expect(await db.settle(settlementPlan)).toMatchObject({ ok: true });

    const before = await db.picksForRound(roundId);
    // The very same plan again — what a double-click, or a retry after a
    // timeout, would send.
    const second = await db.settle(settlementPlan);

    expect(second).toMatchObject({ ok: false, code: "already_settled" });
    expect(await db.picksForRound(roundId)).toEqual(before);
    expect(await db.roundStatus(roundId)).toBe("settled");
  });

  // =========================================================================
  // Atomicity — the whole point of the RPC
  // =========================================================================

  describe("atomicity", () => {
    /**
     * Ann holds two entries, one of which never picked (so a settle has an
     * INSERT to do as well as UPDATEs), and Bob is on his way out. Settling
     * this wins the competition for Ann.
     */
    async function seedWinnable() {
      await seedMatchday1();
      const competitionId = await db.addCompetition();
      const roundId = await db.addRound({ competitionId, roundNumber: 1, matchday: 1 });
      const annId = await db.addParticipant("Ann");
      const ann1 = await db.addEntry(competitionId, annId);
      const ann2 = await db.addEntry(competitionId, annId); // no pick
      const bob = await db.addEntry(competitionId, await db.addParticipant("Bob"));
      await db.addPick({ competitionId, entryId: ann1, roundId, teamId: team.get("Fulham")! });
      await db.addPick({ competitionId, entryId: bob, roundId, teamId: team.get("Everton")! });
      return { competitionId, roundId, annId, ann1, ann2, bob };
    }

    /** Nothing about the round has moved. */
    async function expectUntouched(competitionId: string, roundId: string) {
      expect(await db.roundStatus(roundId)).toBe("pending");
      expect(await db.competitionRow(competitionId)).toMatchObject({
        status: "active",
        winner_participant_id: null,
      });
      const statuses = await db.entryStatuses(competitionId);
      expect(new Set(Object.values(statuses))).toEqual(new Set(["active"]));
      const picks = await db.picksForRound(roundId);
      // No auto-assigned row was created and no outcome was written.
      expect(picks.every((p) => p.auto_assigned === false)).toBe(true);
      expect(picks.every((p) => p.outcome === "pending")).toBe(true);
      return picks;
    }

    it("applies NOTHING when a fixture result changed after the plan was built", async () => {
      const { competitionId, roundId } = await seedWinnable();
      const stale = plan(await planFromDatabase(db, competitionId, roundId));

      // Someone enters the postponed game's result while the organiser was
      // reading the page. Every outcome in `stale` is now suspect.
      await db.sql(
        "update fixtures set status = 'played', result = 'home' where matchday = 1 and status = 'postponed'"
      );

      expect(await db.settle(stale)).toMatchObject({
        ok: false,
        code: "fixtures_changed",
      });
      const picks = await expectUntouched(competitionId, roundId);
      expect(picks).toHaveLength(2);
    });

    it("applies NOTHING when a pick landed after the plan was built", async () => {
      const { competitionId, roundId, ann2 } = await seedWinnable();
      const stale = plan(await planFromDatabase(db, competitionId, roundId));
      expect(stale.auto_assign).toHaveLength(1); // ann2 was going to be assigned

      // ann2's pick arrives late — the plan would have overwritten it with an
      // auto-assignment.
      await db.addPick({
        competitionId,
        entryId: ann2,
        roundId,
        teamId: team.get("Arsenal")!,
      });

      expect(await db.settle(stale)).toMatchObject({
        ok: false,
        code: "picks_changed",
      });
      const picks = await expectUntouched(competitionId, roundId);
      expect(picks).toHaveLength(3);
    });

    it("applies NOTHING when an entry changed after the plan was built", async () => {
      const { competitionId, roundId } = await seedWinnable();
      const stale = plan(await planFromDatabase(db, competitionId, roundId));

      // A fourth entry is added by the organiser mid-settle.
      await db.addEntry(competitionId, await db.addParticipant("Zed"));

      expect(await db.settle(stale)).toMatchObject({
        ok: false,
        code: "entries_changed",
      });
      await expectUntouched(competitionId, roundId);
    });

    it("rolls back EVERY write when the transaction fails at COMMIT", async () => {
      // This is the real atomicity proof. The refusals above are decided before
      // the first write, so "nothing was applied" is almost free. Here the
      // function runs to completion — inserting the auto-assigned pick, writing
      // outcomes, eliminating Bob, marking the competition won — and only THEN
      // fails, on the deferred won-integrity trigger at COMMIT.
      //
      // Before the RPC existed this was the exact state that could not be
      // undone: the old code wrote entries and the competition in separate
      // requests and carried a self-heal for landing between them. That repair
      // path has been deleted, and this test is why it is safe to have deleted
      // it.
      const { competitionId, roundId } = await seedWinnable();
      const good = plan(await planFromDatabase(db, competitionId, roundId));
      expect(good.end.kind).toBe("won");
      expect(good.auto_assign).toHaveLength(1);

      // Structurally valid, semantically impossible: a won competition naming a
      // winner who holds no winning entry. Validation cannot catch it; the
      // deferred trigger does, at COMMIT, after everything has been written.
      const doomed = {
        ...good,
        end: { ...good.end, winner_entry_ids: [] },
      };

      await expect(db.settle(doomed)).rejects.toThrow(/marked won/);

      const picks = await expectUntouched(competitionId, roundId);
      // The INSERT is gone too — not just the updates.
      expect(picks).toHaveLength(2);

      // And the round is still settleable, which is the point of rolling back
      // rather than half-applying.
      const result = await db.settle(
        plan(await planFromDatabase(db, competitionId, roundId))
      );
      expect(result).toMatchObject({ ok: true, end_kind: "won" });
    });
  });

  // =========================================================================
  // The lock: fixture writes vs settlement
  // =========================================================================

  describe("manual result writes and settlement cannot interleave", () => {
    /**
     * A matchday where every PICKED fixture has a result and one unpicked
     * fixture is still without one. That combination is what makes a race
     * possible at all: the round is settleable AND there is a fixture write
     * still to come.
     */
    async function seedContended() {
      const decided = await db.addFixture({
        matchday: 1,
        homeTeamId: team.get("Arsenal")!,
        awayTeamId: team.get("Aston Villa")!,
        status: "played",
        result: "home",
      });
      const pendingFixture = await db.addFixture({
        matchday: 1,
        homeTeamId: team.get("Bournemouth")!,
        awayTeamId: team.get("Brentford")!,
        status: "scheduled",
      });
      const competitionId = await db.addCompetition();
      const roundId = await db.addRound({ competitionId, roundNumber: 1, matchday: 1 });
      const ann = await db.addEntry(competitionId, await db.addParticipant("Ann"));
      const cid = await db.addEntry(competitionId, await db.addParticipant("Cid"));
      const bob = await db.addEntry(competitionId, await db.addParticipant("Bob"));
      await db.addPick({ competitionId, entryId: ann, roundId, teamId: team.get("Arsenal")! });
      await db.addPick({ competitionId, entryId: cid, roundId, teamId: team.get("Arsenal")! });
      await db.addPick({ competitionId, entryId: bob, roundId, teamId: team.get("Aston Villa")! });
      return { competitionId, roundId, decided, pendingFixture };
    }

    it("refuses a manual result edit once the round is settled", async () => {
      const { competitionId, roundId, decided } = await seedContended();
      await db.settle(plan(await planFromDatabase(db, competitionId, roundId)));
      expect(await db.roundStatus(roundId)).toBe("settled");

      const refusal = (await db.setFixtureResult(decided, "played", "away")) as Row;
      expect(refusal).toMatchObject({
        ok: false,
        code: "round_settled",
        round_number: 1,
      });
      // People went out on this result. It stands.
      expect(await db.fixtureRow(decided)).toMatchObject({
        status: "played",
        result: "home",
      });
    });
  });
});
