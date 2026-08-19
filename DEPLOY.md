# Deploy checklist — Dukes LMS

Everything needed to take `telfer17/dukes-lms` live on Vercel, and the
verification to run afterwards.

> **The World Cup lesson: verify on the LIVE URL, not localhost.** Every check
> in part 4 is done against the deployed site in a browser and a terminal.
> Localhost passing tells you nothing about environment variables, the admin
> login, or the share card.

---

## 1. Before you touch Vercel

- [ ] **Phase 7 work is merged to `master`.** Vercel builds the production
      deployment from `master`; that's the branch to point the project at.
- [ ] **`npm run build`, `npm run lint`, `npx tsc --noEmit` and `npm test` are
      clean locally.** A failing build on Vercel costs a round trip.
- [ ] **The Supabase database is set up**, in this order, pasted into the SQL
      editor (see the README):
      `db/lms-schema.sql` → `db/seed-fixtures.sql` → `db/verify-fixtures.sql`
      (every row `PASS`) → `db/settlement-fn.sql`.
      *(Verified on a fresh database: all four apply cleanly in that order,
      `verify-fixtures` gives 9 PASS / 0 FAIL, and re-running the schema leaves
      the 380 fixtures and 20 teams untouched.)*
- [ ] **If you already ran the SQL before this deploy, run `db/lms-schema.sql`
      and `db/settlement-fn.sql` again.** Two things changed since: the launch
      review removed `entries.id` from the public `standing_board` view (that
      uuid is the pick-link credential and must not be readable with the
      publishable key), and auto-results was removed, so `settlement-fn.sql`
      now drops `lms_apply_fixture_results`. `lms_settle_round` has also gained
      the `missing_results` guard — it refuses to settle a round while any
      fixture a surviving entry picked is still without a result, so nobody can
      be crowned on a Sunday game that has not been played. All of these
      converge a database that predates the change and touch no data.

## 2. Create the project

- [ ] Vercel → **Add New… → Project** → import **`telfer17/dukes-lms`**.
- [ ] Production branch: **`master`**.
- [ ] Framework preset: **Next.js**. Build command, output directory and install
      command all stay on the defaults — this app needs no build-time steps
      beyond `next build`.
- [ ] **Set the environment variables before the first deploy** (part 3). The
      three Supabase values are needed **at build time** — `next build` imports
      both Supabase clients while collecting page data and they throw when a key
      is missing, so the build **fails** rather than deploying something broken.
      (Verified: building without `SUPABASE_SECRET_KEY` fails with
      "Failed to collect page data".) The other three are read per request.

## 3. Environment variables

Set each for the **Production environment only** — untick Preview and
Development in Vercel's environment picker. Names only here; the values are the
ones in your local `.env.local`, plus the two you generated above. Never paste
real values into the repo, this file, or a chat.

Production-only scoping means preview deployments — every branch, every pull
request, anything a GitHub integration builds — hold no database credentials,
no admin password. There is one live database behind this
app and a preview points at exactly the same rows as production, so a preview
with credentials is a second front door to the real competition, with the same
`ADMIN_PASSWORD` on it.

**What that costs you:** preview and development deployments will **fail to
build**, not deploy-and-degrade. Both Supabase clients throw when a key is
missing and `next build` imports them (verified: `Missing required env var
NEXT_PUBLIC_SUPABASE_URL` → `Build error`). That is the intended outcome here —
check layout and copy locally with `npm run dev`, which is faster than a
preview deployment anyway.

If you ever do want working previews, that is the moment to create a
**separate Supabase project** with its own throwaway data and scope its
credentials to Preview. Never by copying the production values into the Preview
scope — that is the thing this section exists to prevent.

| Variable | Value comes from |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `.env.local` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `.env.local` |
| `SUPABASE_SECRET_KEY` | `.env.local` |
| `ADMIN_PASSWORD` | `.env.local` |

Optional, and **only** once a custom domain is pointed at the app:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | `https://your-domain` — the absolute base for the share card. Without it the app uses Vercel's own production URL automatically, which is correct until the domain changes. |

- [ ] All four required variables set, **Production scope only**.
- [ ] Double-check `SUPABASE_SECRET_KEY` is the **secret** key and
      `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is the **publishable** one. Swapping
      them would publish the secret key in the client bundle.

> Deliberately *not* doing full per-environment isolation (separate Supabase
> projects and credential sets for production, preview and development). One
> organiser, one club competition, one database — a second project to maintain,
> reseed and keep in step with `db/` would cost more than it protects. Scoping
> the credentials to Production gets the property that actually matters: no
> preview URL can touch the live competition.

## 4. Deploy

- [ ] **Deploy**, and wait for the build to go green.
- [ ] Note the production URL. Everything below runs against it — call it
      `$SITE` in the terminal:
      ```bash
      SITE=https://<your-project>.vercel.app
      ```

## 5. Post-deploy verification (on the live URL)

**Public screens**

- [ ] `$SITE` — homepage renders: crest, how it works, the £10 / £5 / £5 split,
      and either the live round or the "starts soon — season kicks off Friday 21
      August" state. Whichever it shows should match reality.
- [ ] `$SITE/leaderboard` — renders: crest, competition name, the alive count,
      the pot, the round card with its countdown, then the two standings tables.
      With no competition yet it says so honestly rather than erroring.
- [ ] `$SITE/board` and `$SITE/grid` both land on `/leaderboard` (307). These
      are the links already shared in the WhatsApp group.
- [ ] `$SITE/rules` — renders in full, all nine sections, buy-in table included.
- [ ] `$SITE/pick/anything` and `$SITE/find` both 404. Players have no
      pick-entry page: every pick goes through a club contact to the organiser.
- [ ] Nav links (Leaderboard, Rules) work, and the Footy Fees logo shows at
      desktop width.
- [ ] On a phone, not just a desktop window narrowed down.

**Admin**

- [ ] `$SITE/admin` redirects to the login when signed out.
- [ ] Logging in with `ADMIN_PASSWORD` works, and `/admin/competition`,
      `/admin/entrants` and `/admin/results` all load without a
      "could not read" banner — that banner means `SUPABASE_SECRET_KEY` is wrong
      or the SQL hasn't been run.

**Share card**

- [ ] Send `$SITE` to yourself on WhatsApp and confirm the card renders (crest,
      "LAST MAN STANDING", orange rule). If it's blank, the image is cached —
      WhatsApp caches share cards hard, so get this right *before* the
      announcement goes out.

## 6. Go live

- [ ] Create the competition in `/admin/competition` and generate the rounds
      from the fixture list.
- [ ] Check round 1's deadline reads **Friday 21 August, 20:00** (the first
      kick-off, Arsenal v Coventry City). If a broadcaster has moved a game
      earlier, fix the round before anyone can pick.
- [ ] Add the entrants in `/admin/entrants`, and tell the club contacts that
      picks come to them and get entered on that same screen.
- [ ] Send the announcement — [`docs/LAUNCH-MESSAGE.md`](docs/LAUNCH-MESSAGE.md),
      with `<SITE URL>` and `<ORGANISER>` filled in.

## If something's wrong

| Symptom | Cause |
| --- | --- |
| Build fails on `Missing NEXT_PUBLIC_SUPABASE_URL...` | Env vars weren't set before the first build. Set them, redeploy |
| Screens render but every list is empty | The SQL in `db/` hasn't been run, or was run against the wrong project |
| Admin shows "could not read" | `SUPABASE_SECRET_KEY` wrong, or `db/settlement-fn.sql` not run |
| Share card blank on WhatsApp | Cached. Re-share after redeploying, or from a slightly different URL |
