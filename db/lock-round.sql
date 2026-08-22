-- ============================================================================
-- Dukes — Last Man Standing: LOCK ROUND
-- ============================================================================
--
-- Paste this whole file into the Supabase SQL editor and run it, AFTER
-- db/lms-schema.sql, db/settlement-fn.sql and db/buyback.sql. It is ADDITIVE
-- and RE-RUNNABLE.
--
-- THEN RE-RUN db/settlement-fn.sql. Its "every picked fixture has a result"
-- guard has changed: a team with NO game this matchday is no longer a missing
-- result to wait for, it is an entry that is out (see below). The verify query
-- at the bottom checks whether that has been done.
--
-- Rules this implements: docs/LMS-RULES.md § Locking a round.
--
--   * After the deadline the organiser presses Lock round.
--   * Every entry with NO pick is assigned one at RANDOM, from the teams it has
--     not used, preferring the ones playing that matchday — and if it has none
--     playing, one that is not playing, which cannot win (decision 1).
--   * The draw is SEEDED on (entry, round) in lib/lms.ts, so it does not matter
--     who presses Lock, when, or how often.
--   * Locking is IDEMPOTENT (decision 2) and a round with no blanks may still
--     be locked (decision 3).
--
-- WHY A COLUMN AND NOT rounds.status = 'locked'
-- --------------------------------------------
-- `rounds.status` already HAS a 'locked' value and it means something else
-- entirely: a provisional win, where the last entry standing survived only on a
-- postponed fixture, so the round is deliberately held unsettled until the game
-- is played (db/settlement-fn.sql, end kind 'provisional'). Reusing it would
-- have broken three things:
--
--   1. lms_settle_round refuses to settle a round that is `status = 'pending'
--      and now() < deadline` — the "round still open" guard. A round locked
--      BEFORE its deadline (which the rules allow, with a warning) would no
--      longer be 'pending', so that guard would silently stop firing and an
--      open round could be settled.
--   2. buybackEligibility treats any round that is not 'pending' as a shut
--      buy-back window. Pick-locking round N+1 would slam the window on
--      everyone eliminated in round N, days early.
--   3. "Locked" would stop meaning one thing. The provisional lock is about the
--      RESULT; this lock is about the PICKS. A reader — or a query — could no
--      longer tell which had happened.
--
-- So locking gets its own column. It carries a timestamp rather than a boolean
-- because "when were the blanks filled?" is the question anyone asks afterwards,
-- and a boolean cannot answer it.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- rounds.locked_at — when this round's blanks were filled. NULL = never locked.
--
-- Deliberately independent of rounds.status: a round can be locked and pending,
-- locked and settled, or settled having never been locked at all (the backstop
-- in lms_settle_round fills the blanks in that case, with the same seeded draw).
-- ----------------------------------------------------------------------------
alter table rounds add column if not exists locked_at timestamptz;

comment on column rounds.locked_at is
  'When the organiser locked this round and blanks were auto-assigned. NULL = not locked. Independent of status — this is about PICKS, status is about the result.';

create index if not exists rounds_locked_at_idx on rounds (locked_at);


-- ----------------------------------------------------------------------------
-- lms_lock_round(plan) — fill this round's blanks and mark it locked.
--
-- Same PLAN → VALIDATE → APPLY shape as settlement: lib/lms.ts draws the teams
-- (seeded, so the answer is fixed before this is called) and this applies them
-- atomically under the shared settlement lock.
--
-- IDEMPOTENCE IS STRUCTURAL, not a check. The insert selects only entries that
-- are still ACTIVE and still have NO pick for this round, and carries
-- ON CONFLICT DO NOTHING on top. So:
--
--   * locking twice assigns nothing the second time;
--   * a pick the organiser typed in between the plan and this call WINS — it is
--     already there, so the row is skipped rather than overwritten. That is
--     decision 5: locking and editing are independent, in either order, and
--     neither can clobber the other.
--
-- A pick already on the record is never touched, whether it was typed in or
-- assigned by an earlier lock.
--
-- Plan shape:
--   { competition_id, round_id, assign: [{entry_id, team_id}] }
--
--   returns: { ok: true, code: 'locked', assigned, skipped, blanks_remaining,
--              already_locked, locked_at }
--          | { ok: false, code: <reason>, detail: <jsonb|null> }
-- ----------------------------------------------------------------------------
create or replace function lms_lock_round(p_plan jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_competition_id uuid := (p_plan->>'competition_id')::uuid;
  v_round_id       uuid := (p_plan->>'round_id')::uuid;

  comp   competitions%rowtype;
  rnd    rounds%rowtype;

  v_requested int;
  v_assigned  int;
  v_blanks    int;
  v_was_locked timestamptz;
begin
  perform pg_advisory_xact_lock(lms_lock_key());

  if v_competition_id is null or v_round_id is null then
    return jsonb_build_object('ok', false, 'code', 'malformed_plan');
  end if;

  select * into comp from competitions where id = v_competition_id;
  if not found or comp.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'no_active_competition');
  end if;

  select * into rnd
    from rounds
   where id = v_round_id and competition_id = comp.id
     for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'round_not_found');
  end if;

  -- A settled round's picks decided who went out and it has been announced.
  -- Writing a new pick into it now would contradict the board.
  if rnd.status = 'settled' then
    return jsonb_build_object(
      'ok', false, 'code', 'round_settled',
      'detail', jsonb_build_object('round_number', rnd.round_number)
    );
  end if;

  v_was_locked := rnd.locked_at;

  select count(*) into v_requested
    from jsonb_array_elements(coalesce(p_plan->'assign', '[]'::jsonb));

  -- ---- the assignments ---------------------------------------------------
  -- Note what is NOT here: any rule. Which team each entry gets was decided by
  -- autoAssignTeam() in lib/lms.ts, from a seed seeded on (entry, round). This
  -- only writes them, and only where there is a blank to fill.
  insert into picks (competition_id, entry_id, round_id, team_id, auto_assigned, outcome)
  select comp.id,
         (a->>'entry_id')::uuid,
         rnd.id,
         (a->>'team_id')::smallint,
         true,
         'pending'
    from jsonb_array_elements(coalesce(p_plan->'assign', '[]'::jsonb)) a
    join entries en
      on en.id = (a->>'entry_id')::uuid
     and en.competition_id = comp.id
     and en.status = 'active'
   where not exists (
     select 1 from picks p
      where p.entry_id = en.id and p.round_id = rnd.id
   )
  on conflict (entry_id, round_id) do nothing;

  get diagnostics v_assigned = row_count;

  -- Anyone still without a pick — an entry that appeared after the plan was
  -- computed, or one the draw could not fill. Reported rather than raised: the
  -- organiser presses Lock again and the new blank is filled, with the same
  -- seeded draw it would have had the first time.
  select count(*) into v_blanks
    from entries en
   where en.competition_id = comp.id
     and en.status = 'active'
     and not exists (
       select 1 from picks p
        where p.entry_id = en.id and p.round_id = rnd.id
     );

  -- coalesce, not overwrite: the round was locked WHEN it was first locked.
  -- Re-locking to fill a late blank must not rewrite that history.
  update rounds
     set locked_at = coalesce(locked_at, now())
   where id = rnd.id;

  select locked_at into v_was_locked from rounds where id = rnd.id;

  return jsonb_build_object(
    'ok', true,
    'code', 'locked',
    'round_number', rnd.round_number,
    'assigned', v_assigned,
    'skipped', v_requested - v_assigned,
    'blanks_remaining', v_blanks,
    'already_locked', (rnd.locked_at is not null),
    'locked_at', v_was_locked
  );
end;
$$;

comment on function lms_lock_round(jsonb) is
  'Fill a round''s blank picks with the seeded-random teams lib/lms.ts drew, and mark the round locked. Idempotent: never touches a pick that already exists.';


-- ----------------------------------------------------------------------------
-- Grants — service_role only, like every other LMS function.
-- ----------------------------------------------------------------------------
revoke all on function lms_lock_round(jsonb) from public, anon, authenticated;
grant execute on function lms_lock_round(jsonb) to service_role;


-- ============================================================================
-- VERIFY — run this one line afterwards. Every column should say true.
-- ============================================================================
-- select exists (select 1 from information_schema.columns where table_name = 'rounds' and column_name = 'locked_at') as locked_at_column, to_regprocedure('public.lms_lock_round(jsonb)') is not null as lock_fn, (select prosrc not like '%no matchday%' from pg_proc where proname = 'lms_settle_round') as settlement_fn_reran;
