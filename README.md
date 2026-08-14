# Dukes — Last Man Standing

Glasgow Wellington FC's Last Man Standing competition, run over the English
Premier League season. Each round every player picks one team to win: win and
they're through, draw or lose and they're out, and a team can only be picked
once. Last one standing takes the pot.

The competition itself is **organiser-mediated**. There is no public sign-up:
an admin adds entrants against a competition and hands out a per-entry pick
link. Players use the site to make picks and to watch the board; money, chasing
and judgement calls stay with the organiser.

**The rules are the spec.** [`docs/LMS-RULES.md`](docs/LMS-RULES.md) is the
single source of truth, `lib/lms.ts` is the pure engine that implements it, and
`/rules` is the player-facing retelling. If a rule changes it changes in the
doc first, and all three must agree.

| Screen | What it is |
| --- | --- |
| `/` | Homepage — how it works, entry price, live round and alive count |
| `/board` | Who's still standing, this round's picks once locked, the pot |
| `/rules` | The full ruleset in plain English |
| `/pick/[entryId]` | A player's private pick page. The uuid **is** the credential |
| `/find` | Lost your pick link? Look it up by phone number |
| `/admin` | Competition, entrants and payments, results and settling |
| `/api/cron/results` | Daily results fill from API-Football, header-authenticated |

## Stack

Next.js 16 (App Router, server components, server actions) · React 19 ·
TypeScript · Tailwind 4 · Supabase (Postgres) · Vitest · deployed on Vercel.

> **Note on Next.js.** This is Next 16 — APIs and conventions differ from
> older versions. Read the guides in `node_modules/next/dist/docs/` before
> writing code, as `AGENTS.md` says.

Two Supabase clients, deliberately kept apart:

- `lib/supabase-browser.ts` — publishable (anon) key, public reads only. The
  `standing_board` view exposes name and status: no phone, no payment, and no
  `entries.id` (that uuid is the pick link — see `lib/public-read.ts`). As
  built, only server components use this client, so the key isn't in the client
  bundle today — but it is `NEXT_PUBLIC_`, one client-component import away from
  being public, so the grants have to hold on their own.
- `lib/supabase-server.ts` — secret key, `server-only`. Everything private,
  plus every write.

## Local setup

```bash
npm install
cp .env.example .env.local   # then fill it in — see below
npm run dev                  # http://localhost:3001
```

Dev runs on **3001**, not 3000, so it can sit alongside the World Cup predictor.

### Environment variables

All of these live in `.env.local` locally and in Vercel's project settings in
production. `.env.example` is the annotated template; never commit real values.

| Variable | What it's for |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL. `NEXT_PUBLIC_` — treat as public |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Anon key for public reads. `NEXT_PUBLIC_` — treat as public |
| `SUPABASE_SECRET_KEY` | Server-only key. Bypasses grants — never expose it |
| `ADMIN_PASSWORD` | Password for `/admin`. The cookie stores its SHA-256, not the password |
| `CRON_SECRET` | Shared secret for `/api/cron/results`. `openssl rand -hex 32` |
| `API_FOOTBALL_KEY` | [api-football.com](https://www.api-football.com) key. Free tier is plenty — one call per run |
| `NEXT_PUBLIC_SITE_URL` | Optional. Absolute base for the share card; only needed once there's a custom domain (Vercel's own URL is picked up automatically) |

All three Supabase vars are needed **at build time**, not just at runtime: both
client modules throw on import if they're missing, and `next build` imports
them while collecting page data. A build without them fails loudly — which is
the point, rather than shipping a client that can't read anything.
`ADMIN_PASSWORD`, `CRON_SECRET` and `API_FOOTBALL_KEY` are read per request, so
they're only needed at runtime.

### Invoking the cron route by hand

The secret goes in a **header** — never a query string, which would leak it
into logs and browser history:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/results
# or
curl -H "x-cron-secret: $CRON_SECRET" https://<host>/api/cron/results
```

Without a valid secret the route returns **401**. `Authorization: Bearer` is
what Vercel Cron sends automatically.

## Database: the manual SQL workflow

There are no migrations to run and no ORM. The SQL in `db/` is pasted into the
Supabase SQL editor **in this order**, and every file is re-runnable:

| # | File | What it does |
| --- | --- | --- |
| 1 | `db/lms-schema.sql` | Tables, views, constraints, and the grants that keep the anon key to public-safe reads |
| 2 | `db/seed-fixtures.sql` | The 380 Premier League fixtures. Additive, insert-only, safe to re-run |
| 3 | `db/verify-fixtures.sql` | Read-only check. **Every row must say `PASS`** |
| 4 | `db/settlement-fn.sql` | `lms_settle_round`, `lms_apply_fixture_results`, `lms_set_fixture_result` |

Order matters: the seed needs the schema's `teams` rows to resolve club names,
and the settlement functions reference schema objects. Run step 3 and read the
output before moving on — a bad seed is much cheaper to catch here than in
round 4 of a live competition.

Schema reference and the reasoning behind it:
[`docs/LMS-SCHEMA.md`](docs/LMS-SCHEMA.md).

## Fixtures & results data

**Fixtures.** `data/fixtures-2026-27.json` holds all 380 Premier League
2026/27 fixtures, parsed once from
[openfootball/england](https://github.com/openfootball/england) and committed —
the app has **no runtime dependency** on that repo. Kickoffs are stored as UTC
instants; the source lists UK wall-clock times and the season spans
BST → GMT → BST, so each was converted through `Europe/London` individually.

Regenerate by running these **from the repo root** (the script writes to
`data/` and `db/` relative to the working directory):

```bash
curl -sSo /tmp/pl.txt https://raw.githubusercontent.com/openfootball/england/master/2026-27/1-premierleague.txt
node scripts/build-fixtures.mjs /tmp/pl.txt
```

The generator refuses to write anything if a club name doesn't map, a fixture
has no time, or the season isn't 380 fixtures / 38 matchdays / 10 per matchday.
`tests/fixtures.test.ts` re-checks the committed JSON, so a bad regeneration
fails CI rather than reaching the database.

**Auto-results.** `/api/cron/results` fills in finished results once a day
(`vercel.json`, 04:00 UTC) and can be triggered by hand as above. It **only
fills results** — settlement stays manual. It never overwrites a result already
entered, skips fixtures whose round is already settled, reports postponements
rather than writing them, and refuses to guess an unrecognised club name.

## Settlement

**Settling a round is one Postgres transaction.** `db/settlement-fn.sql` holds
the functions. The shape is **plan → validate → apply**:

1. `settleCurrentRound` (`app/admin/results/actions.ts`) reads the state and
   computes the whole settlement with the pure engine — `lib/lms.ts` via
   `lib/settlement-plan.ts`. No rule is ever expressed in SQL.
2. `lms_settle_round(plan)` proves the database still matches the plan's
   fingerprints — same round, same fixtures, same picks, same active entries —
   and then applies everything atomically.
3. Anything moved underneath → it applies **nothing** and says which fingerprint
   failed. The organiser re-runs and a fresh plan is built.

There is no half-applied settlement to recover from.

**One lock across every write path.** `lms_settle_round`,
`lms_apply_fixture_results` (the results cron) and `lms_set_fixture_result` (the
manual editor) all take the same transaction-scoped advisory lock as their first
act, and re-check their settled-round guards *inside* the transaction. Reading
"is this round settled?" and writing afterwards over two connections is a gap a
settle can land in; this closes it. All three functions are revoked from
`anon`/`authenticated` and granted only to `service_role`.

## Tests

```bash
npm test           # everything
npm run lint
npx tsc --noEmit
npm run build
```

The engine, the plan builder and the pure helpers need no database. The
integration suite in `tests/db/` exercises the real schema and the real
functions against a real Postgres: full lifecycle, won/rollover/provisional
endings, re-settle refusal, rollback of a transaction that fails at COMMIT, and
cron-vs-settlement lock contention in both directions.

```bash
./scripts/scratch-db.sh test     # disposable local cluster, then the whole suite
```

or point it at any throwaway database:

```bash
LMS_TEST_DATABASE_URL=postgres://... npm test
```

Without `LMS_TEST_DATABASE_URL` the database suite **reports itself skipped**
(with a warning saying why) rather than passing silently — see
`tests/db-guard.test.ts`.

> **Point this only at a scratch database.** Every test truncates first.
> `./scripts/scratch-db.sh` exists so you never have to aim it at anything you'd
> miss; `destroy` deletes the cluster when you're done.

## Season ops

The weekly rhythm, in order:

1. **Before each round opens, check the deadline.** Broadcasters move fixtures
   after the schedule is published and **nothing updates them automatically** —
   the seed is insert-only, so re-running it changes nothing. A round's deadline
   was set from its matchday's earliest kickoff at the time rounds were
   generated. Compare the next round's deadline in `/admin/competition` against
   the announced kick-off times. A game moved *later* is harmless; a game moved
   *earlier* than the stored deadline would let someone pick after it has
   kicked off.
2. **After matchday 1, eyeball the cron.** Check `/admin/results` the morning
   after the first round's games: results should already be filled in. If they
   aren't, invoke the route by hand (above) and read what it reports — an
   unrecognised club name or a missing `API_FOOTBALL_KEY` shows up there. Better
   to find that in August than in December.
3. **Settle the round.** `/admin/results` → check every fixture has a result →
   **Settle round**. Postponed and abandoned games are entered by hand, since
   the cron reports them rather than writing them. Settling is all-or-nothing;
   if it refuses, it says which fingerprint failed — re-run it.
4. **Watch for the end states.** One entry left, or all the remaining entries
   belonging to one person, ends the competition. Everyone out in the same round
   rolls the pot over into a new one — start it in `/admin/competition` with the
   carried-in pot, and remember newcomers then pay the higher buy-in
   (`docs/LMS-RULES.md`).

**Next season:** bump `SEASON` in `app/api/cron/results/route.ts` (currently
`2026`, meaning 2026/27) and regenerate the fixtures from the new openfootball
file, then re-seed and re-verify. The cron asks API-Football for that season's
fixtures, so leaving it stale means it quietly fills in nothing.

## Deploying

[`DEPLOY.md`](DEPLOY.md) is the checklist: Vercel project setup, the exact
environment variables, and the post-deploy verification to run **against the
live URL**. `vercel.json` registers the daily cron; nothing else is needed at
build time beyond the environment variables above.

The share card at `public/og-image.png` is generated from
`scripts/og-card.html` — the regeneration command is in a comment at the top of
that file.

## Docs

- [`docs/LMS-RULES.md`](docs/LMS-RULES.md) — the agreed ruleset. The spec.
- [`docs/LMS-SCHEMA.md`](docs/LMS-SCHEMA.md) — database shape and reasoning.
- [`docs/LAUNCH-MESSAGE.md`](docs/LAUNCH-MESSAGE.md) — the WhatsApp announcement draft.
- [`DEPLOY.md`](DEPLOY.md) — deploy and verification checklist.
