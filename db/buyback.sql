-- ============================================================================
-- Dukes — Last Man Standing: BUY-BACK
-- ============================================================================
--
-- Paste this whole file into the Supabase SQL editor and run it, AFTER
-- db/lms-schema.sql and db/settlement-fn.sql. It is ADDITIVE and RE-RUNNABLE:
-- every object uses IF NOT EXISTS / CREATE OR REPLACE / DROP-then-CREATE, so
-- running it twice changes nothing the second time.
--
-- THEN RE-RUN db/settlement-fn.sql. lms_settle_round() lives there and it is
-- the file's own contract that pasting it converges the database; it now knows
-- one more end kind ('pending' — the round is settled, but the competition's
-- end is waiting on a buy-back window). The verify query at the bottom of this
-- file checks whether that has been done and says so in as many words.
--
-- Rules this implements: docs/LMS-RULES.md § Buy-back. In short:
--   * eliminated in round 1, 2 or 3 → the owner may pay another £10 to bring
--     that ENTRY back, for the IMMEDIATELY following round only;
--   * confirmed (paid and recorded) before that round's pick deadline, or the
--     entry is permanently out — one window, never a standing option;
--   * the money is another £10, split 50/50, into THIS competition's pot;
--   * used teams PERSIST — a buy-back restores the entry's life, not its team
--     pool, so nothing here touches `picks`.
--
-- MONEY IS ALWAYS INTEGER PENCE. £10 = 1000. No floats anywhere.
--
-- WHY A TABLE AND NOT A COLUMN
-- ----------------------------
-- Three facts have to survive the transition, and a flag on `entries` can hold
-- none of them:
--
--   1. WHICH ROUND THE ENTRY WENT OUT IN. Buying back sets status back to
--      'active', and entries_eliminated_round_consistent (db/lms-schema.sql)
--      requires eliminated_round_id to be NULL for anything that is not
--      eliminated. So the elimination round is CLEARED by the revival that
--      depends on it. It is recorded here instead, permanently.
--   2. THE MONEY. A buy-back is its own £10 with its own 50/50 split. Adding
--      it to entries.amount_paid_pence would make one entry look like it paid
--      £20 for its buy-in and silently corrupt the newcomer-ladder mismatch
--      warning on /admin/entrants. A separate payment row keeps the pot
--      arithmetic exact (pot = carried-in + half of everything collected, and
--      collections are now entries + buy-backs) and keeps the audit trail.
--   3. ONE BUY-BACK PER ELIMINATION. An entry may go out and buy back more
--      than once (out R1 → back for R2 → out R2 → back for R3): eligibility is
--      decided by the round it went OUT in, not by its history. What must never
--      happen is the same elimination being bought back twice, which is a
--      unique constraint on (entry_id, eliminated_round_id) and cannot be
--      expressed by a boolean at all.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- The last round an elimination can still buy back from. A function, not a
-- literal repeated in three places: the trigger below and lms_buy_back_entry()
-- both read it, so the boundary moves in one edit if the rule ever changes.
--
-- lib/lms.ts (BUYBACK_MAX_ELIMINATED_ROUND) remains the SOURCE OF TRUTH for
-- eligibility, exactly as it is for every other rule. What lives here is a
-- backstop: the database's own refusal to record a buy-back that the rules
-- could not have permitted, for the case where a row is written by hand.
-- ----------------------------------------------------------------------------
create or replace function lms_buyback_max_elim_round()
returns smallint
language sql
immutable
as $$ select 3::smallint $$;

comment on function lms_buyback_max_elim_round() is
  'Last elimination round that may buy back (3). Backstop only — lib/lms.ts owns the rule.';


-- ----------------------------------------------------------------------------
-- buybacks — one paid re-entry of one entry into one competition.
--
-- eliminated_round_id is the round the entry went OUT in (round N); round_id is
-- the round it is coming back FOR (round N+1). Both are recorded because both
-- are load-bearing: the first is the eligibility fact that `entries` is about
-- to forget, the second is the window that was actually bought.
--
-- The composite foreign keys are the same device picks uses: they make the
-- database guarantee that the entry and both rounds belong to the competition
-- named on the row, so a buy-back can never point across competitions.
-- ----------------------------------------------------------------------------
create table if not exists buybacks (
  id                   uuid        primary key default gen_random_uuid(),
  competition_id       uuid        not null,
  entry_id             uuid        not null,
  -- The round the entry was eliminated in (N).
  eliminated_round_id  uuid        not null,
  -- The round it is bought back FOR (N+1). The window that was paid for.
  round_id             uuid        not null,
  paid                 boolean     not null default false,
  amount_paid_pence    integer     not null default 0,
  created_at           timestamptz not null default now(),

  constraint buybacks_amount_nonneg check (amount_paid_pence >= 0),

  -- ONE buy-back per elimination. The offer is per ENTRY and per ELIMINATION
  -- (docs/LMS-RULES.md): an entry that goes out again later gets a new window,
  -- but the same elimination can never be bought back twice.
  constraint buybacks_one_per_elimination unique (entry_id, eliminated_round_id),

  constraint buybacks_entry_fk foreign key (entry_id, competition_id)
    references entries (id, competition_id) on delete cascade,
  constraint buybacks_round_fk foreign key (round_id, competition_id)
    references rounds (id, competition_id) on delete cascade,
  constraint buybacks_elim_round_fk foreign key (eliminated_round_id, competition_id)
    references rounds (id, competition_id) on delete cascade
);

comment on table buybacks is
  'A paid £10 re-entry of one entry, for the round immediately after the one it went out in. The entry''s used-team history is deliberately untouched.';
comment on column buybacks.eliminated_round_id is
  'The round the entry went OUT in (N). Recorded here because reviving the entry clears entries.eliminated_round_id.';
comment on column buybacks.round_id is
  'The round bought back FOR (N+1) — the single window this payment purchased.';
comment on column buybacks.amount_paid_pence is
  'What was actually paid, in pence. Expected 1000 (£10), split 50/50 pot/club into THIS competition.';

create index if not exists buybacks_competition_idx on buybacks (competition_id);
create index if not exists buybacks_entry_idx       on buybacks (entry_id);
create index if not exists buybacks_round_idx       on buybacks (round_id);
create index if not exists buybacks_elim_round_idx  on buybacks (eliminated_round_id);


-- ----------------------------------------------------------------------------
-- Integrity: a buy-back row must describe a buy-back the rules could permit.
--
-- Deliberately narrow, and deliberately NOT a re-implementation of eligibility:
-- it asserts the two facts that are pure structure — the elimination was early
-- enough, and the window bought is the very next round — plus the one fact that
-- would corrupt a finished competition. Whether the window is still OPEN is a
-- clock question, answered in lms_buy_back_entry() where it can be decided
-- under the settlement lock rather than at some later re-check.
--
-- BEFORE INSERT OR UPDATE rather than a deferred constraint trigger: everything
-- it reads (rounds' numbers, the competition's status) is settled before the
-- row is written, so there is no legitimate intermediate state to tolerate.
-- ----------------------------------------------------------------------------
create or replace function assert_buyback_window()
returns trigger
language plpgsql
as $$
declare
  elim   rounds%rowtype;
  target rounds%rowtype;
  comp   competitions%rowtype;
begin
  select * into elim from rounds where id = new.eliminated_round_id;
  if not found then
    raise exception 'buy-back names an unknown elimination round'
      using errcode = 'check_violation';
  end if;

  select * into target from rounds where id = new.round_id;
  if not found then
    raise exception 'buy-back names an unknown round'
      using errcode = 'check_violation';
  end if;

  if elim.round_number > lms_buyback_max_elim_round() then
    raise exception
      'entry went out in round % — only eliminations in rounds 1..% can buy back',
      elim.round_number, lms_buyback_max_elim_round()
      using errcode = 'check_violation';
  end if;

  -- The immediately following round, and nothing else. This is what stops
  -- "out in R1, sit out R2, rejoin R3" being written at all.
  if target.round_number <> elim.round_number + 1 then
    raise exception
      'a buy-back for a round-% elimination must be for round %, not round %',
      elim.round_number, elim.round_number + 1, target.round_number
      using errcode = 'check_violation';
  end if;

  select * into comp from competitions where id = new.competition_id;
  if not found then
    raise exception 'buy-back names an unknown competition'
      using errcode = 'check_violation';
  end if;
  if comp.status <> 'active' then
    raise exception
      'competition % is % — a competition that is over cannot take a buy-back',
      comp.id, comp.status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- DROP + CREATE keeps the file re-runnable (CREATE TRIGGER has no IF NOT EXISTS).
drop trigger if exists buybacks_window_valid on buybacks;
create trigger buybacks_window_valid
  before insert or update on buybacks
  for each row execute function assert_buyback_window();


-- ----------------------------------------------------------------------------
-- lms_buy_back_entry(...) — record the £10 and bring the entry back, atomically.
--
-- The two writes MUST NOT half-apply. A revived entry with no payment row is a
-- free life and a wrong pot; a payment row with no revival is £10 taken for
-- nothing. One function, one transaction, under the same advisory lock every
-- other LMS write path takes (lms_lock_key(), db/settlement-fn.sql) so a
-- buy-back and a settlement can never interleave — which matters precisely
-- because a buy-back changes who is active and settlement's plan is validated
-- against exactly that set.
--
-- Shape follows lms_settle_round: refusals are ordinary answers an organiser
-- needs to read, so they come back as { ok: false, code } rather than as
-- exceptions, and every one of them is decided BEFORE the first write.
--
-- The guards here duplicate the eligibility that lib/lms.ts already computed at
-- the call site. That is the same deliberate arrangement settlement uses: the
-- caller's copy produces the sentence the organiser reads, this copy is the one
-- that is load-bearing, and this one is inside the lock.
--
--   returns: { ok: true, code: 'bought_back', round_number, entry_id }
--          | { ok: false, code: <reason>, detail: <jsonb|null> }
-- ----------------------------------------------------------------------------
create or replace function lms_buy_back_entry(
  p_entry_id     uuid,
  p_round_id     uuid,
  p_amount_pence integer,
  p_paid         boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  ent    entries%rowtype;
  elim   rounds%rowtype;
  target rounds%rowtype;
  comp   competitions%rowtype;
begin
  -- ---- 0. the lock, before anything is read --------------------------------
  perform pg_advisory_xact_lock(lms_lock_key());

  if p_entry_id is null or p_round_id is null then
    return jsonb_build_object('ok', false, 'code', 'malformed_request');
  end if;

  -- The rules require a buy-back to be PAID to count ("paid and recorded by
  -- the organiser"). An unpaid one is not a slow buy-back, it is not a
  -- buy-back — so it must not revive anybody.
  if p_paid is not true or coalesce(p_amount_pence, 0) <= 0 then
    return jsonb_build_object('ok', false, 'code', 'not_paid');
  end if;

  -- ---- 1. the entry, pinned ------------------------------------------------
  select * into ent from entries where id = p_entry_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'entry_not_found');
  end if;

  select * into comp from competitions where id = ent.competition_id;
  if not found or comp.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'competition_not_active');
  end if;

  -- Only an eliminated entry can come back. 'active' needs nothing; 'winner'
  -- is a competition that is already over.
  if ent.status <> 'eliminated' then
    return jsonb_build_object(
      'ok', false, 'code', 'entry_not_eliminated',
      'detail', jsonb_build_object('status', ent.status)
    );
  end if;

  if ent.eliminated_round_id is null then
    return jsonb_build_object('ok', false, 'code', 'no_elimination_round');
  end if;

  select * into elim from rounds where id = ent.eliminated_round_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'no_elimination_round');
  end if;

  -- ---- 2. the window ------------------------------------------------------
  if elim.round_number > lms_buyback_max_elim_round() then
    return jsonb_build_object(
      'ok', false, 'code', 'eliminated_too_late',
      'detail', jsonb_build_object('eliminated_round_number', elim.round_number)
    );
  end if;

  select * into target
    from rounds
   where id = p_round_id and competition_id = ent.competition_id
     for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'round_not_found');
  end if;

  -- The immediately following round, and only that one.
  if target.round_number <> elim.round_number + 1 then
    return jsonb_build_object(
      'ok', false, 'code', 'wrong_round',
      'detail', jsonb_build_object(
        'expected_round_number', elim.round_number + 1,
        'round_number', target.round_number
      )
    );
  end if;

  -- One window, time-boxed: it closes at that round's pick deadline. A round
  -- that is no longer 'pending' has been locked or settled, which is past the
  -- deadline by construction — checked explicitly so the refusal is honest
  -- rather than resting on the clock alone.
  if target.status <> 'pending' or now() >= target.deadline then
    return jsonb_build_object(
      'ok', false, 'code', 'window_closed',
      'detail', jsonb_build_object(
        'round_number', target.round_number,
        'deadline', target.deadline,
        'round_status', target.status
      )
    );
  end if;

  if exists (
    select 1 from buybacks b
     where b.entry_id = ent.id
       and b.eliminated_round_id = elim.id
  ) then
    return jsonb_build_object('ok', false, 'code', 'already_bought_back');
  end if;

  -- ======================================================================
  -- VALIDATION PASSED. Both writes share this transaction.
  -- ======================================================================

  insert into buybacks (
    competition_id, entry_id, eliminated_round_id, round_id, paid, amount_paid_pence
  ) values (
    ent.competition_id, ent.id, elim.id, target.id, true, p_amount_pence
  );

  -- The life comes back; the TEAM POOL DOES NOT. Nothing here touches `picks`,
  -- so the entry carries its whole used-team history into the round it returns
  -- for — including the team that put it out. That is the rule, and the way it
  -- is kept is by this statement doing nothing about it.
  --
  -- eliminated_round_id must be cleared: entries_eliminated_round_consistent
  -- allows it only on an eliminated row. The elimination itself is not lost —
  -- the buybacks row above is now its permanent record.
  update entries
     set status = 'active',
         eliminated_round_id = null
   where id = ent.id;

  return jsonb_build_object(
    'ok', true,
    'code', 'bought_back',
    'entry_id', ent.id,
    'round_number', target.round_number,
    'eliminated_round_number', elim.round_number
  );
end;
$$;

comment on function lms_buy_back_entry(uuid, uuid, integer, boolean) is
  'Record a paid £10 buy-back and return the entry to active, in one transaction under the settlement lock. Never touches picks — used teams persist.';


-- ----------------------------------------------------------------------------
-- lms_finalise_competition(plan) — confirm a rollover, or crown a winner, once
-- the buy-back window has closed.
--
-- WHY THIS IS SEPARATE FROM SETTLEMENT.
-- Before buy-back, a round that wiped out the field WAS the rollover: settling
-- it set competitions.status = 'rolled_over' in the same transaction. That is
-- now wrong. Per docs/LMS-RULES.md the round is settled, but the competition is
-- PENDING until that round's buy-back window — the next round's pick deadline —
-- closes with no buy-back taken. The same applies to a sole survivor: they are
-- not the Last Man Standing while an eliminated competitor can still pay to
-- come back.
--
-- So settlement now settles the ROUND and stops (end kind 'pending'), and this
-- function finishes the COMPETITION later, when the clock says it may.
--
-- The plan is computed by lib/lms.ts + lib/settlement-plan.ts, like every other
-- plan, and this function proves rather than re-derives:
--
--   window_closes_at   the latest instant a buy-back could still land, per the
--                      engine. NULL means no window was open at all. The
--                      function refuses until now() has passed it — the ONE
--                      guard that has to be a clock check, because it is the
--                      thing an early finalisation would get wrong.
--   expected_active_entry_ids / expected_buyback_ids
--                      fingerprints. A buy-back landing between the plan and
--                      here changes the answer completely — from "rolled over"
--                      to "still running" — so it must refuse, not apply.
--
-- Plan shape:
--   { competition_id, window_closes_at, expected_active_entry_ids: [...],
--     expected_buyback_ids: [...],
--     end: { kind: 'won'|'rollover', participant_id, winner_entry_ids: [...] } }
--
--   returns: { ok: true, code: 'finalised', end_kind, survivors }
--          | { ok: false, code: <reason>, detail: <jsonb|null> }
-- ----------------------------------------------------------------------------
create or replace function lms_finalise_competition(p_plan jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_competition_id uuid := (p_plan->>'competition_id')::uuid;
  v_end_kind       text := p_plan->'end'->>'kind';
  v_closes_at      timestamptz := nullif(p_plan->>'window_closes_at', '')::timestamptz;

  comp        competitions%rowtype;
  v_expected  jsonb;
  v_actual    jsonb;
  v_active    int;
  v_winners   int;
  v_survivors int;
begin
  perform pg_advisory_xact_lock(lms_lock_key());

  if v_competition_id is null or v_end_kind is null then
    return jsonb_build_object('ok', false, 'code', 'malformed_plan');
  end if;
  if v_end_kind not in ('won', 'rollover') then
    return jsonb_build_object('ok', false, 'code', 'malformed_plan');
  end if;

  select * into comp from competitions where id = v_competition_id for update;
  if not found or comp.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'no_active_competition');
  end if;

  -- ---- the window. The whole reason this function exists. -----------------
  if v_closes_at is not null and now() < v_closes_at then
    return jsonb_build_object(
      'ok', false, 'code', 'window_open',
      'detail', jsonb_build_object('closes_at', v_closes_at)
    );
  end if;

  -- ---- nothing may have moved since the plan ------------------------------
  select coalesce(jsonb_agg(to_jsonb(e.id) order by e.id), '[]'::jsonb)
    into v_actual
    from entries e
   where e.competition_id = comp.id and e.status = 'active';

  select coalesce(jsonb_agg(to_jsonb(e::text::uuid) order by e::text::uuid), '[]'::jsonb)
    into v_expected
    from jsonb_array_elements_text(
           coalesce(p_plan->'expected_active_entry_ids', '[]'::jsonb)) e;

  if v_actual <> v_expected then
    return jsonb_build_object('ok', false, 'code', 'entries_changed');
  end if;
  select jsonb_array_length(v_actual) into v_active;

  -- A buy-back landing after the plan was computed is the single most
  -- important thing this can catch: it is the difference between a rolled-over
  -- competition and one that is still running.
  select coalesce(jsonb_agg(to_jsonb(b.id) order by b.id), '[]'::jsonb)
    into v_actual
    from buybacks b
   where b.competition_id = comp.id;

  select coalesce(jsonb_agg(to_jsonb(e::text::uuid) order by e::text::uuid), '[]'::jsonb)
    into v_expected
    from jsonb_array_elements_text(
           coalesce(p_plan->'expected_buyback_ids', '[]'::jsonb)) e;

  if v_actual <> v_expected then
    return jsonb_build_object('ok', false, 'code', 'buybacks_changed');
  end if;

  -- ---- structural sanity on the plan's own claim --------------------------
  -- Not a re-derivation of the rules: a rollover means nobody is left, and a
  -- win means somebody is. A plan that says otherwise is malformed, whatever
  -- computed it.
  if v_end_kind = 'rollover' and v_active <> 0 then
    return jsonb_build_object(
      'ok', false, 'code', 'survivors_remain',
      'detail', jsonb_build_object('active', v_active)
    );
  end if;

  select count(*) into v_winners
    from jsonb_array_elements_text(
           coalesce(p_plan->'end'->'winner_entry_ids', '[]'::jsonb)) w;

  if v_end_kind = 'won' and (v_active = 0 or v_winners = 0
       or (p_plan->'end'->>'participant_id') is null) then
    return jsonb_build_object('ok', false, 'code', 'malformed_plan');
  end if;

  -- ======================================================================
  -- VALIDATION PASSED.
  -- ======================================================================

  if v_end_kind = 'rollover' then
    update competitions set status = 'rolled_over' where id = comp.id;
  else
    -- Entries first, THEN the competition — the order the deferred
    -- won-integrity trigger reads in. See db/lms-schema.sql.
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

  select count(*) into v_survivors
    from entries e
   where e.competition_id = comp.id and e.status in ('active', 'winner');

  return jsonb_build_object(
    'ok', true, 'code', 'finalised',
    'end_kind', v_end_kind,
    'survivors', v_survivors
  );
end;
$$;

comment on function lms_finalise_competition(jsonb) is
  'Confirm a rollover or crown a winner once the buy-back window has closed. Refuses while the window is open, or if a buy-back landed since the plan.';


-- ----------------------------------------------------------------------------
-- Access model, matching db/lms-schema.sql: buybacks carry money, so the
-- publishable (anon) key must not see them. Server-side secret key only.
-- ----------------------------------------------------------------------------
revoke all on buybacks from anon, authenticated;

revoke all on function lms_buyback_max_elim_round()                   from public, anon, authenticated;
revoke all on function lms_buy_back_entry(uuid, uuid, integer, boolean) from public, anon, authenticated;
revoke all on function lms_finalise_competition(jsonb)                 from public, anon, authenticated;

grant execute on function lms_buyback_max_elim_round()                   to service_role;
grant execute on function lms_buy_back_entry(uuid, uuid, integer, boolean) to service_role;
grant execute on function lms_finalise_competition(jsonb)                 to service_role;


-- ============================================================================
-- VERIFY — run this one line afterwards. Every column should say OK.
-- ============================================================================
-- select to_regclass('public.buybacks') is not null as buybacks_table, to_regprocedure('public.lms_buy_back_entry(uuid,uuid,integer,boolean)') is not null as buy_back_fn, to_regprocedure('public.lms_finalise_competition(jsonb)') is not null as finalise_fn, (select count(*) from pg_trigger where tgname = 'buybacks_window_valid') = 1 as window_trigger, (select prosrc like '%pending%' from pg_proc where proname = 'lms_settle_round') as settlement_fn_reran;
