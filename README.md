This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.


## Fixtures & results data (Phase 6)

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

**Seeding.** Paste `db/seed-fixtures.sql` into the Supabase SQL editor (after
`db/lms-schema.sql`). It is additive, insert-only and safe to re-run. Then run
`db/verify-fixtures.sql` — read-only, and every row should say `PASS`.

**Kickoff times drift.** Broadcasters move fixtures after the schedule is
published, and **nothing updates them automatically** — the seed is
insert-only, so a re-run changes nothing. What this actually affects is a
**round's deadline**, which is set from its matchday's earliest kickoff at the
time rounds were generated. So the weekly organiser job is: before each round
opens, check the next round's deadline in `/admin/competition` against the
announced kick-off times, and adjust the round if a game has been brought
forward. A game moved *later* is harmless; a game moved *earlier* than the
stored deadline would let someone pick after it has started.

**Auto-results.** `/api/cron/results` fills in finished results once a day
(`vercel.json`, 04:00 UTC), and can be triggered by hand. The secret goes in a
**header** — never a query string, which would leak it into logs and history:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/results
# or
curl -H "x-cron-secret: $CRON_SECRET" https://<host>/api/cron/results
```

It **only fills results** — settlement stays manual. It never overwrites a
result already entered, skips fixtures whose round is already settled, reports
postponements rather than writing them, and refuses to guess an unrecognised
club name. See `.env.example` for `CRON_SECRET` and `API_FOOTBALL_KEY`.
