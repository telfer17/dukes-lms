// The access model against a REAL Postgres.
//
// db/grants.sql is the whole of what the publishable (anon) key can do: RLS is
// off everywhere, so the grants ARE the exposure. What only a database can
// prove is that, after every db/ file has been applied in order, anon and
// authenticated can READ the five public-safe objects and do nothing else to
// them — and that this holds even on a database that was set up under
// Supabase's original auto-grant, which handed those roles full write.
//
// See tests/db/harness.ts for how to run these (LMS_TEST_DATABASE_URL).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase, SKIP_NOTICE, TestDb } from "./harness";

const suite = hasDatabase ? describe : describe.skip;

/** The objects the publishable key may read. Mirrors db/grants.sql § 3. */
const PUBLIC_OBJECTS = [
  "teams",
  "fixtures",
  "rounds",
  "competitions",
  "standing_board",
] as const;

/** The objects it must not see at all. */
const PRIVATE_TABLES = ["participants", "entries", "picks", "buybacks"] as const;

const PUBLIC_ROLES = ["anon", "authenticated"] as const;

suite(hasDatabase ? "grants (integration)" : SKIP_NOTICE, () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await TestDb.connect();
    await db.applySchema();
  });

  afterAll(async () => {
    await db?.end();
  });

  /** { "anon": { teams: ["SELECT"], ... }, "authenticated": { ... } } */
  async function publicPrivileges(): Promise<
    Record<string, Record<string, string[]>>
  > {
    const rows = await db.sql(
      `select grantee, table_name,
              array_agg(privilege_type::text order by privilege_type)::text[] as privileges
       from information_schema.role_table_grants
       where table_schema = 'public'
         and grantee = any($1::text[])
       group by grantee, table_name`,
      [[...PUBLIC_ROLES]]
    );
    const out: Record<string, Record<string, string[]>> = {};
    for (const role of PUBLIC_ROLES) out[role] = {};
    for (const r of rows) {
      out[r.grantee as string][r.table_name as string] = r.privileges as string[];
    }
    return out;
  }

  function expectReadOnly(privs: Record<string, Record<string, string[]>>) {
    for (const role of PUBLIC_ROLES) {
      for (const object of PUBLIC_OBJECTS) {
        expect(privs[role][object], `${role} on ${object}`).toEqual(["SELECT"]);
      }
      for (const table of PRIVATE_TABLES) {
        expect(privs[role][table], `${role} on ${table}`).toBeUndefined();
      }
      // Nothing beyond the five public objects, whatever it is called.
      expect(Object.keys(privs[role]).sort()).toEqual([...PUBLIC_OBJECTS].sort());
    }
  }

  it("after every db/ file, anon and authenticated hold SELECT and only SELECT on the five public objects", async () => {
    expectReadOnly(await publicPrivileges());
  });

  it("strips the write verbs Supabase's original auto-grant handed out, on re-apply", async () => {
    // Put the database into the state a pre-2026-10-30 Supabase project is in:
    // anon and authenticated with ALL on every public table and the view.
    await db.sql(`
      grant all on teams, fixtures, rounds, competitions, standing_board,
                   participants, entries, picks, buybacks
        to anon, authenticated
    `);
    const before = await publicPrivileges();
    expect(before.anon.teams).toContain("INSERT");
    expect(before.anon.participants).toContain("SELECT");

    // Re-running the files — the documented, re-runnable deploy — must undo it.
    await db.applySchema();
    expectReadOnly(await publicPrivileges());
  });

  it("stops Supabase's legacy default privileges reaching tables created later", async () => {
    // A project created before 2026-10-30 carries default privileges that
    // hand anon and authenticated ALL on every NEW table and view in public.
    // Reproduce that, apply the files, then create a table AFTER them: the
    // publishable key must get nothing, the secret key its safety-net verbs.
    await db.sql(`
      alter default privileges in schema public
        grant all on tables to anon, authenticated
    `);
    await db.applySchema();

    await db.sql("drop table if exists grants_probe");
    await db.sql("create table grants_probe (id int primary key)");
    try {
      const rows = await db.sql(
        `select grantee,
                array_agg(privilege_type::text order by privilege_type)::text[] as privileges
         from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'grants_probe'
         group by grantee`
      );
      const byRole = Object.fromEntries(
        rows.map((r) => [r.grantee as string, r.privileges as string[]])
      );
      expect(byRole.anon, "anon on a new table").toBeUndefined();
      expect(byRole.authenticated, "authenticated on a new table").toBeUndefined();
      expect(byRole.service_role, "service_role on a new table").toEqual([
        "DELETE",
        "INSERT",
        "SELECT",
        "UPDATE",
      ]);
    } finally {
      await db.sql("drop table if exists grants_probe");
    }

    // The view the schema file recreates on every run must come out read-only
    // too — it was recreated under the legacy default just now.
    const privs = await publicPrivileges();
    expect(privs.anon.standing_board).toEqual(["SELECT"]);
    expect(privs.authenticated.standing_board).toEqual(["SELECT"]);
  });
});
