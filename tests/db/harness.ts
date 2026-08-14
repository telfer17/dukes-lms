// Integration harness: a REAL Postgres, the REAL schema, the REAL settlement
// function.
//
// Settlement is the one part of this app whose correctness is not a property of
// any single file. The rules live in lib/lms.ts and are unit-tested to death
// there; the plan lives in lib/settlement-plan.ts; the atomicity, the locking
// and the deferred won-integrity trigger live in Postgres. Only all three
// together settle a round, so only all three together can be proved to.
//
// These tests used to live in throwaway scripts that were written, run once and
// deleted. This is the permanent version.
//
// RUNNING THEM
// ------------
//   LMS_TEST_DATABASE_URL=postgres://... npm test
//
// scripts/scratch-db.sh spins up a disposable local cluster and prints the URL.
// With the variable unset the suite reports itself SKIPPED — never silently
// green, and never a failure on a machine that simply has no database.
//
// The database is used ONLY by these tests. Every test truncates first, so they
// do not depend on each other and can be read in any order. Point this at a
// scratch cluster, never at Supabase.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const DATABASE_URL = process.env.LMS_TEST_DATABASE_URL ?? "";
export const hasDatabase = DATABASE_URL !== "";

/** Shown as the suite name when there is no database, so the skip is visible. */
export const SKIP_NOTICE =
  "SKIPPED — no database. Set LMS_TEST_DATABASE_URL (see scripts/scratch-db.sh) to run these.";

export type Row = Record<string, unknown>;

export class TestDb {
  private constructor(readonly client: pg.Client) {}

  static async connect(): Promise<TestDb> {
    const client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    // A blocked statement should fail the test loudly rather than hang the
    // whole run — the lock-contention tests deliberately make things wait.
    await client.query("set statement_timeout = '15s'");
    return new TestDb(client);
  }

  async end(): Promise<void> {
    await this.client.end();
  }

  async sql(text: string, params: unknown[] = []): Promise<Row[]> {
    const { rows } = await this.client.query(text, params);
    return rows as Row[];
  }

  async one(text: string, params: unknown[] = []): Promise<Row> {
    const rows = await this.sql(text, params);
    if (rows.length !== 1) {
      throw new Error(`expected exactly 1 row, got ${rows.length}: ${text}`);
    }
    return rows[0];
  }

  async value<T>(text: string, params: unknown[] = []): Promise<T> {
    const row = await this.one(text, params);
    return Object.values(row)[0] as T;
  }

  /**
   * Apply db/lms-schema.sql and db/settlement-fn.sql. Both are re-runnable, so
   * this is safe on an already-set-up database and the suite never has to know
   * which it got.
   *
   * The roles come first because the schema REVOKEs from anon/authenticated and
   * the functions GRANT to service_role — on Supabase those exist already, on a
   * scratch cluster they do not.
   */
  async applySchema(): Promise<void> {
    await this.sql(`
      do $$
      begin
        if not exists (select 1 from pg_roles where rolname = 'anon')
          then create role anon nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated')
          then create role authenticated nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'service_role')
          then create role service_role nologin; end if;
      end $$;
    `);
    await this.sql(readFileSync(join(repoRoot, "db", "lms-schema.sql"), "utf8"));
    await this.sql(
      readFileSync(join(repoRoot, "db", "settlement-fn.sql"), "utf8")
    );
  }

  /** Wipe everything except the 20-team reference seed. */
  async reset(): Promise<void> {
    await this.sql(`
      truncate picks, entries, rounds, competitions, participants, fixtures
      restart identity cascade;
    `);
  }

  // ---- seeding -----------------------------------------------------------

  async teamIds(): Promise<Map<string, number>> {
    const rows = await this.sql("select id, name from teams");
    return new Map(rows.map((r) => [r.name as string, Number(r.id)]));
  }

  async addFixture(opts: {
    matchday: number;
    homeTeamId: number;
    awayTeamId: number;
    status?: "scheduled" | "played" | "postponed" | "abandoned";
    result?: "home" | "away" | "draw" | null;
    /** Hours from now; negative is in the past. */
    kickoffHours?: number;
  }): Promise<number> {
    return this.value<number>(
      `insert into fixtures
         (matchday, kickoff, home_team_id, away_team_id, status, result)
       values ($1, now() + ($2 || ' hours')::interval, $3, $4, $5, $6)
       returning id`,
      [
        opts.matchday,
        String(opts.kickoffHours ?? -3),
        opts.homeTeamId,
        opts.awayTeamId,
        opts.status ?? "scheduled",
        opts.result ?? null,
      ]
    );
  }

  async addCompetition(label = "Test competition"): Promise<string> {
    return this.value<string>(
      "insert into competitions (label) values ($1) returning id",
      [label]
    );
  }

  async addRound(opts: {
    competitionId: string;
    roundNumber: number;
    matchday: number;
    /** Hours from now; negative means the deadline has passed. */
    deadlineHours?: number;
    status?: "pending" | "locked" | "settled";
  }): Promise<string> {
    return this.value<string>(
      `insert into rounds (competition_id, round_number, matchday, deadline, status)
       values ($1, $2, $3, now() + ($4 || ' hours')::interval, $5)
       returning id`,
      [
        opts.competitionId,
        opts.roundNumber,
        opts.matchday,
        String(opts.deadlineHours ?? -4),
        opts.status ?? "pending",
      ]
    );
  }

  async addParticipant(name: string, phone: string | null = null): Promise<string> {
    return this.value<string>(
      "insert into participants (name, phone) values ($1, $2) returning id",
      [name, phone]
    );
  }

  async addEntry(
    competitionId: string,
    participantId: string,
    paidPence = 1000
  ): Promise<string> {
    return this.value<string>(
      `insert into entries (competition_id, participant_id, paid, amount_paid_pence)
       values ($1, $2, true, $3) returning id`,
      [competitionId, participantId, paidPence]
    );
  }

  async addPick(opts: {
    competitionId: string;
    entryId: string;
    roundId: string;
    teamId: number;
  }): Promise<string> {
    return this.value<string>(
      `insert into picks (competition_id, entry_id, round_id, team_id)
       values ($1, $2, $3, $4) returning id`,
      [opts.competitionId, opts.entryId, opts.roundId, opts.teamId]
    );
  }

  // ---- the functions under test ------------------------------------------

  async settle(plan: unknown): Promise<Record<string, unknown>> {
    return this.value("select lms_settle_round($1::jsonb) as r", [
      JSON.stringify(plan),
    ]);
  }

  async applyFixtureResults(
    updates: {
      fixture_id: number;
      home_score: number;
      away_score: number;
      result: string;
    }[]
  ): Promise<Record<string, unknown>> {
    return this.value("select lms_apply_fixture_results($1::jsonb) as r", [
      JSON.stringify(updates),
    ]);
  }

  async setFixtureResult(
    fixtureId: number,
    status: string,
    result: string | null
  ): Promise<Record<string, unknown>> {
    return this.value("select lms_set_fixture_result($1, $2, $3) as r", [
      fixtureId,
      status,
      result,
    ]);
  }

  // ---- reading state back ------------------------------------------------

  async entryStatuses(competitionId: string): Promise<Record<string, string>> {
    const rows = await this.sql(
      `select p.name, e.status
         from entries e join participants p on p.id = e.participant_id
        where e.competition_id = $1
        order by p.name`,
      [competitionId]
    );
    return Object.fromEntries(rows.map((r) => [r.name as string, r.status as string]));
  }

  async roundStatus(roundId: string): Promise<string> {
    return this.value<string>("select status from rounds where id = $1", [roundId]);
  }

  async competitionRow(competitionId: string): Promise<Row> {
    return this.one(
      "select status, winner_participant_id from competitions where id = $1",
      [competitionId]
    );
  }

  async picksForRound(roundId: string): Promise<Row[]> {
    return this.sql(
      `select p.entry_id, p.team_id, p.outcome, p.auto_assigned, t.name as team
         from picks p join teams t on t.id = p.team_id
        where p.round_id = $1
        order by t.name`,
      [roundId]
    );
  }

  async fixtureRow(fixtureId: number): Promise<Row> {
    return this.one(
      "select status, result, home_score, away_score from fixtures where id = $1",
      [fixtureId]
    );
  }
}

/**
 * Read the database and build a settlement plan exactly as the server action
 * does — same reads, same builder (lib/settlement-plan.ts), same engine. The
 * action itself cannot be imported here: it is "use server" and pulls in
 * server-only Supabase wiring. What matters is that the LOGIC under test is not
 * a copy, and it is not.
 */
export async function planFromDatabase(
  db: TestDb,
  competitionId: string,
  roundId: string
) {
  const { buildSettlementPlan } = await import("@/lib/settlement-plan");

  const round = await db.one(
    "select id, round_number, matchday from rounds where id = $1",
    [roundId]
  );
  const rounds = await db.sql(
    "select id, round_number from rounds where competition_id = $1",
    [competitionId]
  );
  const teams = await db.sql("select id, name from teams order by name");
  const fixtures = await db.sql(
    "select id, matchday, home_team_id, away_team_id, status, result from fixtures where matchday = $1 order by kickoff",
    [round.matchday]
  );
  const entries = await db.sql(
    `select e.id, e.participant_id, e.status, p.name
       from entries e join participants p on p.id = e.participant_id
      where e.competition_id = $1`,
    [competitionId]
  );
  const picks = await db.sql(
    "select entry_id, round_id, team_id from picks where competition_id = $1",
    [competitionId]
  );

  return buildSettlementPlan({
    competitionId,
    round: {
      id: round.id as string,
      round_number: Number(round.round_number),
      matchday: Number(round.matchday),
    },
    roundNumberById: new Map(
      rounds.map((r) => [r.id as string, Number(r.round_number)])
    ),
    teams: teams.map((t) => ({ id: Number(t.id), name: t.name as string })),
    fixtures: fixtures.map((f) => ({
      id: Number(f.id),
      matchday: Number(f.matchday),
      home_team_id: Number(f.home_team_id),
      away_team_id: Number(f.away_team_id),
      status: f.status as "scheduled" | "played" | "postponed" | "abandoned",
      result: f.result as "home" | "away" | "draw" | null,
    })),
    entries: entries.map((e) => ({
      id: e.id as string,
      participant_id: e.participant_id as string,
      status: e.status as "active" | "eliminated" | "winner",
      label: e.name as string,
    })),
    picks: picks.map((p) => ({
      entry_id: p.entry_id as string,
      round_id: p.round_id as string,
      team_id: Number(p.team_id),
    })),
  });
}
