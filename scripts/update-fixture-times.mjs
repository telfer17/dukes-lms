// Regenerate db/update-fixture-times.sql from the openfootball Football.TXT
// fixture list — the KICKOFF-TIME refresh that the insert-only seed cannot do.
//
//   node scripts/update-fixture-times.mjs <path-to-raw.txt>
//
// WHY THIS EXISTS. db/seed-fixtures.sql was generated in August, before the
// broadcasters had picked their televised games, so most matchdays carry the
// placeholder "Saturday 15:00" for every fixture. As TV selections land, the
// real kickoffs move — and a round's pick deadline is the FIRST kickoff of its
// matchday (docs/LMS-RULES.md § Rounds), so a stale time shows players a
// deadline up to two days later than the true one. The seed is deliberately
// insert-only (`on conflict do nothing`) and will never fix a time; this
// produces the UPDATE that does. Expect to re-run it several times a season,
// whenever a new batch of TV picks is announced.
//
// WHAT THE OUTPUT TOUCHES — and all it touches:
//
//   fixtures.kickoff   matched on (matchday, home team, away team) by NAME,
//                      never by id, and only where the stored value differs
//   rounds.deadline    re-derived as min(kickoff) of the round's matchday,
//                      only where it differs, and never on a settled round
//
// It never writes fixtures.status or fixtures.result, never inserts or
// deletes a fixture, and never goes near picks, entries, buybacks or
// settlement. Changing WHEN a game kicks off must not disturb WHAT happened
// in it. Idempotent: a second run over the same data updates nothing.
//
// The parsing, name mapping, London->UTC conversion and structural assertions
// are copied from scripts/build-fixtures.mjs (which cannot be imported — it
// executes at top level). If the source format changes, both files change.

import { readFileSync, writeFileSync } from "node:fs";

const SOURCE_URL =
  "https://raw.githubusercontent.com/openfootball/england/master/2026-27/1-premierleague.txt";
const SEASON = "2026-27";
const OUT_PATH = "db/update-fixture-times.sql";

// Our 20 canonical club names — must match teams.name in db/lms-schema.sql.
const CANONICAL = [
  "Arsenal", "Aston Villa", "Bournemouth", "Brentford",
  "Brighton & Hove Albion", "Chelsea", "Coventry City", "Crystal Palace",
  "Everton", "Fulham", "Hull City", "Ipswich Town", "Leeds United",
  "Liverpool", "Manchester City", "Manchester United", "Newcastle United",
  "Nottingham Forest", "Sunderland", "Tottenham Hotspur",
];

const MONTHS = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

function stripClubTag(raw) {
  return raw
    .trim()
    .replace(/\s+(FC|AFC)$/, "")
    .replace(/^AFC\s+/, "")
    .trim();
}

const londonParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
});

/**
 * A UK wall-clock time -> the UTC instant it denotes.
 *
 * The season spans a BST->GMT->BST run, so the offset genuinely changes
 * mid-list. Rather than hardcode transition dates, converge on the instant
 * whose Europe/London rendering equals the wall clock we were given.
 */
function londonToUtc(year, month, day, hour, minute) {
  const wanted = Date.UTC(year, month, day, hour, minute);
  let guess = wanted;
  for (let i = 0; i < 4; i++) {
    const p = Object.fromEntries(
      londonParts.formatToParts(new Date(guess))
        .filter((x) => x.type !== "literal")
        .map((x) => [x.type, Number(x.value)])
    );
    const rendered = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    const drift = rendered - wanted;
    if (drift === 0) return new Date(guess);
    guess -= drift;
  }
  throw new Error(
    `could not resolve ${year}-${month + 1}-${day} ${hour}:${minute} in Europe/London`
  );
}

function parse(text) {
  const fixtures = [];
  const unmapped = new Set();
  const problems = [];

  let matchday = null;
  let date = null;
  let lastTime = null;
  let year = null;

  for (const [i, line] of text.split(/\r?\n/).entries()) {
    const lineNo = i + 1;
    if (!line.trim() || line.startsWith("=") || line.startsWith("#")) continue;

    const md = line.match(/^▪\s*Matchday\s+(\d+)/);
    if (md) {
      matchday = Number(md[1]);
      date = null;
      lastTime = null;
      continue;
    }

    const dateLine = line.match(
      /^\s+[A-Z][a-z]{2}\s+([A-Z][a-z]{2})\s+(\d{1,2})(?:\s+(\d{4}))?\s*$/
    );
    if (dateLine) {
      const [, mon, dayStr, yearStr] = dateLine;
      if (yearStr) year = Number(yearStr);
      if (year === null) {
        problems.push(`line ${lineNo}: date before any year was stated`);
        continue;
      }
      if (!(mon in MONTHS)) {
        problems.push(`line ${lineNo}: unknown month "${mon}"`);
        continue;
      }
      date = { year, month: MONTHS[mon], day: Number(dayStr) };
      lastTime = null;
      continue;
    }

    // Fixture lines may carry a result once played — "2-0 (2-0)" — which this
    // file has no interest in: strip it before reading the teams, so a played
    // game's line parses identically to a scheduled one.
    const fixtureLine = line.replace(/\s+\d+-\d+(\s+\(\d+-\d+\))?\s*$/, "");
    const match = fixtureLine.match(/^\s+(?:(\d{1,2}:\d{2})\s+)?(.+?)\s+v\s+(.+?)\s*$/);
    if (!match) {
      problems.push(`line ${lineNo}: unrecognised: ${JSON.stringify(line)}`);
      continue;
    }

    const [, time, homeRaw, awayRaw] = match;
    if (matchday === null || date === null) {
      problems.push(`line ${lineNo}: fixture before any matchday/date`);
      continue;
    }
    if (time) lastTime = time;
    if (!lastTime) {
      problems.push(`line ${lineNo}: fixture with no time and none stated for the date`);
      continue;
    }

    const home = stripClubTag(homeRaw);
    const away = stripClubTag(awayRaw);
    if (!CANONICAL.includes(home)) unmapped.add(homeRaw.trim());
    if (!CANONICAL.includes(away)) unmapped.add(awayRaw.trim());

    const [hh, mm] = lastTime.split(":").map(Number);
    fixtures.push({
      matchday,
      kickoff: londonToUtc(date.year, date.month, date.day, hh, mm).toISOString(),
      home,
      away,
      kickoff_uk: `${date.year}-${String(date.month + 1).padStart(2, "0")}-${String(date.day).padStart(2, "0")} ${lastTime}`,
    });
  }

  return { fixtures, unmapped: [...unmapped], problems };
}

// ---------------------------------------------------------------------------

const rawPath = process.argv[2];
if (!rawPath) {
  console.error(
    "usage: node scripts/update-fixture-times.mjs <path-to-raw.txt> [--keep-round=N]"
  );
  process.exit(1);
}

// --keep-round=N: leave round N of the ACTIVE competition's deadline exactly
// as the organiser set it, even where it differs from the derived first
// kickoff. An organiser's deliberate deadline outranks the derived one
// (docs/LMS-RULES.md gives the organiser the final say on a round's conduct);
// this is how that decision survives a regeneration instead of living as a
// hand-edit to a generated file. Kickoff times are NOT affected — only the
// round's stored deadline is spared.
const keepRounds = process.argv
  .slice(3)
  .map((a) => a.match(/^--keep-round=(\d+)$/)?.[1])
  .filter(Boolean)
  .map(Number);

const text = readFileSync(rawPath, "utf8");
const { fixtures, unmapped, problems } = parse(text);

if (unmapped.length > 0) {
  console.error("UNMAPPED TEAM NAMES — refusing to write anything:");
  for (const n of unmapped.sort()) console.error(`  ${JSON.stringify(n)}`);
  process.exit(1);
}
if (problems.length > 0) {
  console.error("PARSE PROBLEMS — refusing to write anything:");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

// The same structural checks the seed passes — a partial or malformed source
// must never become a partial UPDATE.
const matchdays = [...new Set(fixtures.map((f) => f.matchday))].sort((a, b) => a - b);
const fail = (msg) => { console.error(`ASSERTION FAILED: ${msg}`); process.exit(1); };

if (fixtures.length !== 380) fail(`expected 380 fixtures, parsed ${fixtures.length}`);
if (matchdays.length !== 38) fail(`expected 38 matchdays, got ${matchdays.length}`);
for (const md of matchdays) {
  const inMd = fixtures.filter((f) => f.matchday === md);
  if (inMd.length !== 10) fail(`matchday ${md} has ${inMd.length} fixtures, expected 10`);
  const seen = inMd.flatMap((f) => [f.home, f.away]);
  if (new Set(seen).size !== 20) fail(`matchday ${md} does not field all 20 clubs exactly once`);
}
for (const team of CANONICAL) {
  const h = fixtures.filter((f) => f.home === team).length;
  const a = fixtures.filter((f) => f.away === team).length;
  if (h !== 19 || a !== 19) fail(`${team} has ${h} home / ${a} away, expected 19/19`);
}
for (let i = 1; i < matchdays.length; i++) {
  const prevMax = Math.max(...fixtures.filter((f) => f.matchday === matchdays[i - 1]).map((f) => Date.parse(f.kickoff)));
  const nextMin = Math.min(...fixtures.filter((f) => f.matchday === matchdays[i]).map((f) => Date.parse(f.kickoff)));
  if (nextMin <= prevMax) {
    fail(`matchday ${matchdays[i]} starts before matchday ${matchdays[i - 1]} ends`);
  }
}

fixtures.sort(
  (a, b) => a.matchday - b.matchday
    || Date.parse(a.kickoff) - Date.parse(b.kickoff)
    || a.home.localeCompare(b.home)
);

// --- SQL ------------------------------------------------------------------

const sqlLiteral = (s) => `'${s.replace(/'/g, "''")}'`;
const values = fixtures
  .map((f, i) =>
    i === 0
      // Types stated once, on the first row, and inherited by the rest.
      ? `    (${f.matchday}::smallint, ${sqlLiteral(f.kickoff)}::timestamptz, ${sqlLiteral(f.home)}, ${sqlLiteral(f.away)})`
      : `    (${f.matchday}, ${sqlLiteral(f.kickoff)}, ${sqlLiteral(f.home)}, ${sqlLiteral(f.away)})`
  )
  .join(",\n");

const fetched = process.env.FETCH_DATE ?? new Date().toISOString().slice(0, 10);

const keepClauseComment = keepRounds.length
  ? `
--
-- KEPT BY ORGANISER DECISION: round ${keepRounds.join(", round ")} of the active competition is
-- excluded below — its deadline stays exactly as manually set, whatever the
-- fixtures say. (Generated with --keep-round.)`
  : "";
const keepClause = keepRounds.length
  ? `
  and not (r.round_number in (${keepRounds.join(", ")})
           and r.competition_id in (select id from competitions where status = 'active'))`
  : "";

const sql = `-- ============================================================================
-- Dukes LMS — Premier League ${SEASON} kickoff-time refresh (${fixtures.length} fixtures)
-- ============================================================================
--
-- GENERATED FILE — do not edit by hand.
--   source:    ${SOURCE_URL}
--   format:    Football.TXT (openfootball/england)
--   fetched:   ${fetched}
--   generator: scripts/update-fixture-times.mjs
--
-- The August seed carried placeholder "Saturday 15:00" kickoffs for every game
-- the broadcasters had not yet scheduled. This refresh sets the real times —
-- and because a round's pick deadline is the FIRST kickoff of its matchday
-- (docs/LMS-RULES.md § Rounds) and rounds.deadline is STORED, it then
-- re-derives the deadlines from the corrected times.
--
-- WHAT IT WRITES — and all it writes:
--   * fixtures.kickoff, matched on (matchday, home team, away team), only
--     where the stored time differs;
--   * rounds.deadline, only where it differs from the matchday's earliest
--     kickoff, and never on a settled round.
--
-- It NEVER touches fixtures.status, fixtures.result, the pairings, picks,
-- entries, buybacks, or anything settlement reads or writes. Changing when a
-- game kicks off does not change what happened in it: results already entered
-- ride through untouched. Idempotent — running it twice changes nothing the
-- second time.
--
-- Paste into the Supabase SQL editor and run. The two statements report their
-- row counts; the SELECT at the bottom must come back empty afterwards.
-- ============================================================================


-- 1 ── fixtures.kickoff -----------------------------------------------------

update fixtures f
set kickoff = v.kickoff
from (
  values
${values}
) as v (matchday, kickoff, home_name, away_name)
join teams home on home.name = v.home_name
join teams away on away.name = v.away_name
where f.matchday = v.matchday
  and f.home_team_id = home.id
  and f.away_team_id = away.id
  and f.kickoff is distinct from v.kickoff;


-- 2 ── rounds.deadline ------------------------------------------------------
--
-- Re-derived from the times just written, for EVERY competition's rounds on
-- these matchdays. Settled rounds are left alone: their deadline is part of a
-- record that has already been acted on, and nothing reads it any more.
-- A deadline the organiser has already corrected by hand to the true first
-- kickoff simply matches the derived value and is not rewritten.${keepClauseComment}

update rounds r
set deadline = md.first_kickoff
from (
  select matchday, min(kickoff) as first_kickoff
  from fixtures
  group by matchday
) as md
where r.matchday = md.matchday
  and r.status <> 'settled'
  and r.deadline is distinct from md.first_kickoff${keepClause};


-- 3 ── verify ----------------------------------------------------------------
--
-- Every unsettled round's deadline now equals its matchday's first kickoff${keepRounds.length ? `
-- (kept rounds excluded — their deadline differs by organiser decision)` : ""}.
-- MUST RETURN 0 ROWS.

select r.round_number, r.matchday, r.deadline, md.first_kickoff
from rounds r
join (
  select matchday, min(kickoff) as first_kickoff
  from fixtures
  group by matchday
) as md on md.matchday = r.matchday
where r.status <> 'settled'
  and r.deadline is distinct from md.first_kickoff${keepClause};
`;

writeFileSync(OUT_PATH, sql);
console.log(`wrote ${OUT_PATH}: ${fixtures.length} fixtures across ${matchdays.length} matchdays`);
