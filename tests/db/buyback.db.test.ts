// Buy-back against a REAL Postgres: the table, its trigger, lms_buy_back_entry
// and lms_finalise_competition, driven by the same plan builders the admin uses.
//
// The unit tests prove the RULES (tests/buyback.test.ts) and the PLANS
// (tests/settlement-plan.test.ts). What only a database can prove is the part
// that makes buy-back safe to run: that the two writes are one transaction,
// that a wiped-out field does NOT roll the competition over on the spot, that
// the window is re-checked against the database's own clock, and that a
// buy-back landing mid-finalisation refuses instead of applying.
//
// See tests/db/harness.ts for how to run these (LMS_TEST_DATABASE_URL).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  finalisationPlanFromDatabase,
  hasDatabase,
  planFromDatabase,
  SKIP_NOTICE,
  TestDb,
} from "./harness";
import type { PlanOutcome, SettlementPlan } from "@/lib/settlement-plan";

const suite = hasDatabase ? describe : describe.skip;

suite(hasDatabase ? "buy-back (integration)" : SKIP_NOTICE, () => {
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

  function plan(outcome: PlanOutcome): SettlementPlan {
    if (!outcome.ok) {
      throw new Error(`expected a plan, got refusal: ${outcome.reason}`);
    }
    return outcome.plan;
  }

  /** Two matchdays: everything in matchday 1 goes wrong, matchday 2 is winnable. */
  async function seedFixtures() {
    await db.addFixture({
      matchday: 1,
      homeTeamId: team.get("Arsenal")!,
      awayTeamId: team.get("Aston Villa")!,
      status: "played",
      result: "home",
    });
    await db.addFixture({
      matchday: 1,
      homeTeamId: team.get("Bournemouth")!,
      awayTeamId: team.get("Brentford")!,
      status: "played",
      result: "draw",
    });
    await db.addFixture({
      matchday: 2,
      homeTeamId: team.get("Chelsea")!,
      awayTeamId: team.get("Crystal Palace")!,
      status: "played",
      result: "home",
    });
    await db.addFixture({
      matchday: 2,
      homeTeamId: team.get("Everton")!,
      awayTeamId: team.get("Fulham")!,
      status: "played",
      result: "draw",
    });
  }

  /**
   * The situation the whole rule is about: round 1 wipes out the field, and
   * round 2's deadline — the buy-back window — is still to come.
   */
  async function wipeoutInRoundOne() {
    await seedFixtures();
    const competitionId = await db.addCompetition();
    const round1 = await db.addRound({
      competitionId,
      roundNumber: 1,
      matchday: 1,
      deadlineHours: -4,
    });
    const round2 = await db.addRound({
      competitionId,
      roundNumber: 2,
      matchday: 2,
      deadlineHours: 4, // window OPEN
    });

    const annId = await db.addParticipant("Ann");
    const bobId = await db.addParticipant("Bob");
    const ann = await db.addEntry(competitionId, annId);
    const bob = await db.addEntry(competitionId, bobId);

    // Aston Villa lost, Brentford drew: both out in round 1.
    await db.addPick({
      competitionId,
      entryId: ann,
      roundId: round1,
      teamId: team.get("Aston Villa")!,
    });
    await db.addPick({
      competitionId,
      entryId: bob,
      roundId: round1,
      teamId: team.get("Brentford")!,
    });

    return { competitionId, round1, round2, ann, bob, annId, bobId };
  }

  /** Wind a round's deadline into the past — the window shutting. */
  async function closeWindow(roundId: string) {
    await db.sql(
      "update rounds set deadline = now() - interval '1 hour' where id = $1",
      [roundId]
    );
  }

  // =========================================================================
  // A wiped-out field does not roll over on the spot
  // =========================================================================

  describe("settling a round that wipes out the field", () => {
    it("settles the ROUND and leaves the COMPETITION active and pending", async () => {
      const { competitionId, round1 } = await wipeoutInRoundOne();

      const result = await db.settle(
        plan(await planFromDatabase(db, competitionId, round1))
      );

      expect(result).toMatchObject({ ok: true, code: "settled" });
      expect(result.end_kind).toBe("pending");

      // The round is done…
      expect(await db.roundStatus(round1)).toBe("settled");
      expect(await db.entryStatuses(competitionId)).toEqual({
        Ann: "eliminated",
        Bob: "eliminated",
      });
      // …and the competition is emphatically NOT rolled over. This is the rule.
      expect(await db.competitionRow(competitionId)).toMatchObject({
        status: "active",
        winner_participant_id: null,
      });
    });

    it("rolls over on the spot when there is no window to wait for", async () => {
      const { competitionId, round1, round2 } = await wipeoutInRoundOne();
      await closeWindow(round2);

      const result = await db.settle(
        plan(await planFromDatabase(db, competitionId, round1))
      );

      expect(result).toMatchObject({ ok: true, end_kind: "rollover" });
      expect(await db.competitionRow(competitionId)).toMatchObject({
        status: "rolled_over",
      });
    });
  });

  // =========================================================================
  // lms_buy_back_entry
  // =========================================================================

  describe("lms_buy_back_entry", () => {
    async function settledWipeout() {
      const seeded = await wipeoutInRoundOne();
      await db.settle(
        plan(await planFromDatabase(db, seeded.competitionId, seeded.round1))
      );
      return seeded;
    }

    it("takes the £10, brings the entry back, and leaves its picks alone", async () => {
      const { competitionId, round1, round2, ann } = await settledWipeout();

      const before = await db.sql(
        "select team_id from picks where entry_id = $1",
        [ann]
      );

      const result = await db.buyBack(ann, round2);
      expect(result).toMatchObject({
        ok: true,
        code: "bought_back",
        round_number: 2,
        eliminated_round_number: 1,
      });

      expect(await db.entryStatuses(competitionId)).toEqual({
        Ann: "active",
        Bob: "eliminated",
      });

      // The money trail: its own row, its own £10, nothing added to the entry's
      // own buy-in.
      expect(await db.buybackRows(competitionId)).toEqual([
        {
          entry_id: ann,
          paid: true,
          amount_paid_pence: 1000,
          eliminated_round_number: 1,
          for_round_number: 2,
        },
      ]);
      expect(
        await db.one(
          "select amount_paid_pence from entries where id = $1",
          [ann]
        )
      ).toEqual({ amount_paid_pence: 1000 });

      // USED TEAMS PERSIST — the picks are untouched, including the one that
      // put this entry out.
      expect(await db.sql("select team_id from picks where entry_id = $1", [ann]))
        .toEqual(before);

      // The elimination is not lost by clearing eliminated_round_id: the
      // buyback row is now its record.
      expect(
        await db.one("select status, eliminated_round_id from entries where id = $1", [
          ann,
        ])
      ).toEqual({ status: "active", eliminated_round_id: null });
      expect(round1).toBeTruthy();
    });

    it("a bought-back entry cannot re-pick the team that put it out", async () => {
      const { competitionId, round2, ann } = await settledWipeout();
      await db.buyBack(ann, round2);

      const { availableTeams } = await import("@/lib/lms");
      const teams = (await db.sql("select id, name from teams order by name")).map(
        (t) => ({ id: Number(t.id), name: t.name as string })
      );
      const history = (
        await db.sql(
          `select p.team_id from picks p
             join rounds r on r.id = p.round_id
            where p.entry_id = $1 order by r.round_number`,
          [ann]
        )
      ).map((p) => Number(p.team_id));

      const names = availableTeams(history, teams).map((t) => t.name);
      expect(names).not.toContain("Aston Villa");
      expect(competitionId).toBeTruthy();
    });

    it("refuses a second buy-back for the same elimination", async () => {
      const { round2, ann } = await settledWipeout();

      expect(await db.buyBack(ann, round2)).toMatchObject({ ok: true });
      expect(await db.buyBack(ann, round2)).toMatchObject({
        ok: false,
        code: "entry_not_eliminated",
      });

      // And directly, with the entry forced back to eliminated: the unique
      // constraint and the function's own check both stand in the way.
      await db.sql(
        "update entries set status = 'eliminated', eliminated_round_id = (select id from rounds where competition_id = (select competition_id from entries where id = $1) and round_number = 1) where id = $1",
        [ann]
      );
      expect(await db.buyBack(ann, round2)).toMatchObject({
        ok: false,
        code: "already_bought_back",
      });
    });

    it("refuses once the window has shut", async () => {
      const { round2, ann } = await settledWipeout();
      await closeWindow(round2);

      const result = await db.buyBack(ann, round2);
      expect(result).toMatchObject({ ok: false, code: "window_closed" });
      // Nothing was written.
      expect(await db.sql("select id from buybacks")).toEqual([]);
      expect(
        await db.one("select status from entries where id = $1", [ann])
      ).toEqual({ status: "eliminated" });
    });

    it("refuses an unpaid buy-back — 'paid and recorded' is the rule", async () => {
      const { round2, ann } = await settledWipeout();

      expect(await db.buyBack(ann, round2, 1000, false)).toMatchObject({
        ok: false,
        code: "not_paid",
      });
      expect(await db.buyBack(ann, round2, 0, true)).toMatchObject({
        ok: false,
        code: "not_paid",
      });
      expect(
        await db.one("select status from entries where id = $1", [ann])
      ).toEqual({ status: "eliminated" });
    });

    it("refuses a round that is not the one immediately after the elimination", async () => {
      const { competitionId, round2, ann } = await settledWipeout();
      const round3 = await db.addRound({
        competitionId,
        roundNumber: 3,
        matchday: 3,
        deadlineHours: 8,
      });

      // Out in round 1: round 3 is not the window, open or not.
      expect(await db.buyBack(ann, round3)).toMatchObject({
        ok: false,
        code: "wrong_round",
      });
      expect(round2).toBeTruthy();
    });

    it("refuses an entry eliminated in round 4", async () => {
      await seedFixtures();
      const competitionId = await db.addCompetition();
      const round4 = await db.addRound({
        competitionId,
        roundNumber: 4,
        matchday: 1,
        deadlineHours: -4,
      });
      const round5 = await db.addRound({
        competitionId,
        roundNumber: 5,
        matchday: 2,
        deadlineHours: 4,
      });
      const entry = await db.addEntry(
        competitionId,
        await db.addParticipant("Late")
      );
      await db.sql(
        "update entries set status = 'eliminated', eliminated_round_id = $2 where id = $1",
        [entry, round4]
      );

      expect(await db.buyBack(entry, round5)).toMatchObject({
        ok: false,
        code: "eliminated_too_late",
      });
    });

    it("refuses once the competition is over", async () => {
      const { competitionId, round2, ann } = await settledWipeout();
      await db.sql("update competitions set status = 'rolled_over' where id = $1", [
        competitionId,
      ]);

      expect(await db.buyBack(ann, round2)).toMatchObject({
        ok: false,
        code: "competition_not_active",
      });
    });

    // The table's own backstop, for a row written by hand rather than through
    // the function.
    it("the trigger refuses a hand-written buy-back that skips a round", async () => {
      const { competitionId, round1, ann } = await settledWipeout();
      const round3 = await db.addRound({
        competitionId,
        roundNumber: 3,
        matchday: 3,
        deadlineHours: 8,
      });

      await expect(
        db.sql(
          `insert into buybacks (competition_id, entry_id, eliminated_round_id, round_id, paid, amount_paid_pence)
           values ($1, $2, $3, $4, true, 1000)`,
          [competitionId, ann, round1, round3]
        )
      ).rejects.toThrow(/must be for round 2/);
    });
  });

  // =========================================================================
  // Pending → continue, and pending → rollover
  // =========================================================================

  describe("the pending competition", () => {
    async function pendingRollover() {
      const seeded = await wipeoutInRoundOne();
      await db.settle(
        plan(await planFromDatabase(db, seeded.competitionId, seeded.round1))
      );
      return seeded;
    }

    it("CONTINUES when somebody buys back — no rollover", async () => {
      const { competitionId, round2, ann } = await pendingRollover();
      await db.buyBack(ann, round2);

      const outcome = await finalisationPlanFromDatabase(db, competitionId);
      expect(outcome).toMatchObject({ ok: false, reason: "not_ended" });

      // And the round it came back for settles like any other. Chelsea won.
      await db.addPick({
        competitionId,
        entryId: ann,
        roundId: round2,
        teamId: team.get("Chelsea")!,
      });
      await closeWindow(round2);
      const settled = await db.settle(
        plan(await planFromDatabase(db, competitionId, round2))
      );
      expect(settled).toMatchObject({ ok: true, code: "settled" });
      expect(await db.entryStatuses(competitionId)).toEqual({
        Ann: "winner",
        Bob: "eliminated",
      });
      expect(await db.competitionRow(competitionId)).toMatchObject({
        status: "won",
      });
    });

    it("REFUSES to finalise while the window is open, and changes nothing", async () => {
      const { competitionId } = await pendingRollover();

      const outcome = await finalisationPlanFromDatabase(db, competitionId);
      expect(outcome).toMatchObject({ ok: false, reason: "window_open" });

      // The database refuses too, even handed a plan that says otherwise —
      // the clock guard is inside the transaction, not in the caller.
      const forced = await db.finalise({
        competition_id: competitionId,
        window_closes_at: new Date(Date.now() + 3600_000).toISOString(),
        expected_active_entry_ids: [],
        expected_buyback_ids: [],
        end: { kind: "rollover", participant_id: null, winner_entry_ids: [] },
      });
      expect(forced).toMatchObject({ ok: false, code: "window_open" });
      expect(await db.competitionRow(competitionId)).toMatchObject({
        status: "active",
      });
    });

    it("ROLLS OVER once the window shuts with nobody coming back", async () => {
      const { competitionId, round2 } = await pendingRollover();
      await closeWindow(round2);

      const outcome = await finalisationPlanFromDatabase(db, competitionId);
      if (!outcome.ok) throw new Error(outcome.reason);
      expect(outcome.state).toEqual({ kind: "rollover" });

      const result = await db.finalise(outcome.plan);
      expect(result).toMatchObject({
        ok: true,
        code: "finalised",
        end_kind: "rollover",
      });
      expect(await db.competitionRow(competitionId)).toMatchObject({
        status: "rolled_over",
        winner_participant_id: null,
      });
    });

    it("refuses the rollover if a buy-back landed after the plan was built", async () => {
      const { competitionId, round2, ann } = await pendingRollover();

      // Plan computed while the window is still open would refuse; build it
      // against a shut window, then let a buy-back sneak in first.
      const openPlan = {
        competition_id: competitionId,
        window_closes_at: new Date(Date.now() - 3600_000).toISOString(),
        expected_active_entry_ids: [] as string[],
        expected_buyback_ids: [] as string[],
        end: { kind: "rollover", participant_id: null, winner_entry_ids: [] },
      };

      await db.buyBack(ann, round2);

      const result = await db.finalise(openPlan);
      // Ann is active again, so BOTH fingerprints have moved. Either refusal is
      // correct; what matters is that nothing was applied.
      expect(result.ok).toBe(false);
      expect(["entries_changed", "buybacks_changed"]).toContain(result.code);
      expect(await db.competitionRow(competitionId)).toMatchObject({
        status: "active",
      });
    });
  });

  // =========================================================================
  // One buy-back per ELIMINATION, not per entry
  // =========================================================================

  describe("an entry that goes out twice", () => {
    it("gets a second, separate buy-back for the second elimination", async () => {
      await seedFixtures();
      // A third matchday to come back into.
      await db.addFixture({
        matchday: 3,
        homeTeamId: team.get("Liverpool")!,
        awayTeamId: team.get("Leeds United")!,
        status: "played",
        result: "home",
      });

      const competitionId = await db.addCompetition();
      const round1 = await db.addRound({
        competitionId, roundNumber: 1, matchday: 1, deadlineHours: -8,
      });
      const round2 = await db.addRound({
        competitionId, roundNumber: 2, matchday: 2, deadlineHours: 4,
      });
      const round3 = await db.addRound({
        competitionId, roundNumber: 3, matchday: 3, deadlineHours: 24,
      });

      const ann = await db.addEntry(competitionId, await db.addParticipant("Ann"));
      const bob = await db.addEntry(competitionId, await db.addParticipant("Bob"));

      // ---- round 1: both out ----
      await db.addPick({
        competitionId, entryId: ann, roundId: round1,
        teamId: team.get("Aston Villa")!, // lost
      });
      await db.addPick({
        competitionId, entryId: bob, roundId: round1,
        teamId: team.get("Brentford")!, // drew
      });
      await db.settle(plan(await planFromDatabase(db, competitionId, round1)));

      // ---- Ann buys her FIRST elimination back ----
      expect(await db.buyBack(ann, round2)).toMatchObject({
        ok: true, eliminated_round_number: 1, round_number: 2,
      });

      // ---- round 2: Ann goes out again ----
      await db.addPick({
        competitionId, entryId: ann, roundId: round2,
        teamId: team.get("Fulham")!, // Everton v Fulham drawn
      });
      await closeWindow(round2);
      const second = await db.settle(
        plan(await planFromDatabase(db, competitionId, round2))
      );
      // Round 2 is an eligible elimination, so this is pending — not a rollover.
      expect(second).toMatchObject({ ok: true, end_kind: "pending" });
      expect(await db.entryStatuses(competitionId)).toEqual({
        Ann: "eliminated",
        Bob: "eliminated",
      });

      // ---- and she may buy back AGAIN, for the new elimination ----
      expect(await db.buyBack(ann, round3)).toMatchObject({
        ok: true, eliminated_round_number: 2, round_number: 3,
      });

      // Two payments, two windows, one entry. £20 of buy-backs in the pot.
      expect(await db.buybackRows(competitionId)).toEqual([
        {
          entry_id: ann, paid: true, amount_paid_pence: 1000,
          eliminated_round_number: 1, for_round_number: 2,
        },
        {
          entry_id: ann, paid: true, amount_paid_pence: 1000,
          eliminated_round_number: 2, for_round_number: 3,
        },
      ]);

      // Her used teams have survived both revivals.
      const used = (
        await db.sql(
          `select t.name from picks p
             join teams t on t.id = p.team_id
            where p.entry_id = $1 order by t.name`,
          [ann]
        )
      ).map((r) => r.name);
      expect(used).toEqual(["Aston Villa", "Fulham"]);

      // Bob, meanwhile, went out in round 1 and let his one window lapse.
      expect(await db.buyBack(bob, round2)).toMatchObject({
        ok: false, code: "window_closed",
      });
      expect(await db.entryStatuses(competitionId)).toEqual({
        Ann: "active",
        Bob: "eliminated",
      });
    });
  });

  // =========================================================================
  // The sole survivor who is not yet the winner
  // =========================================================================

  describe("a sole survivor with a window still open", () => {
    async function soleSurvivor() {
      await seedFixtures();
      const competitionId = await db.addCompetition();
      const round1 = await db.addRound({
        competitionId,
        roundNumber: 1,
        matchday: 1,
        deadlineHours: -4,
      });
      const round2 = await db.addRound({
        competitionId,
        roundNumber: 2,
        matchday: 2,
        deadlineHours: 4,
      });
      const annId = await db.addParticipant("Ann");
      const ann = await db.addEntry(competitionId, annId);
      const bob = await db.addEntry(
        competitionId,
        await db.addParticipant("Bob")
      );
      // Arsenal won; Brentford drew.
      await db.addPick({
        competitionId,
        entryId: ann,
        roundId: round1,
        teamId: team.get("Arsenal")!,
      });
      await db.addPick({
        competitionId,
        entryId: bob,
        roundId: round1,
        teamId: team.get("Brentford")!,
      });
      return { competitionId, round1, round2, ann, bob, annId };
    }

    it("is NOT crowned while the window is open", async () => {
      const { competitionId, round1 } = await soleSurvivor();

      const result = await db.settle(
        plan(await planFromDatabase(db, competitionId, round1))
      );
      expect(result).toMatchObject({ ok: true, end_kind: "pending" });

      // Ann is still merely active. No 'winner' entry, no won competition —
      // being last standing before the windows close is not winning.
      expect(await db.entryStatuses(competitionId)).toEqual({
        Ann: "active",
        Bob: "eliminated",
      });
      expect(await db.competitionRow(competitionId)).toMatchObject({
        status: "active",
        winner_participant_id: null,
      });
    });

    it("is crowned once it shuts with nobody coming back", async () => {
      const { competitionId, round1, round2, annId } = await soleSurvivor();
      await db.settle(plan(await planFromDatabase(db, competitionId, round1)));
      await closeWindow(round2);

      const outcome = await finalisationPlanFromDatabase(db, competitionId);
      if (!outcome.ok) throw new Error(outcome.reason);

      const result = await db.finalise(outcome.plan);
      expect(result).toMatchObject({ ok: true, end_kind: "won" });
      expect(await db.entryStatuses(competitionId)).toEqual({
        Ann: "winner",
        Bob: "eliminated",
      });
      expect(await db.competitionRow(competitionId)).toMatchObject({
        status: "won",
        winner_participant_id: annId,
      });
    });

    it("is NOT crowned if the eliminated entry buys back instead", async () => {
      const { competitionId, round1, round2, bob } = await soleSurvivor();
      await db.settle(plan(await planFromDatabase(db, competitionId, round1)));

      expect(await db.buyBack(bob, round2)).toMatchObject({ ok: true });
      expect(await db.entryStatuses(competitionId)).toEqual({
        Ann: "active",
        Bob: "active",
      });

      const outcome = await finalisationPlanFromDatabase(db, competitionId);
      expect(outcome).toMatchObject({ ok: false, reason: "not_ended" });
      expect(await db.competitionRow(competitionId)).toMatchObject({
        status: "active",
      });
    });
  });
});
