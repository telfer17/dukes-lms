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

/** Hostnames a scratch cluster is allowed to live on. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Refuse to point this suite at anything that is not obviously local.
 *
 * reset() TRUNCATEs every table. A mistyped or copy-pasted connection string is
 * all it would take to wipe a live competition — entries, picks, who won — and
 * there is no undo. So the rule is an allowlist, not a blocklist: local host or
 * nothing, and an explicit LMS_TEST_ALLOW_REMOTE=1 for anyone who genuinely
 * means it (a CI service container reached by hostname, say).
 *
 * Deliberately not silent: a refusal fails the run loudly rather than skipping,
 * because "your database URL is dangerous" is not a reason to report green.
 */
export function assertSafeDatabaseUrl(url: string): void {
  if (process.env.LMS_TEST_ALLOW_REMOTE === "1") return;

  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    throw new Error(
      "LMS_TEST_DATABASE_URL is not a valid connection URL. Expected something like postgres://postgres@127.0.0.1:55432/lms_test."
    );
  }

  const isLocal =
    LOCAL_HOSTS.has(host) ||
    host.endsWith(".local") ||
    host.endsWith(".localhost");
  if (isLocal) return;

  const managed = /\.supabase\.(co|com)$/.test(host)
    ? ` "${host}" is a Supabase database — almost certainly the real one.`
    : "";

  throw new Error(
    `Refusing to run the integration suite against "${host}".${managed}` +
      " These tests TRUNCATE every table, and there is no undo." +
      " Point LMS_TEST_DATABASE_URL at a local scratch database (./scripts/scratch-db.sh start)," +
      " or set LMS_TEST_ALLOW_REMOTE=1 if you are certain the target is disposable."
  );
}

export class TestDb {
  private constructor(readonly client: pg.Client) {}

  static async connect(): Promise<TestDb> {
    assertSafeDatabaseUrl(DATABASE_URL);
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
    await this.sql(readFileSync(join(repoRoot, "db", "buyback.sql"), "utf8"));
    await this.sql(readFileSync(join(repoRoot, "db", "lock-round.sql"), "utf8"));
  }

  /** Wipe everything except the 20-team reference seed. */
  async reset(): Promise<void> {
    // Re-checked at the destructive statement itself, not just at connect():
    // this is the line that does the damage, and it should be impossible to
    // reach it past the guard by holding a connection opened some other way.
    assertSafeDatabaseUrl(DATABASE_URL);
    await this.sql(`
      truncate buybacks, picks, entries, rounds, competitions, participants, fixtures
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

  async buyBack(
    entryId: string,
    roundId: string,
    amountPence = 1000,
    paid = true
  ): Promise<Record<string, unknown>> {
    return this.value("select lms_buy_back_entry($1, $2, $3, $4) as r", [
      entryId,
      roundId,
      amountPence,
      paid,
    ]);
  }

  async lock(plan: unknown): Promise<Record<string, unknown>> {
    return this.value("select lms_lock_round($1::jsonb) as r", [
      JSON.stringify(plan),
    ]);
  }

  async roundRow(roundId: string): Promise<Row> {
    return this.one(
      "select round_number, status, locked_at from rounds where id = $1",
      [roundId]
    );
  }

  async finalise(plan: unknown): Promise<Record<string, unknown>> {
    return this.value("select lms_finalise_competition($1::jsonb) as r", [
      JSON.stringify(plan),
    ]);
  }

  async buybackRows(competitionId: string): Promise<Row[]> {
    return this.sql(
      `select b.entry_id, b.paid, b.amount_paid_pence,
              er.round_number as eliminated_round_number,
              tr.round_number as for_round_number
         from buybacks b
         join rounds er on er.id = b.eliminated_round_id
         join rounds tr on tr.id = b.round_id
        where b.competition_id = $1
        order by tr.round_number`,
      [competitionId]
    );
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
    "select id, round_number, deadline, status from rounds where competition_id = $1",
    [competitionId]
  );
  const teams = await db.sql("select id, name from teams order by name");
  const fixtures = await db.sql(
    "select id, matchday, home_team_id, away_team_id, status, result from fixtures where matchday = $1 order by kickoff",
    [round.matchday]
  );
  const entries = await db.sql(
    `select e.id, e.participant_id, e.status, p.name, r.round_number as eliminated_round_number
       from entries e
       join participants p on p.id = e.participant_id
       left join rounds r on r.id = e.eliminated_round_id
      where e.competition_id = $1`,
    [competitionId]
  );
  const buybacks = await db.sql(
    `select b.id,
            b.entry_id,
            er.round_number as eliminated_round_number,
            tr.round_number as for_round_number
       from buybacks b
       join rounds er on er.id = b.eliminated_round_id
       join rounds tr on tr.id = b.round_id
      where b.competition_id = $1`,
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
      eliminated_round_number:
        e.eliminated_round_number === null
          ? null
          : Number(e.eliminated_round_number),
    })),
    picks: picks.map((p) => ({
      entry_id: p.entry_id as string,
      round_id: p.round_id as string,
      team_id: Number(p.team_id),
    })),
    allRounds: rounds.map((r) => ({
      round_number: Number(r.round_number),
      deadline: new Date(r.deadline as string).toISOString(),
      status: r.status as "pending" | "locked" | "settled",
    })),
    buybacks: buybacks.map((b) => ({
      id: b.id as string,
      entry_id: b.entry_id as string,
      eliminated_round_number: Number(b.eliminated_round_number),
      for_round_number: Number(b.for_round_number),
    })),
  });
}

/**
 * The lock plan, read from the database the same way the admin action reads it
 * — same builder, same engine, same seed. See planFromDatabase.
 */
export async function lockPlanFromDatabase(
  db: TestDb,
  competitionId: string,
  roundId: string
) {
  const { buildLockPlan } = await import("@/lib/settlement-plan");

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

  return buildLockPlan({
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
      eliminated_round_number: null,
    })),
    picks: picks.map((p) => ({
      entry_id: p.entry_id as string,
      round_id: p.round_id as string,
      team_id: Number(p.team_id),
    })),
  });
}

/**
 * The finalisation plan, read from the database the same way the admin action
 * reads it — same builder, same engine. See planFromDatabase.
 */
export async function finalisationPlanFromDatabase(
  db: TestDb,
  competitionId: string
) {
  const { buildFinalisationPlan } = await import("@/lib/settlement-plan");

  const rounds = await db.sql(
    "select round_number, deadline, status from rounds where competition_id = $1",
    [competitionId]
  );
  const entries = await db.sql(
    `select e.id, e.participant_id, e.status, p.name, r.round_number as eliminated_round_number
       from entries e
       join participants p on p.id = e.participant_id
       left join rounds r on r.id = e.eliminated_round_id
      where e.competition_id = $1`,
    [competitionId]
  );
  const buybacks = await db.sql(
    `select b.id,
            b.entry_id,
            er.round_number as eliminated_round_number,
            tr.round_number as for_round_number
       from buybacks b
       join rounds er on er.id = b.eliminated_round_id
       join rounds tr on tr.id = b.round_id
      where b.competition_id = $1`,
    [competitionId]
  );
  const settled = rounds
    .filter((r) => r.status === "settled")
    .map((r) => Number(r.round_number));

  return buildFinalisationPlan({
    competitionId,
    entries: entries.map((e) => ({
      id: e.id as string,
      participant_id: e.participant_id as string,
      status: e.status as "active" | "eliminated" | "winner",
      label: e.name as string,
      eliminated_round_number:
        e.eliminated_round_number === null
          ? null
          : Number(e.eliminated_round_number),
    })),
    allRounds: rounds.map((r) => ({
      round_number: Number(r.round_number),
      deadline: new Date(r.deadline as string).toISOString(),
      status: r.status as "pending" | "locked" | "settled",
    })),
    buybacks: buybacks.map((b) => ({
      id: b.id as string,
      entry_id: b.entry_id as string,
      eliminated_round_number: Number(b.eliminated_round_number),
      for_round_number: Number(b.for_round_number),
    })),
    settledRoundNumber: settled.length === 0 ? 0 : Math.max(...settled),
  });
}
