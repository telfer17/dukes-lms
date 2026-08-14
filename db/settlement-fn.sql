-- ============================================================================
-- Dukes — Last Man Standing: transactional settlement + fixture writes
-- ============================================================================
--
-- Paste this whole file into the Supabase SQL editor and run it, AFTER
-- db/lms-schema.sql. It is re-runnable (CREATE OR REPLACE throughout).
--
-- WHY THIS FILE EXISTS
-- --------------------
-- Settling a round touches picks, entries, rounds and competitions. supabase-js
-- has no multi-statement transaction, so before this file settlement was a
-- sequence of independent writes, ordered so that every intermediate state was
-- at least valid, with a self-heal for the one state that was not. That is
-- gone: settlement is now ONE function call, so it either applies completely or
-- not at all.
--
-- SHAPE: PLAN → VALIDATE → APPLY
-- ------------------------------
-- The survival rules are NOT reimplemented here. lib/lms.ts remains the single
-- source of truth for logic, and it stays pure and unit-tested. The server
-- action reads state, computes a settlement PLAN with the engine, and hands the
-- plan to lms_settle_round(). This function's whole job is to
--
--   1. take the lock,
--   2. prove the database still looks exactly as it did when the plan was
--      computed (round, fixtures, picks, active entries all pinned), and
--   3. apply the plan atomically.
--
-- If anything moved underneath, it applies NOTHING and reports why; the
-- organiser re-runs and a fresh plan is computed against the new state. That
-- keeps the SQL thin and auditable, and keeps the rules testable in TypeScript
-- rather than duplicated in two languages that can drift apart.
--
-- THE LOCK
-- --------
-- app/admin/results/actions.ts used to carry a note that a settlement RPC "must
-- also take the results cron's guard inside it, or the lock will only be half a
-- lock". This is that whole lock.
--
-- The hazard is not two settlements racing — it is a fixture WRITE racing a
-- settlement. Both the cron and the manual result editor do
-- read-round-status → decide → write-fixture, which is a time-of-check /
-- time-of-use gap: they can read "round not settled", settlement can then settle
-- the round, and their write then lands a new result into a round whose
-- eliminations were already computed from the old one. Nothing downstream
-- notices, and the board silently disagrees with the results people went out on.
--
-- So all three write paths — settlement, the cron, the manual editor — take the
-- SAME transaction-scoped advisory lock (lms_lock_key()) as their first act, and
-- re-check their guards inside it. They therefore serialise: a fixture write
-- either completes entirely before settlement reads anything, or runs after
-- settlement has committed and is then correctly refused by the settled-round
-- guard. Every path takes the advisory lock BEFORE any row lock, so the lock
-- order is total and they cannot deadlock.
--
-- SECURITY
-- --------
-- These functions write entries, picks and competitions — tables the schema
-- deliberately revokes from anon/authenticated. EXECUTE is revoked from PUBLIC
-- (which Postgres grants by default on every new function) and granted only to
-- service_role, so they are reachable only with the server-side secret key.
-- They are SECURITY INVOKER: the caller's own privileges apply, so a function
-- that somehow became reachable would still be powerless.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- The one lock every LMS write path takes. A single fixed key: the point is
-- mutual exclusion across settlement and fixture writes, not fine-grained
-- concurrency — this is a pub competition with one organiser and a daily cron.
-- ----------------------------------------------------------------------------
create or replace function lms_lock_key()
returns bigint
language sql
immutable
as $$ select 4852003170255011::bigint $$;

comment on function lms_lock_key() is
  'Fixed advisory-lock key shared by settlement and every fixture write, so they cannot interleave.';


-- ----------------------------------------------------------------------------
-- lms_settle_round(plan) — apply a settlement plan atomically.
--
-- Returns jsonb, and returns it rather than raising for every REFUSAL, because
-- a refusal is an ordinary answer the organiser needs to read ("round still
-- open", "results missing"), not an exception. Refusals are all decided before
-- the first write, so a refused call has changed nothing by construction.
-- Genuine faults during apply raise and roll the transaction back.
--
-- Plan shape (all ids as strings, see app/admin/results/actions.ts):
--   {
--     competition_id, round_id, matchday,
--     expected_fixtures:     [{id, status, result}]   -- matchday, at plan time
--     expected_picks:        [{entry_id, team_id}]    -- this round, at plan time
--     expected_active_entry_ids: [entry_id]           -- at plan time
--     auto_assign:           [{entry_id, team_id}]    -- rows to create
--     pick_outcomes:         [{entry_id, outcome}]    -- survived | eliminated
--     eliminate_entry_ids:   [entry_id]
--     end: { kind: continue|won|rollover|provisional,
--            participant_id, winner_entry_ids: [entry_id] }
--   }
--
-- Result shape:
--   { ok: true,  code: 'settled'|'locked_provisional', eliminated, survivors }
--   { ok: false, code: '<reason>', detail: <jsonb|null> }
-- ----------------------------------------------------------------------------
create or replace function lms_settle_round(p_plan jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_competition_id uuid  := (p_plan->>'competition_id')::uuid;
  v_round_id       uuid  := (p_plan->>'round_id')::uuid;
  v_matchday       int   := (p_plan->>'matchday')::int;
  v_end_kind       text  := p_plan->'end'->>'kind';

  comp   competitions%rowtype;
  rnd    rounds%rowtype;

  v_expected jsonb;
  v_actual   jsonb;

  v_active_count    int;
  v_outcome_count   int;
  v_eliminated      int;
  v_survivors       int;
begin
  -- ---- 0. the lock, before anything is read ----------------------------
  -- Transaction-scoped: released at COMMIT or ROLLBACK, never leaked by a
  -- failed call. Taken first so cron/manual fixture writes cannot slip a new
  -- result in between the validation below and the writes at the bottom.
  perform pg_advisory_xact_lock(lms_lock_key());

  if v_competition_id is null or v_round_id is null or v_matchday is null
     or v_end_kind is null then
    return jsonb_build_object('ok', false, 'code', 'malformed_plan');
  end if;
  if v_end_kind not in ('continue', 'won', 'rollover', 'provisional') then
    return jsonb_build_object('ok', false, 'code', 'malformed_plan');
  end if;

  -- ---- 1. the competition must still be the active one ------------------
  select * into comp from competitions where id = v_competition_id;
  if not found or comp.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'no_active_competition');
  end if;

  -- ---- 2. the round, pinned for the rest of the transaction --------------
  -- FOR UPDATE on top of the advisory lock: the advisory lock covers the write
  -- paths that cooperate, this covers anything else that ever touches the row.
  select * into rnd
    from rounds
   where id = v_round_id and competition_id = comp.id
     for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'round_not_found');
  end if;

  -- Idempotency. Re-settling a settled round must refuse cleanly, never
  -- double-apply.
  if rnd.status = 'settled' then
    return jsonb_build_object(
      'ok', false, 'code', 'already_settled',
      'detail', jsonb_build_object('round_number', rnd.round_number)
    );
  end if;

  -- Picks can still change while the round is open. Settling now would
  -- auto-assign teams to entries that still have time to choose. Mirrors
  -- isRoundOpen() in lib/lms-db.ts exactly: only 'pending' can be open, and
  -- 'locked' (a provisional win) never is.
  if rnd.status = 'pending' and now() < rnd.deadline then
    return jsonb_build_object(
      'ok', false, 'code', 'round_open',
      'detail', jsonb_build_object('round_number', rnd.round_number)
    );
  end if;

  if rnd.matchday <> v_matchday then
    return jsonb_build_object('ok', false, 'code', 'round_changed');
  end if;

  -- ---- 3. prove the state the plan was computed from still holds ---------
  --
  -- Three fingerprints, each an order-normalised jsonb array so a straight
  -- equality test is a set comparison. Any mismatch means the world moved after
  -- the plan was computed and the plan may now be wrong — refuse, change
  -- nothing, let the organiser re-run against fresh state.

  -- 3a. fixtures for the matchday: their status and result ARE the settlement.
  -- If the cron filled a result, or an admin marked a game postponed, between
  -- the plan and here, every outcome in the plan is suspect.
  select coalesce(jsonb_agg(
           jsonb_build_object('id', f.id::int, 'status', f.status, 'result', f.result)
           order by f.id
         ), '[]'::jsonb)
    into v_actual
    from fixtures f
   where f.matchday = v_matchday;

  select coalesce(jsonb_agg(
           jsonb_build_object('id', (e->>'id')::int, 'status', e->>'status', 'result', e->'result')
           order by (e->>'id')::int
         ), '[]'::jsonb)
    into v_expected
    from jsonb_array_elements(coalesce(p_plan->'expected_fixtures', '[]'::jsonb)) e;

  if v_actual = '[]'::jsonb then
    return jsonb_build_object(
      'ok', false, 'code', 'no_fixtures',
      'detail', jsonb_build_object('matchday', v_matchday)
    );
  end if;
  if v_actual <> v_expected then
    return jsonb_build_object('ok', false, 'code', 'fixtures_changed');
  end if;

  -- 3b. the round's picks. A pick landing between plan and apply would be
  -- settled against nothing, or wrongly auto-assigned over.
  select coalesce(jsonb_agg(
           jsonb_build_object('entry_id', p.entry_id, 'team_id', p.team_id::int)
           order by p.entry_id
         ), '[]'::jsonb)
    into v_actual
    from picks p
   where p.round_id = rnd.id;

  select coalesce(jsonb_agg(
           jsonb_build_object('entry_id', (e->>'entry_id')::uuid, 'team_id', (e->>'team_id')::int)
           order by (e->>'entry_id')::uuid
         ), '[]'::jsonb)
    into v_expected
    from jsonb_array_elements(coalesce(p_plan->'expected_picks', '[]'::jsonb)) e;

  if v_actual <> v_expected then
    return jsonb_build_object('ok', false, 'code', 'picks_changed');
  end if;

  -- 3c. who is still standing. An entry added, deleted or already eliminated
  -- since the plan changes both the settlement and the end state.
  select coalesce(jsonb_agg(to_jsonb(e.id) order by e.id), '[]'::jsonb)
    into v_actual
    from entries e
   where e.competition_id = comp.id and e.status = 'active';

  select coalesce(jsonb_agg(to_jsonb(e::text::uuid) order by e::text::uuid), '[]'::jsonb)
    into v_expected
    from jsonb_array_elements_text(coalesce(p_plan->'expected_active_entry_ids', '[]'::jsonb)) e;

  if v_actual = '[]'::jsonb then
    return jsonb_build_object('ok', false, 'code', 'no_active_entries');
  end if;
  if v_actual <> v_expected then
    return jsonb_build_object('ok', false, 'code', 'entries_changed');
  end if;

  select jsonb_array_length(v_actual) into v_active_count;

  -- 3d. the plan must be COMPLETE: one settled outcome for every active entry,
  -- and none of them 'pending'. This is a structural check, not a re-derivation
  -- of the rules — it catches a plan built from a half-resulted matchday
  -- without teaching this function how the rules work.
  select count(*) into v_outcome_count
    from jsonb_array_elements(coalesce(p_plan->'pick_outcomes', '[]'::jsonb)) o
   where o->>'outcome' in ('survived', 'eliminated');

  if v_outcome_count <> v_active_count then
    return jsonb_build_object(
      'ok', false, 'code', 'incomplete_plan',
      'detail', jsonb_build_object('active', v_active_count, 'settled', v_outcome_count)
    );
  end if;

  -- ======================================================================
  -- VALIDATION PASSED. Everything below is the apply, and every statement
  -- from here shares one transaction: any failure — including the DEFERRABLE
  -- won-integrity trigger firing at COMMIT — rolls the whole thing back.
  -- ======================================================================

  -- ---- 4. auto-assigned picks for entries that missed the deadline -------
  -- Written only now, once settlement is certain, exactly as before: an early
  -- or refused settle leaves everyone's picks as they were.
  insert into picks (competition_id, entry_id, round_id, team_id, auto_assigned, outcome)
  select comp.id,
         (a->>'entry_id')::uuid,
         rnd.id,
         (a->>'team_id')::smallint,
         true,
         coalesce(
           (select o->>'outcome'
              from jsonb_array_elements(coalesce(p_plan->'pick_outcomes', '[]'::jsonb)) o
             where o->>'entry_id' = a->>'entry_id'),
           'pending'
         )
    from jsonb_array_elements(coalesce(p_plan->'auto_assign', '[]'::jsonb)) a;

  -- ---- 5. outcomes on the picks that were already there ------------------
  update picks p
     set outcome = o.outcome
    from (
      select (e->>'entry_id')::uuid as entry_id, e->>'outcome' as outcome
        from jsonb_array_elements(coalesce(p_plan->'pick_outcomes', '[]'::jsonb)) e
    ) o
   where p.round_id = rnd.id
     and p.entry_id = o.entry_id
     and p.outcome is distinct from o.outcome;

  -- ---- 6. eliminations ---------------------------------------------------
  -- Guarded on status = 'active' so a re-settle after a provisional lock does
  -- not re-stamp an entry that already went out in this round.
  with victims as (
    select (e::text::uuid) as entry_id
      from jsonb_array_elements_text(coalesce(p_plan->'eliminate_entry_ids', '[]'::jsonb)) e
  )
  update entries en
     set status = 'eliminated',
         eliminated_round_id = rnd.id
    from victims v
   where en.id = v.entry_id
     and en.competition_id = comp.id
     and en.status = 'active';
  get diagnostics v_eliminated = row_count;

  -- ---- 7. the end state --------------------------------------------------
  if v_end_kind = 'provisional' then
    -- A win resting solely on postponed/abandoned fixtures. Per the rules a
    -- player cannot win outright on one, so this round is DELIBERATELY not
    -- settled: 'locked' keeps it the current round, keeps picks closed, and
    -- leaves it re-settleable once the real result lands. Same semantics as the
    -- old lockRound(), now inside the transaction with the pick outcomes and
    -- eliminations above.
    update rounds set status = 'locked' where id = rnd.id;

    return jsonb_build_object(
      'ok', true, 'code', 'locked_provisional',
      'round_number', rnd.round_number,
      'eliminated', v_eliminated
    );
  end if;

  if v_end_kind = 'rollover' then
    update competitions set status = 'rolled_over' where id = comp.id;

  elsif v_end_kind = 'won' then
    -- Entries first, THEN the competition. The won-integrity trigger is
    -- DEFERRABLE INITIALLY DEFERRED so either order commits, but the documented
    -- order is kept: it is the order the invariant reads in, and it is what
    -- makes the intent legible to the next reader.
    update entries en
       set status = 'winner'
      from (
        select (e::text::uuid) as entry_id
          from jsonb_array_elements_text(
                 coalesce(p_plan->'end'->'winner_entry_ids', '[]'::jsonb)) e
      ) w
     where en.id = w.entry_id
       and en.competition_id = comp.id
       and en.status = 'active';

    update competitions
       set status = 'won',
           winner_participant_id = (p_plan->'end'->>'participant_id')::uuid
     where id = comp.id;
  end if;

  -- The round is flagged settled LAST, for the same reason it always was: the
  -- settled flag is what blocks a re-run. Inside a transaction this is belt and
  -- braces rather than load-bearing — nothing here can half-apply any more —
  -- but a failed competition write must never leave a settled round behind.
  update rounds set status = 'settled' where id = rnd.id;

  select count(*) into v_survivors
    from entries e
   where e.competition_id = comp.id and e.status in ('active', 'winner');

  return jsonb_build_object(
    'ok', true, 'code', 'settled',
    'end_kind', v_end_kind,
    'round_number', rnd.round_number,
    'eliminated', v_eliminated,
    'survivors', v_survivors
  );
end;
$$;

comment on function lms_settle_round(jsonb) is
  'Atomically apply a settlement plan computed by lib/lms.ts. Validates that round, fixtures, picks and active entries are unchanged since the plan, then applies everything in one transaction.';


-- ----------------------------------------------------------------------------
-- lms_apply_fixture_results(updates) — the results cron's write, in ONE
-- transaction, under the settlement lock.
--
-- The cron used to loop one PostgREST update per fixture, each its own
-- transaction, having checked the settled-round guard beforehand. That guard
-- could go stale mid-loop. Here the guard is re-read inside the same
-- transaction and the same lock as settlement, so a settle cannot land between
-- the check and the write.
--
-- Per-fixture preconditions are still re-asserted (still 'scheduled', still no
-- result) — manual entry always wins — and a fixture failing them is reported
-- as skipped rather than aborting the batch: one stale row must not cost the
-- other nine results.
--
-- THE WAIT IS BOUNDED. Unlike settlement — where an organiser has pressed a
-- button and should be made to wait for their answer — this is an unattended
-- daily job with nobody watching. Blocking indefinitely on the lock would just
-- burn the platform's function timeout and fail opaquely. Instead it waits
-- p_lock_timeout for the lock and, if settlement still holds it, returns
-- busy = true having written NOTHING. The caller reports the run as skipped and
-- the next scheduled run picks the results up; nothing is lost, because filling
-- a result is not time-critical and the feed is re-read from scratch every run.
--
--   updates: [{fixture_id, home_score, away_score, result}]
--   returns: { busy: bool,
--              updated: [{fixture_id, home_score, away_score, result}],
--              changed_underneath: n,
--              round_settled: [{fixture_id, round_number}] }
-- ----------------------------------------------------------------------------

-- The signature gained a parameter, so the single-argument version has to go
-- explicitly: CREATE OR REPLACE would leave it behind as an overload, and
-- PostgREST would then have two candidates to choose between.
drop function if exists lms_apply_fixture_results(jsonb);

create or replace function lms_apply_fixture_results(
  p_updates      jsonb,
  p_lock_timeout text default '5s'
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  u             jsonb;
  fx            fixtures%rowtype;
  v_round_no    smallint;
  v_updated     jsonb := '[]'::jsonb;
  v_settled     jsonb := '[]'::jsonb;
  v_changed     int   := 0;
begin
  begin
    -- lock_timeout bounds any wait for a lock, advisory locks included. Set
    -- transaction-locally so it cannot leak into another statement.
    perform set_config('lock_timeout', p_lock_timeout, true);
    perform pg_advisory_xact_lock(lms_lock_key());
  exception when lock_not_available then
    -- Settlement is mid-flight. Give up cleanly rather than half-waiting: no
    -- fixture has been read, let alone written.
    return jsonb_build_object(
      'busy', true,
      'updated', '[]'::jsonb,
      'changed_underneath', 0,
      'round_settled', '[]'::jsonb
    );
  end;

  -- We hold the lock now, so nothing below should ever have to wait. Clear the
  -- timeout again so a slow-but-legitimate row lock cannot fail the batch.
  perform set_config('lock_timeout', '0', true);

  for u in select * from jsonb_array_elements(coalesce(p_updates, '[]'::jsonb))
  loop
    select * into fx
      from fixtures
     where id = (u->>'fixture_id')::int
       for update;

    if not found then
      v_changed := v_changed + 1;
      continue;
    end if;

    -- Manual entry always wins. `result is null` alone is not enough: an admin
    -- who marks a game postponed leaves result null, and without the status
    -- check we would flip it back to played and hand a result to a pick the
    -- rules say should have SURVIVED.
    if fx.status <> 'scheduled' or fx.result is not null then
      v_changed := v_changed + 1;
      continue;
    end if;

    -- The settled-round guard, re-read under the lock.
    --
    -- Scoped to the ACTIVE competition, as the route's version was:
    -- rounds_unique_matchday is unique (competition_id, matchday), so the same
    -- matchday legitimately recurs across competitions, and an unscoped lookup
    -- would let a long-finished competition's settled rounds block
    -- result-filling for the rest of the season. With no competition active the
    -- guard is simply empty — filling results in the gap after a rollover is
    -- exactly what lets the next competition settle cleanly.
    select r.round_number into v_round_no
      from rounds r
      join competitions c on c.id = r.competition_id
     where c.status = 'active'
       and r.matchday = fx.matchday
       and r.status = 'settled'
     limit 1;

    if found then
      v_settled := v_settled || jsonb_build_object(
        'fixture_id', fx.id, 'round_number', v_round_no
      );
      continue;
    end if;

    update fixtures
       set home_score = (u->>'home_score')::smallint,
           away_score = (u->>'away_score')::smallint,
           status     = 'played',
           result     = u->>'result'
     where id = fx.id;

    v_updated := v_updated || jsonb_build_object(
      'fixture_id',  fx.id,
      'home_score',  (u->>'home_score')::int,
      'away_score',  (u->>'away_score')::int,
      'result',      u->>'result'
    );
  end loop;

  return jsonb_build_object(
    'busy',               false,
    'updated',            v_updated,
    'changed_underneath', v_changed,
    'round_settled',      v_settled
  );
end;
$$;

comment on function lms_apply_fixture_results(jsonb, text) is
  'Results-cron write path: applies feed results in one transaction under the settlement lock, re-checking the settled-round guard inside it.';


-- ----------------------------------------------------------------------------
-- lms_set_fixture_result(...) — the manual admin write, under the same lock.
--
-- /admin/results has the identical time-of-check/time-of-use gap as the cron:
-- it reads "has this matchday been settled?", then writes. Routing it through
-- the lock closes the last way a fixture result can change out from under a
-- settlement that is already committing.
--
-- The settled-round guard here is deliberately NOT scoped to the active
-- competition, because that is what the route did before this change and this
-- pass is not the place to alter it. It is stricter than the cron's, so it errs
-- towards refusing an edit — the safe direction. (Worth revisiting: a settled
-- matchday from a finished competition currently blocks manual edits to those
-- fixtures for the rest of the season, which is the same over-reach the cron's
-- guard was deliberately scoped to avoid.)
--
--   returns: { ok: true } | { ok: false, code: 'not_found'|'round_settled',
--                             round_number }
-- ----------------------------------------------------------------------------
create or replace function lms_set_fixture_result(
  p_fixture_id int,
  p_status     text,
  p_result     text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  fx         fixtures%rowtype;
  v_round_no smallint;
begin
  perform pg_advisory_xact_lock(lms_lock_key());

  select * into fx from fixtures where id = p_fixture_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select r.round_number into v_round_no
    from rounds r
   where r.matchday = fx.matchday
     and r.status = 'settled'
   limit 1;

  if found then
    return jsonb_build_object(
      'ok', false, 'code', 'round_settled', 'round_number', v_round_no
    );
  end if;

  update fixtures
     set status = p_status,
         result = p_result
   where id = fx.id;

  return jsonb_build_object('ok', true);
end;
$$;

comment on function lms_set_fixture_result(int, text, text) is
  'Manual /admin/results fixture write, under the settlement lock with the settled-round guard re-checked inside the transaction.';


-- ----------------------------------------------------------------------------
-- Grants.
--
-- Postgres grants EXECUTE on a new function to PUBLIC by default, which with
-- Supabase's setup would make all three callable with the publishable (anon)
-- key. Revoke, then grant to service_role only — the secret key used by
-- lib/supabase-server.ts.
-- ----------------------------------------------------------------------------
revoke all on function lms_lock_key()                          from public, anon, authenticated;
revoke all on function lms_settle_round(jsonb)                 from public, anon, authenticated;
revoke all on function lms_apply_fixture_results(jsonb, text)  from public, anon, authenticated;
revoke all on function lms_set_fixture_result(int, text, text) from public, anon, authenticated;

grant execute on function lms_lock_key()                          to service_role;
grant execute on function lms_settle_round(jsonb)                 to service_role;
grant execute on function lms_apply_fixture_results(jsonb, text)  to service_role;
grant execute on function lms_set_fixture_result(int, text, text) to service_role;
