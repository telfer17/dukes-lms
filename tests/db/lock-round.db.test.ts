// Locking a round against a REAL Postgres.
//
// The unit tests prove the DRAW (tests/lms.test.ts) and the PLAN
// (tests/settlement-plan.test.ts). What only a database can prove is what
// locking is actually for: that it fills blanks and nothing else, that pressing
// it twice changes nothing, that a pick typed in at the same moment wins over
// the draw, and — the property the whole design rests on — that a round nobody
// locked settles with the IDENTICAL teams a locked one would have.
//
// See tests/db/harness.ts for how to run these (LMS_TEST_DATABASE_URL).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  hasDatabase,
  lockPlanFromDatabase,
  planFromDatabase,
  SKIP_NOTICE,
  TestDb,
} from "./harness";
import type { PlanOutcome, SettlementPlan } from "@/lib/settlement-plan";

const suite = hasDatabase ? describe : describe.skip;

suite(hasDatabase ? "locking a round (integration)" : SKIP_NOTICE, () => {
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

  /** Matchday 1: five fixtures, ten teams, every outcome represented. */
  async function seedMatchday() {
    const pairs: [string, string, "home" | "away" | "draw"][] = [
      ["Arsenal", "Aston Villa", "home"],
      ["Bournemouth", "Brentford", "draw"],
      ["Chelsea", "Crystal Palace", "home"],
      ["Everton", "Fulham", "away"],
      ["Leeds United", "Hull City", "home"],
    ];
    for (const [home, away, result] of pairs) {
      await db.addFixture({
        matchday: 1,
        homeTeamId: team.get(home)!,
        awayTeamId: team.get(away)!,
        status: "played",
        result,
      });
    }
  }

  async function seedRound(entryCount = 4) {
    await seedMatchday();
    const competitionId = await db.addCompetition();
    const roundId = await db.addRound({
      competitionId,
      roundNumber: 1,
      matchday: 1,
      deadlineHours: -2, // deadline has passed
    });
    const entries: string[] = [];
    for (let i = 0; i < entryCount; i++) {
      entries.push(
        await db.addEntry(competitionId, await db.addParticipant(`P${i}`))
      );
    }
    return { competitionId, roundId, entries };
  }

  const lock = async (competitionId: string, roundId: string) =>
    db.lock((await lockPlanFromDatabase(db, competitionId, roundId)).plan);

  // =========================================================================

  describe("filling the blanks", () => {
    it("assigns every blank entry a random unused team, marked auto", async () => {
      const { competitionId, roundId, entries } = await seedRound(4);
      // One entry has already picked; three are blank.
      await db.addPick({
        competitionId,
        entryId: entries[0],
        roundId,
        teamId: team.get("Chelsea")!,
      });

      const result = await lock(competitionId, roundId);
      expect(result).toMatchObject({ ok: true, code: "locked", assigned: 3 });

      const picks = await db.picksForRound(roundId);
      expect(picks).toHaveLength(4);

      // The typed-in pick is untouched and still manual.
      const manual = picks.find((p) => p.entry_id === entries[0])!;
      expect(manual).toMatchObject({ team: "Chelsea", auto_assigned: false });

      // The three drawn ones are marked auto and are all teams playing today.
      const playing = [
        "Arsenal", "Aston Villa", "Bournemouth", "Brentford", "Chelsea",
        "Crystal Palace", "Everton", "Fulham", "Leeds United", "Hull City",
      ];
      for (const p of picks.filter((x) => x.entry_id !== entries[0])) {
        expect(p.auto_assigned).toBe(true);
        expect(playing).toContain(p.team);
      }
    });

    it("marks the round locked, and records when", async () => {
      const { competitionId, roundId } = await seedRound(2);
      expect(await db.roundRow(roundId)).toMatchObject({ locked_at: null });

      await lock(competitionId, roundId);

      const row = await db.roundRow(roundId);
      expect(row.locked_at).not.toBeNull();
      // Locking is about PICKS. It must not move the round along the settlement
      // state machine — that is what settling is for.
      expect(row.status).toBe("pending");
    });

    it("never assigns a team the entry has already used", async () => {
      await seedMatchday();
      const competitionId = await db.addCompetition();
      const round1 = await db.addRound({
        competitionId, roundNumber: 1, matchday: 1, deadlineHours: -8,
      });
      // Matchday 2 is Arsenal v Chelsea and nothing else, so each entry has at
      // most one legal team left.
      await db.addFixture({
        matchday: 2,
        homeTeamId: team.get("Arsenal")!,
        awayTeamId: team.get("Chelsea")!,
        status: "postponed",
      });
      const round2 = await db.addRound({
        competitionId, roundNumber: 2, matchday: 2, deadlineHours: -2,
      });

      const ann = await db.addEntry(competitionId, await db.addParticipant("Ann"));
      const bob = await db.addEntry(competitionId, await db.addParticipant("Bob"));
      // Round 1: Ann uses Arsenal, Bob uses Chelsea. Both win.
      await db.addPick({
        competitionId, entryId: ann, roundId: round1,
        teamId: team.get("Arsenal")!,
      });
      await db.addPick({
        competitionId, entryId: bob, roundId: round1,
        teamId: team.get("Chelsea")!,
      });
      await db.settle(plan(await planFromDatabase(db, competitionId, round1)));

      await lock(competitionId, round2);

      const picks = await db.picksForRound(round2);
      // Only Arsenal and Chelsea play, and each has used one of them — so the
      // draw has exactly one legal answer per entry, and must find it.
      expect(picks.find((p) => p.entry_id === ann)).toMatchObject({
        team: "Chelsea",
        auto_assigned: true,
      });
      expect(picks.find((p) => p.entry_id === bob)).toMatchObject({
        team: "Arsenal",
        auto_assigned: true,
      });
    });

    it("still DRAWS for an entry with nothing playing — and settlement then refuses", async () => {
      // Decision 1 (docs/LMS-RULES.md) and the completeness guard, meeting.
      //
      // The draw never skips an entry: with no unused team playing, it hands
      // out an unused team that has no game. What has changed is what happens
      // NEXT. A matchday holding one fixture out of twenty clubs is a matchday
      // still being loaded, so settlement will not read "no game" as an answer —
      // it refuses, and nobody is eliminated on a fixture list nobody finished.
      //
      // Worth stating plainly: on a COMPLETE Premier League matchday all twenty
      // clubs play, so an entry can never run out of playing teams and this
      // fallback cannot fire at all. It is a safety net for bad data, and the
      // guard below is what stops that bad data putting anyone out.
      await seedMatchday();
      const competitionId = await db.addCompetition();
      const round1 = await db.addRound({
        competitionId, roundNumber: 1, matchday: 1, deadlineHours: -8,
      });
      for (const matchday of [2, 3]) {
        await db.addFixture({
          matchday,
          homeTeamId: team.get("Arsenal")!,
          awayTeamId: team.get("Chelsea")!,
          status: "postponed",
        });
      }
      const round2 = await db.addRound({
        competitionId, roundNumber: 2, matchday: 2, deadlineHours: -4,
      });
      const round3 = await db.addRound({
        competitionId, roundNumber: 3, matchday: 3, deadlineHours: -1,
      });

      const ann = await db.addEntry(competitionId, await db.addParticipant("Ann"));
      const bob = await db.addEntry(competitionId, await db.addParticipant("Bob"));

      await db.addPick({
        competitionId, entryId: ann, roundId: round1,
        teamId: team.get("Arsenal")!,
      });
      await db.addPick({
        competitionId, entryId: bob, roundId: round1,
        teamId: team.get("Chelsea")!,
      });
      await db.settle(plan(await planFromDatabase(db, competitionId, round1)));

      // Round 2, the swap: now both have used Arsenal AND Chelsea.
      await db.addPick({
        competitionId, entryId: ann, roundId: round2,
        teamId: team.get("Chelsea")!,
      });
      await db.addPick({
        competitionId, entryId: bob, roundId: round2,
        teamId: team.get("Arsenal")!,
      });
      await db.settle(plan(await planFromDatabase(db, competitionId, round2)));
      expect(await db.entryStatuses(competitionId)).toEqual({
        Ann: "active",
        Bob: "active",
      });

      // Round 3: nobody picks, and nobody CAN — every team playing is used.
      const locked = await lock(competitionId, round3);
      expect(locked).toMatchObject({ ok: true, assigned: 2 });

      // Nobody was skipped: both hold a team, and it is one with no game.
      for (const pick of await db.picksForRound(round3)) {
        expect(pick.auto_assigned).toBe(true);
        expect(["Arsenal", "Chelsea"]).not.toContain(pick.team);
      }

      // And settlement REFUSES rather than putting them out on it, because a
      // one-fixture matchday cannot vouch for "no game".
      const built = await planFromDatabase(db, competitionId, round3);
      expect(built).toMatchObject({ ok: false, reason: "unsettled" });
      expect(await db.entryStatuses(competitionId)).toEqual({
        Ann: "active",
        Bob: "active",
      });
    });
  });

  // =========================================================================

  describe("idempotence, and living alongside manual edits", () => {
    it("locking twice changes nothing the second time", async () => {
      const { competitionId, roundId } = await seedRound(3);

      const first = await lock(competitionId, roundId);
      expect(first).toMatchObject({ assigned: 3, already_locked: false });
      const after = await db.picksForRound(roundId);
      const lockedAt = (await db.roundRow(roundId)).locked_at;

      const second = await lock(competitionId, roundId);
      expect(second).toMatchObject({
        ok: true, assigned: 0, already_locked: true, blanks_remaining: 0,
      });
      // Same teams, same flags, and the locked-at stamp is the FIRST one.
      expect(await db.picksForRound(roundId)).toEqual(after);
      expect((await db.roundRow(roundId)).locked_at).toEqual(lockedAt);
    });

    it("a pick typed in before the lock WINS over the draw", async () => {
      const { competitionId, roundId, entries } = await seedRound(2);

      // What the lock would have given entry 0, had it been blank.
      const wouldHaveDrawn = (
        await lockPlanFromDatabase(db, competitionId, roundId)
      ).plan.assign.find((a) => a.entry_id === entries[0])!;

      // The organiser enters the real pick first — a team the draw did not pick.
      const realChoice = Object.entries(
        Object.fromEntries(team)
      ).find(([name, id]) =>
        id !== wouldHaveDrawn.team_id &&
        ["Arsenal", "Bournemouth", "Chelsea", "Everton", "Leeds United"].includes(name)
      )![1];

      await db.addPick({
        competitionId, entryId: entries[0], roundId, teamId: realChoice,
      });
      await lock(competitionId, roundId);

      const kept = (await db.picksForRound(roundId)).find(
        (p) => p.entry_id === entries[0]
      )!;
      expect(kept.team_id).toBe(realChoice);
      expect(kept.auto_assigned).toBe(false);
    });

    it("a pick that lands AFTER the plan is built still wins", async () => {
      // The race the ON CONFLICT DO NOTHING is for: the organiser types a late
      // pick in while the lock is being computed.
      const { competitionId, roundId, entries } = await seedRound(2);
      const built = await lockPlanFromDatabase(db, competitionId, roundId);
      expect(built.plan.assign).toHaveLength(2);

      await db.addPick({
        competitionId, entryId: entries[1], roundId,
        teamId: team.get("Fulham")!,
      });

      const result = await db.lock(built.plan);
      expect(result).toMatchObject({ ok: true, assigned: 1, skipped: 1 });

      const late = (await db.picksForRound(roundId)).find(
        (p) => p.entry_id === entries[1]
      )!;
      expect(late).toMatchObject({ team: "Fulham", auto_assigned: false });
    });

    it("locking a round with no blanks is allowed and harmless", async () => {
      const { competitionId, roundId, entries } = await seedRound(2);
      await db.addPick({
        competitionId, entryId: entries[0], roundId, teamId: team.get("Chelsea")!,
      });
      await db.addPick({
        competitionId, entryId: entries[1], roundId, teamId: team.get("Arsenal")!,
      });

      const result = await lock(competitionId, roundId);
      expect(result).toMatchObject({ ok: true, assigned: 0, blanks_remaining: 0 });
      expect((await db.roundRow(roundId)).locked_at).not.toBeNull();
      expect(
        (await db.picksForRound(roundId)).every((p) => p.auto_assigned === false)
      ).toBe(true);
    });

    it("refuses to write into a settled round", async () => {
      const { competitionId, roundId, entries } = await seedRound(2);
      await db.addPick({
        competitionId, entryId: entries[0], roundId, teamId: team.get("Arsenal")!,
      });
      await db.addPick({
        competitionId, entryId: entries[1], roundId, teamId: team.get("Chelsea")!,
      });
      const built = await lockPlanFromDatabase(db, competitionId, roundId);
      await db.settle(plan(await planFromDatabase(db, competitionId, roundId)));

      expect(await db.lock(built.plan)).toMatchObject({
        ok: false,
        code: "round_settled",
      });
    });

    it("does not assign to an entry that is out", async () => {
      const { competitionId, roundId, entries } = await seedRound(2);
      await db.sql("update entries set status = 'eliminated' where id = $1", [
        entries[0],
      ]);

      const result = await lock(competitionId, roundId);
      expect(result).toMatchObject({ ok: true, assigned: 1 });
      expect(await db.picksForRound(roundId)).toHaveLength(1);
    });

    it("refuses an eliminated entry even when the PLAN names one", async () => {
      // The plan builder filters these out, so this hands the function a plan
      // it would never receive — which is the point. An eliminated entry given
      // a pick is back in the competition without paying for a buy-back, so the
      // filter has to exist on both sides, not just in the caller.
      const { competitionId, roundId, entries } = await seedRound(2);
      await db.sql("update entries set status = 'eliminated' where id = $1", [
        entries[0],
      ]);

      const result = await db.lock({
        competition_id: competitionId,
        round_id: roundId,
        assign: [
          { entry_id: entries[0], team_id: team.get("Arsenal")! },
          { entry_id: entries[1], team_id: team.get("Chelsea")! },
        ],
      });

      expect(result).toMatchObject({ ok: true, assigned: 1, skipped: 1 });
      const picks = await db.picksForRound(roundId);
      expect(picks).toHaveLength(1);
      expect(picks[0].entry_id).toBe(entries[1]);
      expect(await db.entryStatuses(competitionId)).toMatchObject({
        P0: "eliminated",
      });
    });
  });

  // =========================================================================
  // The property the whole design rests on
  // =========================================================================

  describe("the settlement backstop draws the same teams", () => {
    it("an UNLOCKED round settles with exactly the teams locking would have written", async () => {
      const { competitionId, roundId } = await seedRound(5);

      // What locking would assign — computed, not applied.
      const wouldAssign = (
        await lockPlanFromDatabase(db, competitionId, roundId)
      ).plan.assign;
      expect(wouldAssign).toHaveLength(5);

      // Now settle WITHOUT ever locking. The backstop fills the blanks itself.
      const settled = await db.settle(
        plan(await planFromDatabase(db, competitionId, roundId))
      );
      expect(settled).toMatchObject({ ok: true, code: "settled" });
      expect((await db.roundRow(roundId)).locked_at).toBeNull();

      const written = await db.picksForRound(roundId);
      for (const { entry_id, team_id } of wouldAssign) {
        const actual = written.find((p) => p.entry_id === entry_id)!;
        expect(actual.team_id).toBe(team_id);
        expect(actual.auto_assigned).toBe(true);
      }
    });

    it("settling a LOCKED round leaves its picks exactly as locked", async () => {
      // The other half of the guarantee. The test above shows an unlocked round
      // settles to the teams locking would have written; this shows settlement
      // does not RE-draw a round that was already locked — the backstop fills
      // blanks, and a locked round has none, so every team and every auto flag
      // survives the settle untouched.
      const a = await seedRound(4);
      await lock(a.competitionId, a.roundId);
      const lockedPicks = (await db.picksForRound(a.roundId)).map((p) => ({
        team: p.team,
        auto: p.auto_assigned,
      }));

      await db.settle(plan(await planFromDatabase(db, a.competitionId, a.roundId)));

      const settledPicks = (await db.picksForRound(a.roundId)).map((p) => ({
        team: p.team,
        auto: p.auto_assigned,
      }));
      expect(settledPicks).toEqual(lockedPicks);
    });
  });
});
