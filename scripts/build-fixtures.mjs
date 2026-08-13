// Parse the openfootball Football.TXT fixture list into data/fixtures-2026-27.json
// and db/seed-fixtures.sql.
//
//   node scripts/build-fixtures.mjs [path-to-raw.txt]
//
// Run ONCE (or to regenerate). The app never fetches openfootball at runtime —
// the committed JSON is the source of truth, and tests/fixtures.test.ts asserts
// it is well formed so a bad regeneration can't slip through.
//
// Fails loudly on anything it cannot account for: an unmapped team name, a
// fixture with no time, a date that goes backwards, or a count that isn't 380.

import { readFileSync, writeFileSync } from "node:fs";

const SOURCE_URL =
  "https://raw.githubusercontent.com/openfootball/england/master/2026-27/1-premierleague.txt";
const SEASON = "2026-27";

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

/**
 * Strip the club-type tags the source carries: a trailing " FC"/" AFC", or a
 * leading "AFC ". Deliberately the ONLY transformation — anything that doesn't
 * land on a canonical name is reported, never guessed at.
 */
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
  let date = null;        // { year, month, day }
  let lastTime = null;    // "HH:MM" most recently stated on this date
  let year = null;

  const lines = text.split(/\r?\n/);

  for (const [i, line] of lines.entries()) {
    const lineNo = i + 1;
    if (!line.trim() || line.startsWith("=") || line.startsWith("#")) continue;

    const md = line.match(/^▪\s*Matchday\s+(\d+)/);
    if (md) {
      matchday = Number(md[1]);
      date = null;
      lastTime = null;
      continue;
    }

    // e.g. "  Fri Aug 21 2026" — the year is stated only at the season start
    // and at the Dec->Jan boundary, so it is carried forward in between.
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

    // e.g. "    20:00  Arsenal FC              v Coventry City FC"
    //  or  "           Everton FC              v Crystal Palace FC"  (inherits)
    const match = line.match(/^\s+(?:(\d{1,2}:\d{2})\s+)?(.+?)\s+v\s+(.+?)\s*$/);
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
  console.error("usage: node scripts/build-fixtures.mjs <path-to-raw.txt>");
  process.exit(1);
}

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

// Structural checks before anything is written.
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
// Kickoffs must not run backwards between matchdays.
for (let i = 1; i < matchdays.length; i++) {
  const prevMax = Math.max(...fixtures.filter((f) => f.matchday === matchdays[i - 1]).map((f) => Date.parse(f.kickoff)));
  const nextMin = Math.min(...fixtures.filter((f) => f.matchday === matchdays[i]).map((f) => Date.parse(f.kickoff)));
  if (nextMin <= prevMax) {
    fail(`matchday ${matchdays[i]} starts before matchday ${matchdays[i - 1]} ends`);
  }
}

fixtures.sort(
  (a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff) || a.home.localeCompare(b.home)
);

const payload = {
  source: {
    url: SOURCE_URL,
    format: "Football.TXT (openfootball/england)",
    season: SEASON,
    fetched_at: process.env.FETCH_DATE ?? new Date().toISOString().slice(0, 10),
    note: "Committed so the app has NO runtime dependency on openfootball. Regenerate with scripts/build-fixtures.mjs.",
  },
  counts: { fixtures: fixtures.length, matchdays: matchdays.length, teams: CANONICAL.length },
  fixtures: fixtures.map(({ matchday, kickoff, home, away, kickoff_uk }) => ({
    matchday, kickoff, home, away, kickoff_uk,
  })),
};

writeFileSync("data/fixtures-2026-27.json", JSON.stringify(payload, null, 2) + "\n");

// --- SQL ------------------------------------------------------------------
const sqlLiteral = (s) => `'${s.replace(/'/g, "''")}'`;
const values = payload.fixtures
  .map((f) => `    (${f.matchday}, ${sqlLiteral(f.kickoff)}, ${sqlLiteral(f.home)}, ${sqlLiteral(f.away)})`)
  .join(",\n");

const sql = `-- ============================================================================
-- Dukes LMS — Premier League ${SEASON} fixture seed (${payload.counts.fixtures} fixtures)
-- ============================================================================
--
-- GENERATED FILE — do not edit by hand.
--   source:    ${SOURCE_URL}
--   format:    Football.TXT (openfootball/england)
--   fetched:   ${payload.source.fetched_at}
--   generator: scripts/build-fixtures.mjs
--   data:      data/fixtures-2026-27.json
--
-- Paste into the Supabase SQL editor and run. Requires db/lms-schema.sql to
-- have been applied first (this needs the 20 rows in teams).
--
-- ADDITIVE, INSERT-ONLY and SAFE TO RE-RUN: rows are keyed on the natural key
-- (matchday, home_team_id) which the schema already enforces as unique, so a
-- second run inserts nothing and changes nothing. It never updates or deletes,
-- so results already entered are never touched.
--
-- Kickoffs are UTC. The source lists UK wall-clock times and the season spans
-- BST -> GMT -> BST, so each was converted through Europe/London individually.
--
-- After running, check the load with db/verify-fixtures.sql.
-- ============================================================================

insert into fixtures (matchday, kickoff, home_team_id, away_team_id, status, result)
select
  v.matchday::smallint,
  v.kickoff::timestamptz,
  home.id,
  away.id,
  'scheduled',
  null
from (values
${values}
) as v (matchday, kickoff, home_name, away_name)
join teams home on home.name = v.home_name
join teams away on away.name = v.away_name
on conflict (matchday, home_team_id) do nothing;

-- Loud check: an unknown club name would be silently dropped by the joins
-- above, so confirm the full card actually landed.
do $$
declare
  n integer;
begin
  select count(*) into n from fixtures;
  if n <> ${payload.counts.fixtures} then
    raise exception
      'expected ${payload.counts.fixtures} fixtures after seeding, found % — check every club name in teams matches the seed',
      n;
  end if;
  raise notice 'fixtures seeded: % rows', n;
end $$;
`;

writeFileSync("db/seed-fixtures.sql", sql);

console.log(`parsed ${fixtures.length} fixtures across ${matchdays.length} matchdays`);
console.log(`first kickoff: ${payload.fixtures[0].kickoff} (${payload.fixtures[0].kickoff_uk} UK)`);
console.log(`last kickoff:  ${payload.fixtures.at(-1).kickoff} (${payload.fixtures.at(-1).kickoff_uk} UK)`);
console.log("wrote data/fixtures-2026-27.json and db/seed-fixtures.sql");
