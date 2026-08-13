-- Additive scoring view, keyed by participant id.
--
-- The predictions page needs each participant's running total looked up by id
-- (names are not unique). The public `leaderboard` view is name-only, so we add
-- a separate `participant_points(participant_id, points, exact_scores)` view.
--
-- DELIBERATELY ADDITIVE: this does NOT touch the live `leaderboard` view or any
-- data. The scoring expression below is verified to reproduce the live
-- leaderboard exactly (all 57 rows: name + points + exact_scores identical, as
-- of 2026-06-12). Scoring therefore lives in two places for now (the existing
-- leaderboard view and this one) — an accepted trade-off to avoid any risk to
-- the live leaderboard mid-tournament. STEP 1 proves they currently agree.
--
-- Scoring per match that has a result:
--   5  exact score
--   3  correct result AND the winning team's goals exactly right
--   2  correct result only
--   0  otherwise
-- A non-exact correct draw scores 2 (there is no "winning team"). The only
-- result entered so far is a decisive win (2-0), so the decisive-result rule is
-- verified against live data; the draw branch is the one case not yet exercised.

------------------------------------------------------------------------------
-- STEP 1 (OPTIONAL) — read-only check. Writes nothing. Expect 0 rows.
-- Compares this scoring to the CURRENT live leaderboard. If any rows come back,
-- do not create the view — send me the output.
------------------------------------------------------------------------------
with new_lb as (
  select pt.name,
    coalesce(sum(
      case
        when pr.home_pred = m.home_score and pr.away_pred = m.away_score then 5
        when m.home_score > m.away_score and pr.home_pred > pr.away_pred
          then case when pr.home_pred = m.home_score then 3 else 2 end
        when m.away_score > m.home_score and pr.away_pred > pr.home_pred
          then case when pr.away_pred = m.away_score then 3 else 2 end
        when m.home_score = m.away_score and pr.home_pred = pr.away_pred then 2
        else 0
      end), 0)::int as points,
    coalesce(count(*) filter (
      where pr.home_pred = m.home_score and pr.away_pred = m.away_score), 0)::int as exact_scores
  from participants pt
  left join predictions pr on pr.participant_id = pt.id
  left join matches m on m.id = pr.match_id
    and m.home_score is not null and m.away_score is not null
  group by pt.id, pt.name
)
select 'only_in_live' as side, name, points, exact_scores
  from (select name, points, exact_scores from leaderboard
        except all select name, points, exact_scores from new_lb) a
union all
select 'only_in_new', name, points, exact_scores
  from (select name, points, exact_scores from new_lb
        except all select name, points, exact_scores from leaderboard) b;

------------------------------------------------------------------------------
-- STEP 2 — the only statement that changes anything. Creates ONLY the new
-- view; does not modify data or the leaderboard view.
------------------------------------------------------------------------------
create or replace view participant_points as
select
  pt.id as participant_id,
  coalesce(sum(
    case
      when pr.home_pred = m.home_score and pr.away_pred = m.away_score then 5
      when m.home_score > m.away_score and pr.home_pred > pr.away_pred
        then case when pr.home_pred = m.home_score then 3 else 2 end
      when m.away_score > m.home_score and pr.away_pred > pr.home_pred
        then case when pr.away_pred = m.away_score then 3 else 2 end
      when m.home_score = m.away_score and pr.home_pred = pr.away_pred then 2
      else 0
    end
  ), 0)::int as points,
  coalesce(count(*) filter (
    where pr.home_pred = m.home_score and pr.away_pred = m.away_score
  ), 0)::int as exact_scores
from participants pt
left join predictions pr on pr.participant_id = pt.id
left join matches m
  on m.id = pr.match_id
  and m.home_score is not null
  and m.away_score is not null
group by pt.id;

-- OPTIONAL (not required): the predict page reads this with the service key,
-- which bypasses grants. If you'd rather not expose per-id points to the public
-- anon key, you can also run:
--   revoke all on participant_points from anon, authenticated;
