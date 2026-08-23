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

      const statuses = await db.entryStatuses(competitionId);
      expect(statuses.Ann).toBe("active"); // Arsenal won
      expect(statuses.Bob).toBe("eliminated"); // a draw is not a win
      expect(statuses.Cid).toBe("active"); // postponed counts as a win
      // Dee's team was DRAWN, so whether she survives depends on which team the
      // seed gave her — asserting "active" here would be asserting the draw.
      // What must hold is that her status agrees with her pick's outcome, which
      // is the actual invariant: an assigned pick lives and dies like any other.
      const deePick = (await db.picksForRound(roundId)).find(
        (p) => p.auto_assigned === true
      )!;
      expect(statuses.Dee).toBe(
        deePick.outcome === "survived" ? "active" : "eliminated"
      );

      // Every eliminated entry records WHICH round did it; nobody else does.
      const stamped = await db.sql(
        `select p.name from entries e join participants p on p.id = e.participant_id
          where e.competition_id = $1 and e.eliminated_round_id = $2
          order by p.name`,
        [competitionId, roundId]
      );
      expect(stamped.map((r) => r.name)).toEqual(
        Object.entries(statuses)
          .filter(([, status]) => status === "eliminated")
          .map(([name]) => name)
          .sort()
      );

      const picks = await db.picksForRound(roundId);
      expect(picks).toHaveLength(4);
      // The three typed-in picks are exactly as entered.
      expect(
        picks
          .filter((p) => p.auto_assigned === false)
          .map((p) => [p.team, p.outcome])
      ).toEqual([
        ["Arsenal", "survived"],
        ["Bournemouth", "eliminated"],
        ["Chelsea", "survived"],
      ]);
      // Dee's is DRAWN, not chosen, so the team is not pinned here — what is
      // pinned is that she got one, that it is playing this matchday, and that
      // it was settled. tests/lms.test.ts pins the draw itself.
      const drawn = picks.filter((p) => p.auto_assigned === true);
      expect(drawn).toHaveLength(1);
      expect([
        "Arsenal", "Aston Villa", "Bournemouth", "Brentford",
        "Chelsea", "Crystal Palace", "Everton", "Fulham",
      ]).toContain(drawn[0].team);
      expect(["survived", "eliminated"]).toContain(drawn[0].outcome);

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

      // Matchday 2. Chelsea plays it, and is the team the postponement
      // consumed — the draw must not offer it to Cid again.
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
      // The assertion that matters, and the only one the random draw leaves
      // available: Chelsea was consumed by the POSTPONED pick even though the
      // game was never played, so it can never be drawn for Cid again.
      expect(byEntry.get(cid)).not.toBe("Chelsea");
      expect(["Everton", "Fulham", "Liverpool"]).toContain(byEntry.get(cid));
      // Eve never used Chelsea, so it stays in her pool.
      expect(["Chelsea", "Everton", "Fulham", "Liverpool"]).toContain(
        byEntry.get(eve)
      );
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
  //
  // NOT TESTED HERE, deliberately: concurrent contention on the lock. This
  // block used to hold three tests that drove two connections against each
  // other — settlement blocking on an in-flight cron write, the cron blocking
  // on an in-flight settlement, and the cron's bounded wait returning BUSY
  // having written nothing. They went with the auto-results cron when it was
  // removed before launch, and that was a disclosed coverage decision, not an
  // oversight.
  //
  // The reasoning: the lock lost its only UNATTENDED caller. The two writers
  // left are both admin buttons someone is watching, both waiting unbounded, so
  // contention resolves as "the second press waits a moment" — and the BUSY
  // protocol a contention test would assert no longer exists to assert. What
  // does still matter is the guard that outlives the wait, which the test below
  // covers: once a round is settled, a fixture write is refused rather than
  // landing in a round whose eliminations are already computed.
  //
  // Orchestrating multiple connections to simulate one organiser racing
  // themselves would cost more than it protects. If an unattended writer is
  // ever reintroduced, restore those tests from git history alongside it.
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
  // =========================================================================
  // The last two standing, across a Saturday and a Sunday
  //
  // The scenario that actually decides a competition, and the one it is worst
  // to get wrong: two entries left, their games on different days. The same
  // four cases are pinned at engine level (tests/lms.test.ts) and plan level
  // (tests/settlement-plan.test.ts); here they run against a real database,
  // through the real function, and the answer has to be identical.
  //
  //   P1 picks Aston Villa, who lose at Arsenal on the Saturday.
  //   P2 picks Chelsea, and the Sunday game is what varies.
  // =========================================================================

  describe("two entries left, Saturday and Sunday", () => {
    async function seedWeekend(
      sunday: {
        status: "scheduled" | "played" | "postponed";
        result?: "home" | "away" | "draw" | null;
      }
    ) {
      const saturdayFixture = await db.addFixture({
        matchday: 1,
        homeTeamId: team.get("Arsenal")!,
        awayTeamId: team.get("Aston Villa")!,
        status: "played",
        result: "home",
        kickoffHours: -24,
      });
      const sundayFixture = await db.addFixture({
        matchday: 1,
        homeTeamId: team.get("Chelsea")!,
        awayTeamId: team.get("Crystal Palace")!,
        status: sunday.status,
        result: sunday.result ?? null,
        // Tomorrow. The deadline was the first kick-off — Saturday's — so the
        // round is closed and settleable while this game is still to come.
        kickoffHours: 18,
      });
      const competitionId = await db.addCompetition();
      const roundId = await db.addRound({
        competitionId,
        roundNumber: 1,
        matchday: 1,
        deadlineHours: -25,
      });
      const p1Id = await db.addParticipant("P1");
      const p2Id = await db.addParticipant("P2");
      const p1 = await db.addEntry(competitionId, p1Id);
      const p2 = await db.addEntry(competitionId, p2Id);
      await db.addPick({ competitionId, entryId: p1, roundId, teamId: team.get("Aston Villa")! });
      await db.addPick({ competitionId, entryId: p2, roundId, teamId: team.get("Chelsea")! });
      return {
        competitionId,
        roundId,
        p1,
        p2,
        p1Id,
        p2Id,
        saturdayFixture,
        sundayFixture,
        sunday,
      };
    }

    /**
     * The fingerprint half of a plan for this weekend — everything
     * lms_settle_round re-checks against the database, all of it honest.
     *
     * The scenario-B tests bolt fabricated `pick_outcomes` and `end` onto this.
     * That is the point: the lie is never in the fingerprints, which is why no
     * amount of comparing the plan to the database catches it. Only asking
     * whether the Sunday game HAS a result does.
     */
    function forgedPlanBase(w: Awaited<ReturnType<typeof seedWeekend>>) {
      return {
        competition_id: w.competitionId,
        round_id: w.roundId,
        matchday: 1,
        expected_fixtures: [
          { id: w.saturdayFixture, status: "played", result: "home" },
          {
            id: w.sundayFixture,
            status: w.sunday.status,
            result: w.sunday.result ?? null,
          },
        ],
        expected_picks: [
          { entry_id: w.p1, team_id: team.get("Aston Villa")! },
          { entry_id: w.p2, team_id: team.get("Chelsea")! },
        ],
        expected_active_entry_ids: [w.p1, w.p2],
        auto_assign: [],
      };
    }

    it("A — both lose: rollover, and P2 is NOT crowned", async () => {
      const { competitionId, roundId } = await seedWeekend({
        status: "played",
        result: "away", // Palace win at Chelsea, so P2 goes out too
      });

      const result = await db.settle(
        plan(await planFromDatabase(db, competitionId, roundId))
      );

      expect(result).toMatchObject({
        ok: true,
        code: "settled",
        end_kind: "rollover",
        survivors: 0,
      });
      expect(await db.entryStatuses(competitionId)).toEqual({
        P1: "eliminated",
        P2: "eliminated",
      });
      expect(await db.competitionRow(competitionId)).toMatchObject({
        status: "rolled_over",
        winner_participant_id: null,
      });
      expect(await db.roundStatus(roundId)).toBe("settled");
    });

    // -----------------------------------------------------------------------
    // Scenario B — the Saturday-night press. P1 has lost; P2's game is
    // tomorrow. Everything below must refuse, and refuse having written
    // nothing.
    // -----------------------------------------------------------------------
    describe("B — Sunday has no result yet", () => {
      /** Neither entry has moved and the round is untouched. */
      async function expectNothingHappened(
        competitionId: string,
        roundId: string
      ) {
        expect(await db.entryStatuses(competitionId)).toEqual({
          P1: "active",
          P2: "active",
        });
        expect(await db.roundStatus(roundId)).toBe("pending");
        expect(await db.competitionRow(competitionId)).toMatchObject({
          status: "active",
          winner_participant_id: null,
        });
        const picks = await db.picksForRound(roundId);
        expect(picks.every((p) => p.outcome === "pending")).toBe(true);
      }

      it("the plan builder refuses, and NAMES the fixture it is waiting on", async () => {
        const { competitionId, roundId } = await seedWeekend({
          status: "scheduled",
        });

        const built = await planFromDatabase(db, competitionId, roundId);

        expect(built).toEqual({
          ok: false,
          reason: "unsettled",
          count: 1,
          fixtures: ["Chelsea v Crystal Palace"],
        });
        // No plan exists, so nothing was even offered to the database. This is
        // the refusal settleCurrentRound turns into "Can't settle yet — no
        // result for Chelsea v Crystal Palace".
        await expectNothingHappened(competitionId, roundId);
      });

      it("lms_settle_round refuses a plan that leaves P2's outcome out", async () => {
        const w = await seedWeekend({ status: "scheduled" });

        // What a settle-what-we-can implementation would send: P1 eliminated,
        // P2 simply not mentioned.
        const refusal = await db.settle({
          ...forgedPlanBase(w),
          pick_outcomes: [{ entry_id: w.p1, outcome: "eliminated" }],
          eliminate_entry_ids: [w.p1],
          end: { kind: "won", participant_id: w.p2Id, winner_entry_ids: [w.p2] },
        });

        expect(refusal).toMatchObject({ ok: false });
        expect(refusal.code).toBe("missing_results");
        expect(refusal).toMatchObject({
          detail: { fixtures: ["Chelsea v Crystal Palace"] },
        });
        await expectNothingHappened(w.competitionId, w.roundId);
      });

      it("lms_settle_round refuses a plan carrying a 'pending' outcome", async () => {
        const w = await seedWeekend({ status: "scheduled" });

        const refusal = await db.settle({
          ...forgedPlanBase(w),
          pick_outcomes: [
            { entry_id: w.p1, outcome: "eliminated" },
            { entry_id: w.p2, outcome: "pending" },
          ],
          eliminate_entry_ids: [w.p1],
          end: { kind: "won", participant_id: w.p2Id, winner_entry_ids: [w.p2] },
        });

        expect(refusal).toMatchObject({ ok: false, code: "missing_results" });
        await expectNothingHappened(w.competitionId, w.roundId);
      });

      it("lms_settle_round refuses a plan that CLAIMS P2 survived an unplayed game", async () => {
        // The one that cannot be caught by counting. This plan is structurally
        // perfect: the fixture fingerprint matches (the Sunday game is honestly
        // reported as scheduled), there is one settled outcome per active
        // entry, and the end state is internally consistent. Only a check that
        // looks at whether the fixture HAS a result can stop it — without which
        // P2 is crowned champion on a game that has not kicked off.
        const w = await seedWeekend({ status: "scheduled" });

        const refusal = await db.settle({
          ...forgedPlanBase(w),
          pick_outcomes: [
            { entry_id: w.p1, outcome: "eliminated" },
            { entry_id: w.p2, outcome: "survived" },
          ],
          eliminate_entry_ids: [w.p1],
          end: { kind: "won", participant_id: w.p2Id, winner_entry_ids: [w.p2] },
        });

        expect(refusal).toMatchObject({
          ok: false,
          code: "missing_results",
          detail: { fixtures: ["Chelsea v Crystal Palace"] },
        });
        await expectNothingHappened(w.competitionId, w.roundId);
      });

      it("a team missing from an INCOMPLETE matchday is waited for, not eliminated", async () => {
        // The neighbouring case, and the one that decides whether a half-loaded
        // fixture list can put somebody out.
        //
        // A team with no fixture has two possible meanings — "not playing" and
        // "not loaded yet" — and they are indistinguishable from the fixture
        // list alone. This matchday holds a handful of games out of twenty
        // clubs, so it is plainly still being loaded, and the safe reading is
        // the only one available: P2's pick stays unsettled and the whole round
        // refuses. Exactly the posture of the missing-result guard.
        //
        // (The other reading — no game, no win — is reserved for a COMPLETE
        // matchday, where an absent fixture really is an answer. See
        // isMatchdayComplete in lib/lms.ts.)
        const w = await seedWeekend({ status: "played", result: "home" });
        await db.sql("update picks set team_id = $1 where entry_id = $2", [
          team.get("Sunderland")!,
          w.p2,
        ]);

        const built = await planFromDatabase(db, w.competitionId, w.roundId);
        expect(built).toEqual({
          ok: false,
          reason: "unsettled",
          count: 1,
          fixtures: ["Sunderland (no matchday 1 fixture)"],
        });

        // Nothing was settled, so nobody went out on a fixture nobody entered.
        expect(await db.entryStatuses(w.competitionId)).toEqual({
          P1: "active",
          P2: "active",
        });
      });

      it("REFUSES a plan claiming somebody survived a game that does not exist", async () => {
        // What the missing-result guard used to cover here, kept: the engine
        // never claims a survival on a team with no fixture, so a plan that does
        // is forged or broken — and it would crown a winner on a match that was
        // never played. The last line of defence, in its new form.
        const w = await seedWeekend({ status: "played", result: "home" });
        await db.sql("update picks set team_id = $1 where entry_id = $2", [
          team.get("Sunderland")!,
          w.p2,
        ]);

        const refusal = await db.settle({
          ...forgedPlanBase(w),
          expected_picks: [
            { entry_id: w.p1, team_id: team.get("Aston Villa")! },
            { entry_id: w.p2, team_id: team.get("Sunderland")! },
          ],
          pick_outcomes: [
            { entry_id: w.p1, outcome: "eliminated" },
            { entry_id: w.p2, outcome: "survived" },
          ],
          eliminate_entry_ids: [w.p1],
          end: { kind: "won", participant_id: w.p2Id, winner_entry_ids: [w.p2] },
        });
        expect(refusal).toMatchObject({
          ok: false,
          code: "impossible_survival",
          detail: { teams: ["Sunderland"] },
        });
        await expectNothingHappened(w.competitionId, w.roundId);
      });
    });

    // -----------------------------------------------------------------------
    // Scenario C — the Sunday game is called off. P2 is the only one left, but
    // only because of a game nobody played.
    // -----------------------------------------------------------------------
    describe("C — Sunday postponed", () => {
      async function lockIt() {
        const w = await seedWeekend({ status: "postponed" });
        const result = await db.settle(
          plan(await planFromDatabase(db, w.competitionId, w.roundId))
        );
        expect(result).toMatchObject({ ok: true, code: "locked_provisional" });
        return w;
      }

      it("LOCKS the round: P2 survives, is not crowned, competition stays active", async () => {
        const { competitionId, roundId } = await lockIt();

        expect(await db.roundStatus(roundId)).toBe("locked");
        expect(await db.entryStatuses(competitionId)).toEqual({
          P1: "eliminated", // a result that stands whatever happens on Sunday
          P2: "active", // decided, but not declared
        });
        expect(await db.competitionRow(competitionId)).toMatchObject({
          status: "active",
          winner_participant_id: null,
        });
        const picks = await db.picksForRound(roundId);
        expect(picks.map((p) => [p.team, p.outcome])).toEqual([
          ["Aston Villa", "eliminated"],
          ["Chelsea", "survived"],
        ]);
      });

      it("re-settles as a WIN once the rearranged game is played and won", async () => {
        const { competitionId, roundId, p2Id, sundayFixture } = await lockIt();

        expect(await db.setFixtureResult(sundayFixture, "played", "home")).toMatchObject({
          ok: true,
        });

        const result = await db.settle(
          plan(await planFromDatabase(db, competitionId, roundId))
        );

        expect(result).toMatchObject({ ok: true, code: "settled", end_kind: "won" });
        expect(await db.roundStatus(roundId)).toBe("settled");
        expect(await db.entryStatuses(competitionId)).toEqual({
          P1: "eliminated",
          P2: "winner",
        });
        expect(await db.competitionRow(competitionId)).toMatchObject({
          status: "won",
          winner_participant_id: p2Id,
        });
      });

      it("re-settles as a ROLLOVER once the rearranged game is played and lost", async () => {
        // The reason the round was only locked. P2 was one result away from the
        // pot; the result went the other way and nobody wins it.
        const { competitionId, roundId, sundayFixture } = await lockIt();

        expect(await db.setFixtureResult(sundayFixture, "played", "away")).toMatchObject({
          ok: true,
        });

        const result = await db.settle(
          plan(await planFromDatabase(db, competitionId, roundId))
        );

        expect(result).toMatchObject({
          ok: true,
          code: "settled",
          end_kind: "rollover",
          survivors: 0,
        });
        expect(await db.roundStatus(roundId)).toBe("settled");
        expect(await db.entryStatuses(competitionId)).toEqual({
          P1: "eliminated",
          P2: "eliminated",
        });
        expect(await db.competitionRow(competitionId)).toMatchObject({
          status: "rolled_over",
          winner_participant_id: null,
        });
      });
    });

    it("D — P2 wins on the Sunday: crowned, competition won", async () => {
      const { competitionId, roundId, p2Id } = await seedWeekend({
        status: "played",
        result: "home", // Chelsea win
      });

      const result = await db.settle(
        plan(await planFromDatabase(db, competitionId, roundId))
      );

      expect(result).toMatchObject({
        ok: true,
        code: "settled",
        end_kind: "won",
        survivors: 1,
      });
      expect(await db.entryStatuses(competitionId)).toEqual({
        P1: "eliminated",
        P2: "winner",
      });
      expect(await db.competitionRow(competitionId)).toMatchObject({
        status: "won",
        winner_participant_id: p2Id,
      });
      expect(await db.roundStatus(roundId)).toBe("settled");
    });
  });
});
