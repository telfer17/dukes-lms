-- ============================================================================
-- Dukes — Last Man Standing: REOPEN A SETTLED ROUND
-- ============================================================================
--
-- Paste this whole file into the Supabase SQL editor and run it, AFTER
-- db/lms-schema.sql, db/settlement-fn.sql, db/buyback.sql and
-- db/lock-round.sql. It is re-runnable (CREATE OR REPLACE throughout) and
-- touches no data on its own.
--
-- WHY THIS FILE EXISTS
-- --------------------
-- Settlement is atomic and one-way: lms_settle_round() refuses a round that is
-- already settled, and lms_set_fixture_result() refuses to change a result on
-- a settled matchday. That is the right default — a settled round is a result
-- people have been told — but it leaves no door for the one thing that does
-- happen: a fixture result typed in wrong, and the round settled on it. Until
-- now the only fix was hand-written SQL (correct the fixture, flip the pick
-- outcome, revive the entries, un-crown the competition), which is exactly the
-- kind of multi-table edit that goes wrong at eleven at night.
--
-- lms_reopen_round() is that fix, made safe and repeatable. It REVERSES a
-- settled round's effects — atomically, under the same lock as settlement —
-- and returns the round to a state that lms_settle_round() will accept again.
-- The organiser then corrects the result on /admin/results and presses Settle
-- like any other week. The rules are NOT re-derived here: this function undoes
-- the writes settlement made and nothing else. Re-settling is what decides the
-- new outcome, through the engine, as always.
--
-- WHAT IT DOES (all in one transaction)
-- -------------------------------------
--   rounds        settled → locked. 'locked' is the "deadline has passed,
--                 picks are closed, settle me again" state this app already
--                 has (the provisional-win lock uses it), so the round is the
--                 current round again, fixture results become editable, and the
--                 public leaderboard shows the live view while the correction
--                 is made. locked_at is untouched: locking is about picks, and
--                 the picks are not being changed.
--   picks         every outcome for THIS round → pending.
--   entries       eliminated IN THIS ROUND (eliminated_round_id = this round)
--                 → active, eliminated_round_id cleared.
--                 status = 'winner' → active. (See the latest-round guard for
--                 why every winner entry belongs to this round's settlement.)
--   competitions  'won' or 'rolled_over' → 'active', winner_participant_id
--                 cleared in the same statement so the won-integrity trigger is
--                 satisfied at COMMIT.
--
-- WHAT IT DOES NOT TOUCH
-- ----------------------
--   * Fixture results. Correcting the result is the organiser's next step, on
--     the same screen, through lms_set_fixture_result() as usual.
--   * Auto-assigned picks. Settlement's backstop (and the Lock button) write a
--     pick for any entry that missed the deadline. Those rows STAY. They were
--     drawn from a seed fixed by entry and round (docs/LMS-RULES.md § Locking
--     a round) so a re-settle would assign the identical team anyway — deleting
--     them changes nothing about the outcome, and would open a door the rules
--     keep shut: a "late pick" entered for that entry after the deadline. A
--     filled pick is permanent; reopening is about the RESULT, not the picks.
--   * Buy-backs. A buy-back is money that changed hands. If an entry eliminated
--     in this round has already bought back, it is already active and this
--     function leaves it (and its buybacks row) alone. If the corrected result
--     then turns out to have kept that entry in all along, the £10 is the
--     organiser's to refund — that is a decision, not something to guess at.
--     The count is reported back (buybacks_on_round) so the screen can say so.
--   * Any other round. Only this round's settlement effects are reversed.
--
-- THE LATEST-ROUND GUARD
-- ----------------------
-- Only the MOST RECENTLY SETTLED round of a competition may be reopened, and
-- only if no later round has had any settlement effect applied at all. A later
-- round settles on THIS round's survivors: it eliminated people from among
-- those this round let through, and its auto-assignments were drawn from their
-- used-team history. Reviving somebody here would leave them "active" having
-- never picked in the later round, with a later-round elimination list that no
-- longer describes the field it was computed from. There is no way to unpick
-- that from below, so the function refuses ('not_latest') and names the later
-- round. To correct an older round, reopen from the latest backwards — each
-- reopen leaves the round in a re-settleable state, so the organiser can walk
-- back as far as needed and settle forward again.
--
-- A later round in status 'locked' counts as "has settlement effects": that is
-- the provisional-win lock, which applies pick outcomes and eliminations inside
-- its transaction (db/settlement-fn.sql § 7). Only a 'pending' later round is
-- untouched by settlement and therefore safe to have around.
--
-- The same guard is what makes the competition revert safe. Nothing records
-- WHICH round concluded a competition, and it does not need to: a competition
-- can only be won or rolled over on the outcome of its latest non-pending round
-- — directly by lms_settle_round(), or by lms_finalise_competition() once that
-- round's buy-back window has closed. If this round passes the guard and the
-- competition is concluded, it was concluded on this round.
--
-- THE SINGLE-ACTIVE GUARD
-- -----------------------
-- competitions_single_active (db/lms-schema.sql) allows one 'active' row. If a
-- successor competition has already been created after a rollover (or a new
-- season started after a win), reverting this one to 'active' would violate it.
-- Rather than surface a unique-violation, the function checks first and
-- refuses ('another_competition_active'). Undoing a rollover that already has
-- a successor with entries paid in is not a one-button job, and should not
-- pretend to be.
--
-- THE LOCK
-- --------
-- Same transaction-scoped advisory lock as every other LMS write path
-- (lms_lock_key(), db/settlement-fn.sql), taken before anything is read, so a
-- reopen can never interleave with a settle, a fixture write, a lock or a
-- buy-back. Then FOR UPDATE on the round and the competition row.
--
--   returns: { ok: true, code: 'reopened', round_number,
--              revived, winners_reverted, outcomes_reset,
--              competition_reverted_from: 'won'|'rolled_over'|null,
--              buybacks_on_round }
--          | { ok: false, code: 'round_not_found'
--                             | 'not_settled'                 { round_number, status }
--                             | 'not_latest'                  { round_number, later_round_number, later_status }
--                             | 'another_competition_active'  { round_number },
--              detail }
--
-- Refusals are all decided before the first write, so a refused call has
-- changed nothing by construction. Genuine faults during apply raise and roll
-- the whole transaction back.
-- ============================================================================

create or replace function lms_reopen_round(p_round_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  rnd    rounds%rowtype;
  comp   competitions%rowtype;
  later  rounds%rowtype;

  v_reverted_from   text;
  v_revived         int;
  v_winners         int;
  v_outcomes        int;
  v_buybacks        int;
begin
  -- ---- 0. the lock, before anything is read ----------------------------
  perform pg_advisory_xact_lock(lms_lock_key());

  if p_round_id is null then
    return jsonb_build_object('ok', false, 'code', 'round_not_found');
  end if;

  -- ---- 1. the round, pinned ---------------------------------------------
  select * into rnd from rounds where id = p_round_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'round_not_found');
  end if;

  -- The competition too. Deliberately NOT "the active competition": the whole
  -- point may be to un-crown a competition that is already 'won'.
  select * into comp from competitions where id = rnd.competition_id for update;

  -- ---- 2. only a settled round can be reopened --------------------------
  if rnd.status <> 'settled' then
    return jsonb_build_object(
      'ok', false, 'code', 'not_settled',
      'detail', jsonb_build_object(
        'round_number', rnd.round_number, 'status', rnd.status)
    );
  end if;

  -- ---- 3. the latest-round guard ----------------------------------------
  -- Any later round that settlement has touched — settled, or provisionally
  -- locked — was computed on this round's survivors. Refuse, and say which.
  select * into later
    from rounds r
   where r.competition_id = comp.id
     and r.round_number > rnd.round_number
     and r.status <> 'pending'
   order by r.round_number
   limit 1;

  if found then
    return jsonb_build_object(
      'ok', false, 'code', 'not_latest',
      'detail', jsonb_build_object(
        'round_number', rnd.round_number,
        'later_round_number', later.round_number,
        'later_status', later.status)
    );
  end if;

  -- ---- 4. the single-active guard ---------------------------------------
  if comp.status <> 'active' and exists (
       select 1 from competitions c
        where c.status = 'active' and c.id <> comp.id
     ) then
    return jsonb_build_object(
      'ok', false, 'code', 'another_competition_active',
      'detail', jsonb_build_object('round_number', rnd.round_number)
    );
  end if;

  -- Reported, never acted on — see the header.
  select count(*) into v_buybacks
    from buybacks b
   where b.eliminated_round_id = rnd.id;

  -- ======================================================================
  -- GUARDS PASSED. Everything below is the reversal, in one transaction.
  -- ======================================================================

  -- ---- 5. the competition, if this round concluded it --------------------
  -- Status and winner in ONE statement: the won-integrity trigger is deferred
  -- to COMMIT, and by then this row is 'active', which carries no invariant.
  v_reverted_from := case when comp.status in ('won', 'rolled_over')
                          then comp.status else null end;

  if v_reverted_from is not null then
    update competitions
       set status = 'active',
           winner_participant_id = null
     where id = comp.id;
  end if;

  -- ---- 6. winners back to active -----------------------------------------
  -- Every 'winner' entry in the competition was crowned on this round (see the
  -- latest-round guard), whether by lms_settle_round or lms_finalise_competition.
  update entries en
     set status = 'active'
   where en.competition_id = comp.id
     and en.status = 'winner';
  get diagnostics v_winners = row_count;

  -- ---- 7. revive the entries THIS round eliminated -----------------------
  -- Scoped by eliminated_round_id, never by "everyone eliminated": entries that
  -- went out in earlier rounds stay out. An entry that has already bought back
  -- is 'active' with a NULL eliminated_round_id and is untouched here.
  update entries en
     set status = 'active',
         eliminated_round_id = null
   where en.competition_id = comp.id
     and en.status = 'eliminated'
     and en.eliminated_round_id = rnd.id;
  get diagnostics v_revived = row_count;

  -- ---- 8. this round's pick outcomes back to pending ---------------------
  -- Auto-assigned rows included — the OUTCOME is reset, the pick stays.
  update picks p
     set outcome = 'pending'
   where p.round_id = rnd.id
     and p.outcome <> 'pending';
  get diagnostics v_outcomes = row_count;

  -- ---- 9. the round itself, LAST -----------------------------------------
  -- Last for the same reason settlement flags 'settled' last: the round's
  -- status is what every other path reads to decide whether this round is
  -- done. A failure anywhere above must never leave a reopened-looking round
  -- above un-reopened players. Inside one transaction this is belt and braces,
  -- and it is also what lets the integration suite force a failure at the very
  -- end and prove nothing else moved.
  update rounds set status = 'locked' where id = rnd.id;

  return jsonb_build_object(
    'ok', true, 'code', 'reopened',
    'round_number', rnd.round_number,
    'revived', v_revived,
    'winners_reverted', v_winners,
    'outcomes_reset', v_outcomes,
    'competition_reverted_from', v_reverted_from,
    'buybacks_on_round', v_buybacks
  );
end;
$$;

comment on function lms_reopen_round(uuid) is
  'Reverse a settled round''s settlement effects atomically (round → locked, this round''s eliminations revived, winners and a won/rolled-over competition reverted, pick outcomes → pending) so it can be corrected and settled again. Only the latest settled round of a competition can be reopened.';


-- ----------------------------------------------------------------------------
-- Grants, matching db/settlement-fn.sql: server-side secret key only.
-- ----------------------------------------------------------------------------
revoke all on function lms_reopen_round(uuid) from public, anon, authenticated;
grant execute on function lms_reopen_round(uuid) to service_role;


-- ============================================================================
-- VERIFY — run this one line afterwards. It should say OK.
-- ============================================================================
-- select to_regprocedure('public.lms_reopen_round(uuid)') is not null as reopen_fn;
