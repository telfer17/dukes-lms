// Reopening a settled round, end to end, against a real Postgres.
//
// See tests/db/harness.ts for how to run these (and why they skip themselves
// when there is no database).
//
// The scenario this exists for: a fixture result was typed in wrong, the round
// was settled on it, and somebody is out (or crowned) who should not be. The
// fix is reopen → correct the result → settle again, through the same
// lms_set_fixture_result and lms_settle_round every other week uses. Nothing is
// re-implemented for the test.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  finalisationPlanFromDatabase,
  hasDatabase,
  planFromDatabase,
  SKIP_NOTICE,
  TestDb,
} from "./harness";
import type { PlanOutcome, SettlementPlan } from "@/lib/settlement-plan";

const SUITE = hasDatabase
  ? "reopen round (integration, real Postgres)"
  : `reopen round (integration) — ${SKIP_NOTICE}`;

if (!hasDatabase) {
  console.warn(`\n⚠  tests/db/reopen-round.db.test.ts: ${SKIP_NOTICE}\n`);
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

  function plan(outcome: PlanOutcome): SettlementPlan {
    if (!outcome.ok) {
      throw new Error(`expected a plan, got refusal: ${outcome.reason}`);
    }
    return outcome.plan;
  }

  async function settle(competitionId: string, roundId: string) {
    return db.settle(plan(await planFromDatabase(db, competitionId, roundId)));
  }

  /**
   * Matchday 1: Arsenal beat Aston Villa, Everton v Fulham is recorded as an
   * away win — the result that will turn out to be WRONG — and Chelsea v
   * Palace was played and drawn.
   */
  async function seedMatchday(matchday: number) {
    return {
      arsenal: await db.addFixture({
        matchday,
        homeTeamId: team.get("Arsenal")!,
        awayTeamId: team.get("Aston Villa")!,
        status: "played",
        result: "home",
      }),
      everton: await db.addFixture({
        matchday,
        homeTeamId: team.get("Everton")!,
        awayTeamId: team.get("Fulham")!,
        status: "played",
        result: "away",
      }),
      draw: await db.addFixture({
        matchday,
        homeTeamId: team.get("Chelsea")!,
        awayTeamId: team.get("Crystal Palace")!,
        status: "played",
        result: "draw",
      }),
    };
  }

  /**
   * Ann on Arsenal (wins), Bob on Everton (recorded as losing), Cid on Chelsea
   * (drew, out either way), Dee never picked. Round 4 by default so no buy-back
   * window complicates the end state; tests that want one say so.
   */
  async function seedRound(opts: { roundNumber?: number; deadlineHours?: number } = {}) {
    const roundNumber = opts.roundNumber ?? 4;
    const fixtures = await seedMatchday(roundNumber);
    const competitionId = await db.addCompetition();
    const roundId = await db.addRound({
      competitionId,
      roundNumber,
      matchday: roundNumber,
      deadlineHours: opts.deadlineHours,
    });
    const annId = await db.addParticipant("Ann");
    const ann = await db.addEntry(competitionId, annId);
    const bobId = await db.addParticipant("Bob");
    const bob = await db.addEntry(competitionId, bobId);
    const cid = await db.addEntry(competitionId, await db.addParticipant("Cid"));
    const dee = await db.addEntry(competitionId, await db.addParticipant("Dee"));
    await db.addPick({ competitionId, entryId: ann, roundId, teamId: team.get("Arsenal")! });
    await db.addPick({ competitionId, entryId: bob, roundId, teamId: team.get("Everton")! });
    await db.addPick({ competitionId, entryId: cid, roundId, teamId: team.get("Chelsea")! });
    return { competitionId, roundId, fixtures, annId, ann, bobId, bob, cid, dee };
  }

  async function entryRows(competitionId: string) {
    return db.sql(
      `select p.name, e.status, e.eliminated_round_id
         from entries e join participants p on p.id = e.participant_id
        where e.competition_id = $1 order by p.name`,
      [competitionId]
    );
  }

  // =========================================================================
  // Reversal
  // =========================================================================

  describe("reversing a settled round", () => {
    it("revives the entries this round eliminated, resets outcomes, and keeps the auto-assigned pick", async () => {
      const w = await seedRound();
      const settled = await settle(w.competitionId, w.roundId);
      expect(settled).toMatchObject({ ok: true, code: "settled" });

      const before = await db.picksForRound(w.roundId);
      const assigned = before.find((p) => p.auto_assigned === true)!;
      expect(assigned.entry_id).toBe(w.dee);
      expect(before.every((p) => p.outcome !== "pending")).toBe(true);
      // Dee's team was DRAWN. If it lost, Ann is the sole survivor of a
      // round-4 settle and the competition is won on the spot; if it won, the
      // competition continues. Both are real settlements and both must reverse
      // — so the expectations below are read off what actually happened rather
      // than asserting the draw.
      const statusesBefore = await db.entryStatuses(w.competitionId);
      expect(statusesBefore).toMatchObject({ Bob: "eliminated", Cid: "eliminated" });
      const compBefore = await db.competitionRow(w.competitionId);
      const wasWon = compBefore.status === "won";
      expect(statusesBefore.Ann).toBe(wasWon ? "winner" : "active");

      const result = await db.reopen(w.roundId);

      expect(result).toMatchObject({
        ok: true,
        code: "reopened",
        round_number: 4,
        winners_reverted: wasWon ? 1 : 0,
        competition_reverted_from: wasWon ? "won" : null,
        buybacks_on_round: 0,
      });
      // Bob, Cid, and Dee if her drawn team lost — everyone this round put out.
      const wasOut = before.filter((p) => p.outcome === "eliminated").length;
      expect(result.revived).toBe(wasOut);
      expect(result.outcomes_reset).toBe(before.length);

      expect(await db.roundStatus(w.roundId)).toBe("locked");
      expect(await db.competitionRow(w.competitionId)).toMatchObject({
        status: "active",
        winner_participant_id: null,
      });

      const entries = await entryRows(w.competitionId);
      expect(entries.every((e) => e.status === "active")).toBe(true);
      expect(entries.every((e) => e.eliminated_round_id === null)).toBe(true);

      const after = await db.picksForRound(w.roundId);
      expect(after).toHaveLength(before.length);
      expect(after.every((p) => p.outcome === "pending")).toBe(true);
      // The backstop's pick is still there, still marked as the draw it was.
      const stillAssigned = after.find((p) => p.entry_id === w.dee)!;
      expect(stillAssigned).toMatchObject({
        auto_assigned: true,
        team_id: assigned.team_id,
      });

      // Fixtures were not touched: the wrong result is still there for the
      // organiser to correct.
      expect(await db.fixtureRow(w.fixtures.everton)).toMatchObject({
        status: "played",
        result: "away",
      });
    });

    it("leaves entries eliminated in EARLIER rounds out", async () => {
      // Round 4 settled (Bob, Cid out), then round 5 settled putting Ann out.
      const w = await seedRound();
      await db.addPick({
        competitionId: w.competitionId,
        entryId: w.dee,
        roundId: w.roundId,
        teamId: team.get("Arsenal")!,
      });
      expect(await settle(w.competitionId, w.roundId)).toMatchObject({ ok: true, end_kind: "continue" });

      await db.addFixture({
        matchday: 5,
        homeTeamId: team.get("Liverpool")!,
        awayTeamId: team.get("Leeds United")!,
        status: "played",
        result: "away",
      });
      await db.addFixture({
        matchday: 5,
        homeTeamId: team.get("Sunderland")!,
        awayTeamId: team.get("Hull City")!,
        status: "played",
        result: "home",
      });
      const round5 = await db.addRound({
        competitionId: w.competitionId,
        roundNumber: 5,
        matchday: 5,
      });
      await db.addPick({
        competitionId: w.competitionId,
        entryId: w.ann,
        roundId: round5,
        teamId: team.get("Liverpool")!,
      });
      // Dee is on Sunderland, who won.
      await db.addPick({
        competitionId: w.competitionId,
        entryId: w.dee,
        roundId: round5,
        teamId: team.get("Sunderland")!,
      });
      const r5 = await settle(w.competitionId, round5);
      expect(r5).toMatchObject({ ok: true });
      expect((await db.entryStatuses(w.competitionId)).Ann).toBe("eliminated");

      const result = await db.reopen(round5);
      expect(result).toMatchObject({ ok: true, round_number: 5 });

      const statuses = await db.entryStatuses(w.competitionId);
      expect(statuses.Ann).toBe("active"); // round 5 undone
      expect(statuses.Bob).toBe("eliminated"); // round 4 stands
      expect(statuses.Cid).toBe("eliminated"); // round 4 stands
      expect(await db.roundStatus(w.roundId)).toBe("settled");
      expect(await db.roundStatus(round5)).toBe("locked");
      // Round 4's outcomes are untouched.
      const r4picks = await db.picksForRound(w.roundId);
      expect(r4picks.every((p) => p.outcome !== "pending")).toBe(true);
    });

    it("un-crowns a competition the round won directly: active again, no winner, entry back to active", async () => {
      // Round 4, everyone but Ann goes out: an immediate win, no window.
      const w = await seedRound();
      // Bob on Aston Villa so he loses cleanly and Ann is the sole survivor;
      // Dee is given a pick too so nothing is drawn.
      await db.sql("update picks set team_id = $1 where entry_id = $2", [
        team.get("Aston Villa")!,
        w.bob,
      ]);
      await db.addPick({
        competitionId: w.competitionId,
        entryId: w.dee,
        roundId: w.roundId,
        teamId: team.get("Crystal Palace")!,
      });

      const settled = await settle(w.competitionId, w.roundId);
      expect(settled).toMatchObject({ ok: true, end_kind: "won" });
      expect(await db.competitionRow(w.competitionId)).toMatchObject({
        status: "won",
        winner_participant_id: w.annId,
      });
      expect((await db.entryStatuses(w.competitionId)).Ann).toBe("winner");

      const result = await db.reopen(w.roundId);
      expect(result).toMatchObject({
        ok: true,
        revived: 3,
        winners_reverted: 1,
        competition_reverted_from: "won",
      });

      expect(await db.competitionRow(w.competitionId)).toEqual({
        status: "active",
        winner_participant_id: null,
      });
      expect(await db.entryStatuses(w.competitionId)).toEqual({
        Ann: "active",
        Bob: "active",
        Cid: "active",
        Dee: "active",
      });
      expect(await db.roundStatus(w.roundId)).toBe("locked");
    });

    it("un-crowns a competition that was finalised after the buy-back window closed", async () => {
      // Round 1 leaves Ann alone; round 2's deadline has passed with no
      // buy-back, so lms_finalise_competition crowns her. Reopening round 1
      // must undo the crown even though settlement itself never wrote it.
      const w = await seedRound({ roundNumber: 1, deadlineHours: -8 });
      await db.sql("update picks set team_id = $1 where entry_id = $2", [
        team.get("Aston Villa")!,
        w.bob,
      ]);
      await db.addPick({
        competitionId: w.competitionId,
        entryId: w.dee,
        roundId: w.roundId,
        teamId: team.get("Crystal Palace")!,
      });
      const round2 = await db.addRound({
        competitionId: w.competitionId,
        roundNumber: 2,
        matchday: 2,
        deadlineHours: 4, // window OPEN at settle time
      });

      expect(await settle(w.competitionId, w.roundId)).toMatchObject({
        ok: true,
        end_kind: "pending",
      });
      // The clock moves past round 2's deadline with nobody buying back.
      await db.sql("update rounds set deadline = now() - interval '1 hour' where id = $1", [round2]);
      const fin = await finalisationPlanFromDatabase(db, w.competitionId);
      if (!fin.ok) throw new Error(`expected a finalisation plan: ${fin.reason}`);
      expect(await db.finalise(fin.plan)).toMatchObject({ ok: true, end_kind: "won" });
      expect(await db.competitionRow(w.competitionId)).toMatchObject({
        status: "won",
        winner_participant_id: w.annId,
      });

      expect(await db.reopen(w.roundId)).toMatchObject({
        ok: true,
        winners_reverted: 1,
        competition_reverted_from: "won",
      });
      expect(await db.competitionRow(w.competitionId)).toEqual({
        status: "active",
        winner_participant_id: null,
      });
      expect((await db.entryStatuses(w.competitionId)).Ann).toBe("active");
    });

    it("reverts a rollover the round caused", async () => {
      // Round 4, nobody survives: immediate rollover.
      const w = await seedRound();
      await db.sql("update picks set team_id = $1 where entry_id = $2", [
        team.get("Aston Villa")!,
        w.ann,
      ]);
      await db.addPick({
        competitionId: w.competitionId,
        entryId: w.dee,
        roundId: w.roundId,
        teamId: team.get("Crystal Palace")!,
      });
      expect(await settle(w.competitionId, w.roundId)).toMatchObject({
        ok: true,
        end_kind: "rollover",
      });
      expect((await db.competitionRow(w.competitionId)).status).toBe("rolled_over");

      expect(await db.reopen(w.roundId)).toMatchObject({
        ok: true,
        revived: 4,
        competition_reverted_from: "rolled_over",
      });
      expect((await db.competitionRow(w.competitionId)).status).toBe("active");
      expect(new Set(Object.values(await db.entryStatuses(w.competitionId)))).toEqual(
        new Set(["active"])
      );
    });

    it("leaves a buy-back alone and reports it", async () => {
      // Round 1 puts Bob out; Bob buys back for round 2 (window open). Then
      // round 1 turns out to have been settled on a wrong result.
      const w = await seedRound({ roundNumber: 1, deadlineHours: -8 });
      const round2 = await db.addRound({
        competitionId: w.competitionId,
        roundNumber: 2,
        matchday: 2,
        deadlineHours: 4,
      });
      expect(await settle(w.competitionId, w.roundId)).toMatchObject({ ok: true });
      expect(await db.buyBack(w.bob, round2)).toMatchObject({ ok: true });
      expect((await db.entryStatuses(w.competitionId)).Bob).toBe("active");

      const result = await db.reopen(w.roundId);
      expect(result).toMatchObject({ ok: true, buybacks_on_round: 1 });

      // Bob is active either way; the buy-back row and its money are untouched.
      expect((await db.entryStatuses(w.competitionId)).Bob).toBe("active");
      const rows = await db.buybackRows(w.competitionId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        entry_id: w.bob,
        paid: true,
        amount_paid_pence: 1000,
        eliminated_round_number: 1,
      });
    });
  });

  // =========================================================================
  // The whole point: reopen → correct → settle again
  // =========================================================================

  describe("reopen, correct the result, settle again", () => {
    it("produces the corrected outcome through the normal settle path", async () => {
      const w = await seedRound();
      // Dee picks (a winner) so the round is fully deterministic and continues.
      await db.addPick({
        competitionId: w.competitionId,
        entryId: w.dee,
        roundId: w.roundId,
        teamId: team.get("Arsenal")!,
      });
      expect(await settle(w.competitionId, w.roundId)).toMatchObject({ ok: true, end_kind: "continue" });
      expect(await db.entryStatuses(w.competitionId)).toEqual({
        Ann: "active",
        Bob: "eliminated", // Everton "lost"
        Cid: "eliminated",
        Dee: "active",
      });

      // The result cannot be corrected while the round is settled ...
      expect(
        await db.setFixtureResult(w.fixtures.everton, "played", "home")
      ).toMatchObject({ ok: false, code: "round_settled", round_number: 4 });

      // ... so reopen, then correct: Everton actually WON.
      expect(await db.reopen(w.roundId)).toMatchObject({ ok: true });
      expect(
        await db.setFixtureResult(w.fixtures.everton, "played", "home")
      ).toMatchObject({ ok: true });

      // And settle again — the ordinary path, a fresh plan from the engine.
      const again = await settle(w.competitionId, w.roundId);
      expect(again).toMatchObject({
        ok: true,
        code: "settled",
        end_kind: "continue",
        eliminated: 1,
        survivors: 3,
      });

      expect(await db.entryStatuses(w.competitionId)).toEqual({
        Ann: "active",
        Bob: "active", // corrected
        Cid: "eliminated",
        Dee: "active",
      });
      expect(await db.roundStatus(w.roundId)).toBe("settled");
      const picks = await db.picksForRound(w.roundId);
      expect(picks.find((p) => p.entry_id === w.bob)!.outcome).toBe("survived");
      expect(picks.find((p) => p.entry_id === w.cid)!.outcome).toBe("eliminated");
      // The eliminated entries name this round again.
      const rows = await entryRows(w.competitionId);
      for (const r of rows) {
        expect(r.eliminated_round_id).toBe(
          r.status === "eliminated" ? w.roundId : null
        );
      }
    });

    it("re-settles a wrongly-won competition to a continuing one", async () => {
      // Recorded: Ann alone survives round 4 and wins. Truth: Everton won, so
      // Bob is still in and nobody has won anything.
      const w = await seedRound();
      await db.addPick({
        competitionId: w.competitionId,
        entryId: w.dee,
        roundId: w.roundId,
        teamId: team.get("Crystal Palace")!,
      });
      expect(await settle(w.competitionId, w.roundId)).toMatchObject({ ok: true, end_kind: "won" });

      expect(await db.reopen(w.roundId)).toMatchObject({ ok: true, competition_reverted_from: "won" });
      expect(await db.setFixtureResult(w.fixtures.everton, "played", "home")).toMatchObject({ ok: true });
      expect(await settle(w.competitionId, w.roundId)).toMatchObject({
        ok: true,
        end_kind: "continue",
        survivors: 2,
      });
      expect(await db.competitionRow(w.competitionId)).toEqual({
        status: "active",
        winner_participant_id: null,
      });
      expect(await db.entryStatuses(w.competitionId)).toEqual({
        Ann: "active",
        Bob: "active",
        Cid: "eliminated",
        Dee: "eliminated",
      });
    });

    it("does not re-draw the auto-assigned pick on re-settle", async () => {
      const w = await seedRound();
      expect(await settle(w.competitionId, w.roundId)).toMatchObject({ ok: true });
      const drawn = (await db.picksForRound(w.roundId)).find((p) => p.auto_assigned)!;

      expect(await db.reopen(w.roundId)).toMatchObject({ ok: true });
      const replan = plan(await planFromDatabase(db, w.competitionId, w.roundId));
      // Dee already has her pick, so the engine has nothing to assign.
      expect(replan.auto_assign).toEqual([]);
      expect(await db.settle(replan)).toMatchObject({ ok: true });

      const picks = await db.picksForRound(w.roundId);
      const deePicks = picks.filter((p) => p.entry_id === w.dee);
      expect(deePicks).toHaveLength(1);
      expect(deePicks[0]).toMatchObject({ auto_assigned: true, team_id: drawn.team_id });
    });
  });

  // =========================================================================
  // Guards
  // =========================================================================

  describe("guards", () => {
    it("refuses a round that is not the latest settled round, and changes nothing", async () => {
      const w = await seedRound({ roundNumber: 1, deadlineHours: -8 });
      await seedMatchday(2);
      const round2 = await db.addRound({
        competitionId: w.competitionId,
        roundNumber: 2,
        matchday: 2,
      });
      await db.addPick({
        competitionId: w.competitionId,
        entryId: w.dee,
        roundId: w.roundId,
        teamId: team.get("Arsenal")!,
      });
      expect(await settle(w.competitionId, w.roundId)).toMatchObject({ ok: true, end_kind: "continue" });
      for (const entryId of [w.ann, w.dee]) {
        await db.addPick({
          competitionId: w.competitionId,
          entryId,
          roundId: round2,
          teamId: team.get("Fulham")!,
        });
      }
      expect(await settle(w.competitionId, round2)).toMatchObject({ ok: true, end_kind: "continue" });

      const before = {
        statuses: await entryRows(w.competitionId),
        r1: await db.picksForRound(w.roundId),
        r2: await db.picksForRound(round2),
      };

      expect(await db.reopen(w.roundId)).toMatchObject({
        ok: false,
        code: "not_latest",
        detail: { round_number: 1, later_round_number: 2, later_status: "settled" },
      });

      expect(await db.roundStatus(w.roundId)).toBe("settled");
      expect(await db.roundStatus(round2)).toBe("settled");
      expect(await entryRows(w.competitionId)).toEqual(before.statuses);
      expect(await db.picksForRound(w.roundId)).toEqual(before.r1);
      expect(await db.picksForRound(round2)).toEqual(before.r2);

      // The LATEST one can be reopened.
      expect(await db.reopen(round2)).toMatchObject({ ok: true, round_number: 2 });
    });

    it("treats a later PROVISIONALLY LOCKED round as later settlement", async () => {
      // A locked (provisional-win) round has applied its eliminations already.
      const w = await seedRound({ roundNumber: 1, deadlineHours: -8 });
      expect(await settle(w.competitionId, w.roundId)).toMatchObject({ ok: true });
      await db.addRound({
        competitionId: w.competitionId,
        roundNumber: 2,
        matchday: 2,
        status: "locked",
      });

      expect(await db.reopen(w.roundId)).toMatchObject({
        ok: false,
        code: "not_latest",
        detail: { later_round_number: 2, later_status: "locked" },
      });
      expect(await db.roundStatus(w.roundId)).toBe("settled");
    });

    it("refuses a round that is not settled", async () => {
      const w = await seedRound();
      expect(await db.reopen(w.roundId)).toMatchObject({
        ok: false,
        code: "not_settled",
        detail: { round_number: 4, status: "pending" },
      });
      expect(await db.roundStatus(w.roundId)).toBe("pending");
    });

    it("refuses an unknown round", async () => {
      expect(
        await db.reopen("00000000-0000-0000-0000-000000000000")
      ).toMatchObject({ ok: false, code: "round_not_found" });
    });

    it("refuses to revert a concluded competition while another is active", async () => {
      const w = await seedRound();
      await db.sql("update picks set team_id = $1 where entry_id = $2", [
        team.get("Aston Villa")!,
        w.ann,
      ]);
      await db.addPick({
        competitionId: w.competitionId,
        entryId: w.dee,
        roundId: w.roundId,
        teamId: team.get("Crystal Palace")!,
      });
      expect(await settle(w.competitionId, w.roundId)).toMatchObject({ ok: true, end_kind: "rollover" });
      // The organiser has already started the next competition.
      await db.addCompetition("Successor");

      expect(await db.reopen(w.roundId)).toMatchObject({
        ok: false,
        code: "another_competition_active",
      });
      expect((await db.competitionRow(w.competitionId)).status).toBe("rolled_over");
      expect(await db.roundStatus(w.roundId)).toBe("settled");
      expect(new Set(Object.values(await db.entryStatuses(w.competitionId)))).toEqual(
        new Set(["eliminated"])
      );
    });
  });

  // =========================================================================
  // Atomicity
  // =========================================================================

  describe("atomicity", () => {
    it("rolls back EVERY write when the transaction fails at the end", async () => {
      // The function's last write is the round's status. A trigger that raises
      // on exactly that write lets the reversal run to completion — entries
      // revived, winners reverted, outcomes reset, competition un-won — and
      // then fail, which is the only kind of failure that could half-apply.
      const w = await seedRound();
      await db.addPick({
        competitionId: w.competitionId,
        entryId: w.dee,
        roundId: w.roundId,
        teamId: team.get("Crystal Palace")!,
      });
      expect(await settle(w.competitionId, w.roundId)).toMatchObject({ ok: true, end_kind: "won" });

      const before = {
        entries: await entryRows(w.competitionId),
        picks: await db.picksForRound(w.roundId),
        competition: await db.competitionRow(w.competitionId),
      };

      await db.sql(`
        create or replace function lms_test_boom() returns trigger
        language plpgsql as $$ begin raise exception 'boom'; end $$;
        create trigger lms_test_boom after update on rounds
          for each row when (new.status = 'locked')
          execute function lms_test_boom();
      `);
      try {
        await expect(db.reopen(w.roundId)).rejects.toThrow(/boom/);
      } finally {
        await db.sql("drop trigger if exists lms_test_boom on rounds");
        await db.sql("drop function if exists lms_test_boom()");
      }

      expect(await db.roundStatus(w.roundId)).toBe("settled");
      expect(await entryRows(w.competitionId)).toEqual(before.entries);
      expect(await db.picksForRound(w.roundId)).toEqual(before.picks);
      expect(await db.competitionRow(w.competitionId)).toEqual(before.competition);

      // And with the trap gone, the same call works.
      expect(await db.reopen(w.roundId)).toMatchObject({ ok: true });
    });

    it("is refused again, harmlessly, once reopened", async () => {
      const w = await seedRound();
      expect(await settle(w.competitionId, w.roundId)).toMatchObject({ ok: true });
      expect(await db.reopen(w.roundId)).toMatchObject({ ok: true });
      // Double-click.
      expect(await db.reopen(w.roundId)).toMatchObject({
        ok: false,
        code: "not_settled",
        detail: { status: "locked" },
      });
      expect(await db.roundStatus(w.roundId)).toBe("locked");
    });
  });
});
