-- ============================================================================
-- Dukes LMS — explicit Data API grants
-- ============================================================================
--
-- WHY THIS EXISTS. From 2026-10-30 Supabase no longer auto-grants Data API
-- access (supabase-js / PostgREST / GraphQL) to NEW tables in the public
-- schema. Until now every table here got its privileges for anon,
-- authenticated and service_role from Supabase's default privileges at
-- creation time, and the other db/ files only ever adjusted anon/authenticated
-- (revoking the private tables, granting the public-safe ones). Nothing in
-- this repo ever granted service_role anything on a table — the server-side
-- secret key (lib/supabase-server.ts) works today purely on those defaults.
--
-- service_role bypasses ROW LEVEL SECURITY. It does NOT bypass privileges.
-- Without the grants below, a fresh project or any table added after the
-- change would answer every admin read and write with "permission denied".
--
-- Tables that already exist keep the privileges they were created with, so
-- running this on the live database is additive and changes nothing that
-- already works: GRANT of a privilege a role already holds is a no-op, and
-- REVOKE of one it does not hold is a no-op. It touches privileges only —
-- never data, never a result, pick, entry or round.
--
-- Run LAST in the SQL order (README § Database). Re-runnable.
--
-- Privileges are derived from what the app actually does, not "ALL":
--   lib/lms-db.ts              server reads on every table
--   app/admin/*/actions.ts     inserts/updates/deletes via supabaseServer
--   lms_* functions            SECURITY INVOKER, so their DML runs with the
--                              caller's (service_role's) privileges
-- ============================================================================


-- 1 ── schema ----------------------------------------------------------------
--
-- Supabase projects already carry this; a plain Postgres (tests/db/harness.ts)
-- may not. Harmless where present.

grant usage on schema public to anon, authenticated, service_role;


-- 2 ── service_role: the secret key, server-only ----------------------------
--
-- Least privilege per table. Each line lists exactly the verbs some server
-- path performs — add a verb here when a new write path needs one, and the
-- "permission denied" that prompts it is the audit trail.
--
--   teams         read only (club list; seeded in the SQL editor, never by the app)
--   fixtures      read + update (lms_set_fixture_result, lms_settle_round write
--                 result/status; kickoff refreshes run in the SQL editor)
--   participants  read, insert (new entrant), delete (undo of a failed entry)
--   competitions  read, insert (new competition), update (status/winner via
--                 lms_settle_round, lms_finalise_competition, lms_reopen_round)
--   rounds        read, insert (round plan), update (lock/settle/reopen),
--                 delete (discarding a competition's rounds)
--   entries       read, insert, update (paid/newcomer/elimination), delete
--   picks         read, insert + update (admin upsert, lms_lock_round
--                 auto-assign, settlement outcomes). Never deleted.
--   buybacks      read, insert (lms_buy_back_entry). Never updated or deleted.

grant select                         on teams        to service_role;
grant select, update                 on fixtures     to service_role;
grant select, insert, delete         on participants to service_role;
grant select, insert, update         on competitions to service_role;
grant select, insert, update, delete on rounds       to service_role;
grant select, insert, update, delete on entries      to service_role;
grant select, insert, update         on picks        to service_role;
grant select, insert                 on buybacks     to service_role;


-- 3 ── anon / authenticated: the publishable key --------------------------
--
-- Read-only, public-safe objects only. db/lms-schema.sql and db/buyback.sql
-- already say this; it is restated here so a fresh project is correct even if
-- those files are ever split, and so this file alone describes the whole
-- access model.
--
-- competitions is granted WHOLE-TABLE on purpose. The browser client reads
-- id, label, status, rollover_count, pot_carried_in_pence and
-- winner_participant_id (lib/public-read.ts); the only other column is
-- created_at. winner_participant_id is already public — it is the winner the
-- leaderboard shows — so there is nothing to hide, and a column-level grant
-- would break the next time a public query needs another column. Simple wins.
--
-- RLS is OFF everywhere (db/lms-schema.sql § Access model), so these grants
-- ARE the exposure: anon can read every row and column of each object below.
-- teams, fixtures and rounds are public football data plus deadlines;
-- standing_board is name + status only and deliberately omits entries.id.

grant select on teams          to anon, authenticated;
grant select on fixtures       to anon, authenticated;
grant select on rounds         to anon, authenticated;
grant select on competitions   to anon, authenticated;
grant select on standing_board to anon, authenticated;

-- Read-only means READ-ONLY. Supabase's original auto-grant gave anon and
-- authenticated full write on every public table — insert, update, delete,
-- truncate, references, trigger — and with RLS off nothing stood between the
-- publishable key and a write. The app only ever READS with that key
-- (lib/public-read.ts), so everything but select comes off. Explicit rather
-- than assumed, so a database set up under the old defaults ends up in the
-- same state as a fresh one.

revoke insert, update, delete, truncate, references, trigger
  on teams, fixtures, rounds, competitions, standing_board
  from anon, authenticated;

-- Private: phone numbers, payment, entry ids, money. Secret key only.

revoke all on participants from anon, authenticated;
revoke all on entries      from anon, authenticated;
revoke all on picks        from anon, authenticated;
revoke all on buybacks     from anon, authenticated;


-- 4 ── safety net for tables added later ------------------------------------
--
-- This re-establishes, for service_role ONLY, the auto-grant Supabase is
-- withdrawing: any table created in public from now on is usable by the
-- secret key straight away, so a future db/ file that adds a table does not
-- silently break the admin side until someone remembers this file. anon and
-- authenticated get nothing by default — every public-safe read stays an
-- explicit, reviewed grant in section 3.
--
-- Default privileges apply to objects created by the role that runs this
-- statement. In the Supabase SQL editor that is postgres, which is also the
-- role every db/ file runs as — so the net covers them.

alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;


-- 5 ── verify ----------------------------------------------------------------
--
-- anon and authenticated must appear ONLY for teams, fixtures, rounds,
-- competitions and standing_board, and their privileges column must read
-- exactly "SELECT" — on the existing database too, now that section 3 strips
-- the write verbs the original auto-grant handed out. service_role must
-- appear for all eight tables with at least the verbs in section 2.
--
-- On the EXISTING database service_role will show more than section 2 lists
-- (DELETE on picks, TRUNCATE, REFERENCES, TRIGGER, ...): those came with the
-- original auto-grant and this file deliberately does not revoke them, so it
-- can never take away something the live app is using. On a fresh project the
-- rows match section 2 exactly.

select
  table_name,
  grantee,
  string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated', 'service_role')
group by table_name, grantee
order by table_name, grantee;
