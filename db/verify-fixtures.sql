-- ============================================================================
-- Dukes LMS — post-seed fixture verification
-- ============================================================================
--
-- READ-ONLY. Writes nothing, changes nothing. Run in the Supabase SQL editor
-- after db/seed-fixtures.sql and read the result: every row should say PASS.
--
-- This is the seed-time validation db/lms-schema.sql promised. The schema
-- enforces "a club appears at most once as home, and at most once as away, per
-- matchday", which does NOT compose into "exactly once per matchday overall" —
-- that check lives here, where it can look at the whole loaded card at once.
--
-- One row per assertion, so a failure names itself rather than making you
-- diff counts by eye.
-- ============================================================================

with
-- 1. shape of the season -----------------------------------------------------
totals as (
  select
    count(*)                        as fixture_count,
    count(distinct matchday)        as matchday_count,
    min(kickoff)                    as first_kickoff,
    max(kickoff)                    as last_kickoff
  from fixtures
),
-- 2. ten fixtures in every matchday ------------------------------------------
bad_matchday_size as (
  select matchday, count(*) as n
  from fixtures
  group by matchday
  having count(*) <> 10
),
-- 3. every club exactly once per matchday (home or away) ---------------------
appearances as (
  select matchday, home_team_id as team_id from fixtures
  union all
  select matchday, away_team_id from fixtures
),
bad_appearance as (
  select a.matchday, t.name, count(*) as appearances
  from appearances a
  join teams t on t.id = a.team_id
  group by a.matchday, t.name
  having count(*) <> 1
),
missing_from_matchday as (
  select m.matchday, t.name
  from (select distinct matchday from fixtures) m
  cross join teams t
  where not exists (
    select 1 from appearances a
    where a.matchday = m.matchday and a.team_id = t.id
  )
),
-- 4. 19 home and 19 away per club --------------------------------------------
bad_home_away as (
  select
    t.name,
    count(*) filter (where f.home_team_id = t.id) as home_games,
    count(*) filter (where f.away_team_id = t.id) as away_games
  from teams t
  join fixtures f on f.home_team_id = t.id or f.away_team_id = t.id
  group by t.name
  having count(*) filter (where f.home_team_id = t.id) <> 19
      or count(*) filter (where f.away_team_id = t.id) <> 19
),
-- 5. kickoffs inside the season window ---------------------------------------
out_of_window as (
  select id, matchday, kickoff
  from fixtures
  where kickoff < timestamptz '2026-08-01 00:00+00'
     or kickoff > timestamptz '2027-06-30 23:59+00'
),
-- 6. matchdays do not overlap: matchday N finishes before N+1 starts ---------
matchday_span as (
  select matchday, min(kickoff) as starts, max(kickoff) as ends
  from fixtures
  group by matchday
),
overlapping_matchdays as (
  select
    curr.matchday as matchday,
    prev.matchday as previous_matchday,
    prev.ends     as previous_ends,
    curr.starts   as this_starts
  from matchday_span curr
  join matchday_span prev on prev.matchday = curr.matchday - 1
  where curr.starts <= prev.ends
),
-- 7. nothing pre-played -------------------------------------------------------
not_pristine as (
  select id, matchday, status, result, home_score, away_score
  from fixtures
  where status <> 'scheduled'
     or result is not null
     or home_score is not null
     or away_score is not null
),
-- 8. no club playing itself ---------------------------------------------------
self_fixtures as (
  select id, matchday from fixtures where home_team_id = away_team_id
)

select * from (
  select 1 as seq, 'fixture count is 380' as assertion,
         case when fixture_count = 380 then 'PASS' else 'FAIL' end as outcome,
         fixture_count::text as detail
  from totals
  union all
  select 2, 'matchday count is 38',
         case when matchday_count = 38 then 'PASS' else 'FAIL' end,
         matchday_count::text
  from totals
  union all
  select 3, 'every matchday has exactly 10 fixtures',
         case when not exists (select 1 from bad_matchday_size) then 'PASS' else 'FAIL' end,
         coalesce((select string_agg(format('md %s has %s', matchday, n), '; ' order by matchday)
                   from bad_matchday_size), 'all 38 matchdays have 10')
  union all
  select 4, 'every club appears exactly once per matchday',
         case when not exists (select 1 from bad_appearance)
               and not exists (select 1 from missing_from_matchday)
              then 'PASS' else 'FAIL' end,
         coalesce(
           nullif(concat_ws('; ',
             (select string_agg(format('md %s: %s x%s', matchday, name, appearances), ', ' order by matchday, name)
              from bad_appearance),
             (select string_agg(format('md %s: %s missing', matchday, name), ', ' order by matchday, name)
              from missing_from_matchday)
           ), ''),
           '760 appearances, 20 clubs x 38 matchdays')
  union all
  select 5, 'every club has 19 home and 19 away fixtures',
         case when not exists (select 1 from bad_home_away) then 'PASS' else 'FAIL' end,
         coalesce((select string_agg(format('%s: %sH/%sA', name, home_games, away_games), '; ' order by name)
                   from bad_home_away), 'all 20 clubs 19H/19A')
  union all
  select 6, 'kickoffs fall inside 2026-08-01 .. 2027-06-30',
         case when not exists (select 1 from out_of_window) then 'PASS' else 'FAIL' end,
         (select format('%s .. %s', first_kickoff, last_kickoff) from totals)
  union all
  select 7, 'matchdays run in order and do not overlap',
         case when not exists (select 1 from overlapping_matchdays) then 'PASS' else 'FAIL' end,
         coalesce((select string_agg(format('md %s starts %s but md %s ends %s',
                                            matchday, this_starts, previous_matchday, previous_ends),
                                     '; ' order by matchday)
                   from overlapping_matchdays), '38 matchdays in sequence')
  union all
  select 8, 'every fixture is scheduled with no result (seed-time only)',
         case when not exists (select 1 from not_pristine) then 'PASS' else 'FAIL' end,
         case when exists (select 1 from not_pristine)
              then (select format('%s fixture(s) already have status/result', count(*)) from not_pristine)
              else 'all scheduled, no results' end
  union all
  select 9, 'no club is drawn against itself',
         case when not exists (select 1 from self_fixtures) then 'PASS' else 'FAIL' end,
         case when exists (select 1 from self_fixtures)
              then (select format('%s self-fixture(s)', count(*)) from self_fixtures)
              else 'none' end
) checks
order by seq;
