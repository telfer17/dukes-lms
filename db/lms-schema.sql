-- ============================================================================
-- Dukes — Last Man Standing: core schema
-- ============================================================================
--
-- Paste this whole file into the Supabase SQL editor and run it. It is
-- ADDITIVE and RE-RUNNABLE: every object uses IF NOT EXISTS / ON CONFLICT
-- DO NOTHING, so running it twice changes nothing the second time.
--
-- It creates tables + the 20-team seed ONLY. It does NOT seed fixtures
-- (Phase 6), create a competition row, or implement any survival logic
-- (Phase 4, lib/lms.ts).
--
-- Rules this model has to support: docs/LMS-RULES.md
-- Model walkthrough and design rationale: docs/LMS-SCHEMA.md
--
-- Creation order matters (foreign keys):
--   teams → fixtures → participants → competitions → rounds → entries → picks
--
-- MONEY IS ALWAYS INTEGER PENCE. £10 = 1000. No floats anywhere.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- teams — the 20 Premier League clubs. Static reference data, shared by every
-- competition. `name` is the clean display name; Phase 6 maps fixture-source
-- names onto it by stripping a trailing " FC"/" AFC" and a leading "AFC ".
-- ----------------------------------------------------------------------------
create table if not exists teams (
  id          smallint generated always as identity primary key,
  name        text     not null unique,
  short_name  text
);

comment on table teams is
  'The 20 Premier League clubs. Static reference data, shared across all competitions.';
comment on column teams.name is
  'Clean display name, e.g. "Bournemouth" — source "FC"/"AFC" tags normalised away.';

insert into teams (name, short_name) values
  ('Arsenal',                  'ARS'),
  ('Aston Villa',              'AVL'),
  ('Bournemouth',              'BOU'),
  ('Brentford',                'BRE'),
  ('Brighton & Hove Albion',   'BHA'),
  ('Chelsea',                  'CHE'),
  ('Coventry City',            'COV'),
  ('Crystal Palace',           'CRY'),
  ('Everton',                  'EVE'),
  ('Fulham',                   'FUL'),
  ('Hull City',                'HUL'),
  ('Ipswich Town',             'IPS'),
  ('Leeds United',             'LEE'),
  ('Liverpool',                'LIV'),
  ('Manchester City',          'MCI'),
  ('Manchester United',        'MUN'),
  ('Newcastle United',         'NEW'),
  ('Nottingham Forest',        'NFO'),
  ('Sunderland',               'SUN'),
  ('Tottenham Hotspur',        'TOT')
on conflict (name) do nothing;


-- ----------------------------------------------------------------------------
-- fixtures — the 380 season matches. SEASON-WIDE reference data, deliberately
-- NOT tied to a competition: a rollover mid-season reuses the same fixtures.
-- Seeded in Phase 6; this table starts empty.
--
-- `result` is what the survival engine reads. It is only meaningful once
-- status = 'played'. A postponed/abandoned fixture keeps result NULL — per the
-- rules, the engine treats that pick as a WIN, and the team still counts USED.
-- ----------------------------------------------------------------------------
create table if not exists fixtures (
  id            integer     generated always as identity primary key,
  matchday      smallint    not null,
  kickoff       timestamptz not null,
  home_team_id  smallint    not null references teams (id) on delete restrict,
  away_team_id  smallint    not null references teams (id) on delete restrict,
  home_score    smallint,
  away_score    smallint,
  status        text        not null default 'scheduled',
  result        text,

  constraint fixtures_matchday_range     check (matchday between 1 and 38),
  constraint fixtures_distinct_teams     check (home_team_id <> away_team_id),
  constraint fixtures_status_valid       check (status in ('scheduled', 'played', 'postponed', 'abandoned')),
  constraint fixtures_result_valid       check (result is null or result in ('home', 'away', 'draw')),
  -- A result only exists for a played game. Postponed/abandoned stay NULL and
  -- are handled by the engine, not by a stored result.
  constraint fixtures_result_needs_played check (result is null or status = 'played'),
  constraint fixtures_scores_nonneg      check (
    (home_score is null or home_score >= 0) and (away_score is null or away_score >= 0)
  ),

  -- A club appears at most once as home, and at most once as away, per matchday.
  --
  -- These two do NOT compose into "once per matchday overall": a club could be
  -- home in one fixture and away in another on the same matchday. Enforcing
  -- that structurally (a normalised fixture_teams relation, or a trigger) is
  -- over-engineering for controlled reference data — fixtures are seeded once,
  -- in bulk, from a verified source, not entered ad hoc. Phase 6 instead
  -- asserts it AFTER loading: every team appears exactly once per matchday, or
  -- the seed is rejected. Cheaper than a runtime trigger and catches a bad
  -- source file, which is the actual risk.
  constraint fixtures_one_home_per_matchday unique (matchday, home_team_id),
  constraint fixtures_one_away_per_matchday unique (matchday, away_team_id)
);

comment on table fixtures is
  'The 380 season matches. Season-wide, NOT per competition — a mid-season rollover reuses them.';
comment on column fixtures.result is
  'home | away | draw — set only when status = played. The survival engine reads this.';
comment on column fixtures.status is
  'scheduled | played | postponed | abandoned. Postponed/abandoned count as a WIN for the picker.';


-- ----------------------------------------------------------------------------
-- participants — the PEOPLE. One row per human, reused across every
-- competition. Contains NO competition state and NO payment state: that lives
-- on `entries`, because a rollover gives the same person a fresh entry with a
-- different buy-in.
--
-- phone is PII — secret-key reads only (see the grants block at the bottom).
--
-- There is deliberately NO `paid` column here. Payment moved to `entries`
-- because it is per-competition, not per-person: multi-entry means one person
-- can hold several paid entries at once, and rollovers give the same person
-- different buy-ins. A participants.paid flag cannot express either, so
-- re-adding it for backwards compatibility would be the wrong direction.
-- The Phase 2 admin entrants flow still reads it and is rebuilt against
-- entries + competitions in Phase 5; until then its guarded empty state is
-- the intended behaviour, not a regression.
-- ----------------------------------------------------------------------------
create table if not exists participants (
  id            uuid        primary key default gen_random_uuid(),
  name          text        not null,
  phone         text,
  club_contact  text,
  created_at    timestamptz not null default now()
);

comment on table participants is
  'People, reused across competitions. Per-competition state (alive/eliminated, payment) lives on entries.';
comment on column participants.phone is
  'PII. Server-side (secret key) reads only — never exposed to the publishable key.';


-- ----------------------------------------------------------------------------
-- competitions — one LMS instance. A rollover does NOT reset rows in place; it
-- inserts a NEW competition with rollover_count + 1 and the surviving pot
-- carried in.
--
-- Exactly one row may be 'active' at a time (partial unique index below).
--
-- The winner is recorded as a PERSON, not an entry. Winner-takes-all means one
-- person wins the single pot however many entries they held at the end, and
-- the payout goes to the person — so a single entry id would be lossy for a
-- multi-entry winner. Which entries survived is recorded on entries.status.
-- ----------------------------------------------------------------------------
create table if not exists competitions (
  id                    uuid        primary key default gen_random_uuid(),
  label                 text        not null,
  status                text        not null default 'active',
  rollover_count        smallint    not null default 0,
  pot_carried_in_pence  integer     not null default 0,
  -- ON DELETE RESTRICT: a competition's winner is permanent history. Deleting
  -- that person is blocked rather than silently erasing who won — clear the
  -- winner first if a deletion is genuinely intended.
  winner_participant_id uuid        references participants (id) on delete restrict,
  created_at            timestamptz not null default now(),

  constraint competitions_status_valid    check (status in ('active', 'won', 'rolled_over')),
  constraint competitions_rollover_nonneg check (rollover_count >= 0),
  constraint competitions_pot_nonneg      check (pot_carried_in_pence >= 0)
);

comment on table competitions is
  'One LMS competition instance. A rollover starts a NEW row; nothing is reset in place.';
comment on column competitions.rollover_count is
  'Prior rollovers. 0 for the first competition. Newcomer buy-in = £10 x (rollover_count + 1).';
comment on column competitions.pot_carried_in_pence is
  'Pot rolled in from the previous competition, in pence. 0 for the first competition.';
comment on column competitions.winner_participant_id is
  'The winning PERSON — source of truth for "who won" and who the pot is paid to. Exactly one, even if they held several surviving entries.';

-- Only one competition can be active at any moment.
create unique index if not exists competitions_single_active
  on competitions (status)
  where status = 'active';


-- ----------------------------------------------------------------------------
-- rounds — a competition's round. round_number is the position WITHIN the
-- competition (1, 2, 3…); matchday is which PL matchday it draws its fixtures
-- from. These are deliberately decoupled: if Competition 2 starts after a
-- rollover at PL matchday 6, its round 1 has matchday = 6.
--
-- deadline = the first kickoff of that matchday (picks lock, no changes after).
-- ----------------------------------------------------------------------------
create table if not exists rounds (
  id              uuid        primary key default gen_random_uuid(),
  competition_id  uuid        not null references competitions (id) on delete cascade,
  round_number    smallint    not null,
  matchday        smallint    not null,
  deadline        timestamptz not null,
  status          text        not null default 'pending',
  created_at      timestamptz not null default now(),

  constraint rounds_number_positive check (round_number >= 1),
  constraint rounds_matchday_range  check (matchday between 1 and 38),
  constraint rounds_status_valid    check (status in ('pending', 'locked', 'settled')),

  constraint rounds_unique_number   unique (competition_id, round_number),
  constraint rounds_unique_matchday unique (competition_id, matchday),
  -- Target for the composite FK on picks — keeps a pick's round and entry in
  -- the same competition. See picks below.
  constraint rounds_id_competition  unique (id, competition_id)
);

comment on table rounds is
  'A round of a competition. round_number is position within the competition; matchday is the PL matchday it uses.';
comment on column rounds.deadline is
  'First kickoff of the matchday. Picks lock here — no changes after.';


-- ----------------------------------------------------------------------------
-- entries — a participant's membership in ONE competition. This is the row
-- that is alive or eliminated, and the row that carries the money.
--
-- amount_paid_pence records what was ACTUALLY paid — deliberately not
-- constrained to the expected ladder, so a part payment or an odd-money
-- arrangement can be recorded truthfully. Expected values:
--   returning player : 1000 (£10)
--   newcomer         : 1000 x (competitions.rollover_count + 1)
--
-- No odd-pence allocation rule is needed: entries are whole-pound amounts
-- (a multiple of 1000 pence), so the 50/50 pot/club split is always exact and
-- no remainder penny can arise. If sub-pound amounts are ever accepted, a
-- rounding rule must be defined at that point.
-- ----------------------------------------------------------------------------
create table if not exists entries (
  id                   uuid        primary key default gen_random_uuid(),
  competition_id       uuid        not null references competitions (id) on delete cascade,
  participant_id       uuid        not null references participants (id) on delete cascade,
  paid                 boolean     not null default false,
  amount_paid_pence    integer     not null default 0,
  is_newcomer          boolean     not null default false,
  status               text        not null default 'active',
  eliminated_round_id  uuid        references rounds (id) on delete set null,
  joined_at            timestamptz not null default now(),

  constraint entries_amount_nonneg check (amount_paid_pence >= 0),
  -- status = 'winner' marks an entry that survived to the end. MORE THAN ONE
  -- entry may carry it — a multi-entry player can finish holding two survivors
  -- — but only ever ONE person is competitions.winner_participant_id.
  constraint entries_status_valid  check (status in ('active', 'eliminated', 'winner')),
  -- An eliminated entry should say which round did it; nothing else should.
  constraint entries_eliminated_round_consistent check (
    (status = 'eliminated') or (eliminated_round_id is null)
  ),
  -- Target for the composite FK on picks.
  constraint entries_id_competition unique (id, competition_id)
);

comment on table entries is
  'A participant''s membership in one competition: alive/eliminated state plus payment. One person = many entries over time.';
comment on column entries.amount_paid_pence is
  'What was actually paid, in pence. Expected: 1000 returning, 1000 x (rollover_count + 1) for a newcomer. Not constrained on purpose.';
comment on column entries.is_newcomer is
  'True if this person was NOT in the previous competition — drives the higher buy-in.';


-- ----------------------------------------------------------------------------
-- picks — one team chosen by one entry in one round.
--
-- ONE PICK PER (entry, round) is enforced here as a unique constraint.
--
-- NO-REPEAT-TEAM IS NOT ENFORCED HERE. There is deliberately no unique on
-- (entry_id, team_id): the rules reset a player's pool once all 20 teams are
-- used, so a legitimate 21st pick repeats a team. That rule lives in the
-- engine (Phase 4, lib/lms.ts). See docs/LMS-SCHEMA.md.
--
-- competition_id is denormalised (it is derivable via entry or round). The
-- composite FKs below make the database guarantee all three agree, so it can
-- never drift.
-- ----------------------------------------------------------------------------
create table if not exists picks (
  id              uuid        primary key default gen_random_uuid(),
  competition_id  uuid        not null,
  entry_id        uuid        not null,
  round_id        uuid        not null,
  team_id         smallint    not null references teams (id) on delete restrict,
  auto_assigned   boolean     not null default false,
  outcome         text        not null default 'pending',
  created_at      timestamptz not null default now(),

  constraint picks_outcome_valid check (outcome in ('pending', 'survived', 'eliminated')),

  -- Exactly one pick per entry per round.
  constraint picks_one_per_entry_round unique (entry_id, round_id),

  -- Entry and round must belong to the competition named on the pick.
  constraint picks_entry_fk foreign key (entry_id, competition_id)
    references entries (id, competition_id) on delete cascade,
  constraint picks_round_fk foreign key (round_id, competition_id)
    references rounds (id, competition_id) on delete cascade
);

comment on table picks is
  'One team picked by one entry in one round. No-repeat-team is enforced in the engine, not here — the pool resets after 20.';
comment on column picks.auto_assigned is
  'True when the deadline passed with no pick and the engine assigned the first alphabetically-available team.';
comment on column picks.outcome is
  'pending | survived | eliminated. Postponed/abandoned fixtures settle as survived.';


-- ----------------------------------------------------------------------------
-- Integrity: a 'won' competition must actually name a winner.
--
-- status = 'won' implies BOTH winner_participant_id is set AND that person
-- holds an entry in this competition with status = 'winner'. Neither a CHECK
-- (it must look at another table) nor an FK can express that.
--
-- DEFERRABLE INITIALLY DEFERRED — checked once at COMMIT, so a settlement
-- transaction can mark the entries and the competition in either order and
-- pass through legitimately inconsistent intermediate states.
--
-- It fires from BOTH sides: from competitions (marking 'won' without a
-- winner), and from entries (stripping 'winner' off the entry, deleting it, or
-- MOVING it to another competition after the competition was settled). Scope is
-- deliberately narrow — only the "won implies a consistent winner" invariant.
-- Other statuses are unconstrained and no other entry is examined.
-- ----------------------------------------------------------------------------
create or replace function assert_won_competition_has_winner()
returns trigger
language plpgsql
as $$
declare
  target_ids uuid[];
  target_id  uuid;
  comp       competitions%rowtype;
begin
  if tg_table_name = 'competitions' then
    target_ids := array[new.id];              -- fires on insert/update only
  elsif tg_op = 'DELETE' then
    target_ids := array[old.competition_id];
  elsif tg_op = 'INSERT' then
    target_ids := array[new.competition_id];
  else
    -- UPDATE on entries. An entry can be MOVED between competitions, so BOTH
    -- ends need re-checking: the competition it left could otherwise be
    -- stranded 'won' with no winner row. Deduplicated — competition_id is
    -- unchanged in the overwhelmingly common case (a status edit).
    target_ids := array[new.competition_id];
    if old.competition_id is distinct from new.competition_id then
      target_ids := target_ids || old.competition_id;
    end if;
  end if;

  foreach target_id in array target_ids loop
    select * into comp from competitions where id = target_id;

    -- The competition itself is gone (e.g. deleted, cascading its entries).
    if not found then
      continue;
    end if;

    -- Only 'won' carries the invariant; 'active' and 'rolled_over' are free.
    if comp.status <> 'won' then
      continue;
    end if;

    if comp.winner_participant_id is null then
      raise exception
        'competition % is marked won but names no winner_participant_id', comp.id
        using errcode = 'check_violation';
    end if;

    if not exists (
      select 1 from entries e
      where e.competition_id = comp.id
        and e.participant_id = comp.winner_participant_id
        and e.status = 'winner'
    ) then
      raise exception
        'competition % is marked won but participant % holds no entry with status = winner',
        comp.id, comp.winner_participant_id
        using errcode = 'check_violation';
    end if;
  end loop;

  return null;
end;
$$;

-- DROP + CREATE rather than IF NOT EXISTS: CREATE CONSTRAINT TRIGGER has no
-- such clause, and this keeps the file re-runnable.
drop trigger if exists competitions_won_integrity on competitions;
create constraint trigger competitions_won_integrity
  after insert or update on competitions
  deferrable initially deferred
  for each row execute function assert_won_competition_has_winner();

drop trigger if exists entries_won_integrity on entries;
create constraint trigger entries_won_integrity
  after update or delete on entries
  deferrable initially deferred
  for each row execute function assert_won_competition_has_winner();


-- ----------------------------------------------------------------------------
-- Indexes for the queries the board and the engine will run.
-- (Unique constraints above already index: rounds by competition, picks by
-- entry+round, fixtures by matchday+team.)
-- ----------------------------------------------------------------------------
create index if not exists participants_phone_idx      on participants (phone);
-- Keeps the ON DELETE RESTRICT check on participants cheap.
create index if not exists competitions_winner_idx     on competitions (winner_participant_id);

create index if not exists entries_competition_idx     on entries (competition_id);
create index if not exists entries_participant_idx     on entries (participant_id);
-- "Who is still in?" — the board's main query.
create index if not exists entries_competition_status_idx on entries (competition_id, status);
create index if not exists entries_eliminated_round_idx on entries (eliminated_round_id);

create index if not exists picks_round_idx             on picks (round_id);
create index if not exists picks_competition_idx       on picks (competition_id);
-- "Which teams has this entry used?" — the no-repeat check.
create index if not exists picks_entry_team_idx        on picks (entry_id, team_id);
create index if not exists picks_team_idx              on picks (team_id);

create index if not exists fixtures_matchday_idx       on fixtures (matchday);
create index if not exists fixtures_kickoff_idx        on fixtures (kickoff);
create index if not exists fixtures_home_team_idx      on fixtures (home_team_id);
create index if not exists fixtures_away_team_idx      on fixtures (away_team_id);


-- ----------------------------------------------------------------------------
-- Public-safe board view.
--
-- Exposes name + status only. NO phone, NO payment, and NO entries.id. Safe to
-- read with the publishable (anon) key. Views run with the owner's privileges,
-- so this keeps working after the REVOKEs below strip anon's access to the base
-- tables — the same pattern the World Cup predictor used.
--
-- entries.id is DELIBERATELY not here. It names an entry to every write path
-- in the app (and was, until the pick process was streamlined, the whole
-- credential for a player-facing /pick/[entryId] page), so it must never be
-- reachable with a key that is safe to publish. The board has no use for it
-- either: it renders names and statuses, and React keys off name+index.
--
-- The drop-then-create is what lets that column be REMOVED on a re-run:
-- `create or replace view` can add trailing columns but cannot drop one. The
-- file stays re-runnable, which is the property that matters.
-- ----------------------------------------------------------------------------
drop view if exists standing_board;

create view standing_board as
select
  e.competition_id,
  p.name                as name,
  e.status              as status,
  r.round_number        as eliminated_round_number
from entries e
join participants p on p.id = e.participant_id
left join rounds r  on r.id = e.eliminated_round_id;

comment on view standing_board is
  'Public "who is still in" board: name + status only. Deliberately excludes phone, payment and entries.id (the pick-link credential).';


-- ----------------------------------------------------------------------------
-- Access model — RLS stays OFF, matching the World Cup predictor.
--
-- With RLS off, Supabase's default grants would let the publishable (anon) key
-- read every column of every table, including phone numbers and payment
-- amounts. These REVOKEs close that off. All privileged access goes through
-- the server-side secret key (lib/supabase-server.ts), which bypasses grants.
--
-- Public (publishable key)  : teams, fixtures, rounds, competitions, standing_board
-- Secret key only           : participants, entries, picks
--
-- picks are secret-key-only on purpose: revealing them before a round locks
-- would let latecomers copy. A public picks view can be added in a later phase
-- once it can filter on rounds.status <> 'pending'.
-- ----------------------------------------------------------------------------
revoke all on participants from anon, authenticated;
revoke all on entries      from anon, authenticated;
revoke all on picks        from anon, authenticated;

grant select on teams          to anon, authenticated;
grant select on fixtures       to anon, authenticated;
grant select on rounds         to anon, authenticated;
grant select on competitions   to anon, authenticated;
grant select on standing_board to anon, authenticated;
