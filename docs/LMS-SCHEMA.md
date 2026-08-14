# Dukes — Last Man Standing: data model

The schema that backs [LMS-RULES.md](LMS-RULES.md). The DDL to run is
[`db/lms-schema.sql`](../db/lms-schema.sql) — paste it into the Supabase SQL
editor. It is additive and safe to re-run.

This phase is schema only. No fixtures are seeded (Phase 6), no competition row
is created, and the survival engine (Phase 4, `lib/lms.ts`) is not written.

## The seven tables

| Table | What one row is | Scope |
| --- | --- | --- |
| `participants` | A **person** | Forever — reused across competitions |
| `competitions` | One LMS **instance**; a rollover starts a new one | — |
| `entries` | A person's **membership of one competition** (alive/eliminated + money) | Per competition |
| `teams` | One of the 20 PL clubs | Static reference |
| `fixtures` | One of the 380 season matches | Per **season**, not per competition |
| `rounds` | One round of one competition | Per competition |
| `picks` | One team chosen by one entry in one round | Per competition |

```
participants ──< entries >── competitions ──< rounds >── (matchday) ── fixtures >── teams
                    │             │                                                   │
                    └──────< picks >───────────────────────────────────────────────────┘
                              (entry + round + team)

competitions.winner_participant_id ──> participants.id
entries.eliminated_round_id        ──> rounds.id
```

`rounds` links to `fixtures` by **matchday number**, not by foreign key — a
round says "I am PL matchday 6", and the engine pulls that matchday's fixtures.

## Design decisions

### Person vs entry

`participants` is the human; `entries` is their run in a given competition.
They are split because a rollover starts a **new** competition and the same
person needs a fresh row with:

- a new `status` (they're alive again from a blank slate),
- a **different buy-in** (`amount_paid_pence` — £10 returning vs the newcomer
  ladder), and
- their own `paid` flag.

Keeping alive/eliminated and payment on `participants` would mean destroying
last competition's record every time one rolls over. Now the history survives:
one person, many entries, each with its own money and its own fate.

**Multi-entry is intentional.** There is deliberately **no unique constraint on
`(competition_id, participant_id)`** — a person may enter the same competition
more than once ("David Smith 1", "David Smith 2") provided they pay a full
entry fee for each.

Every entry is fully independent: its own picks, its own used-team history, its
own alive/eliminated status. Nothing is keyed on `participant_id`; everything
hangs off `entry_id`, so two entries belonging to the same person can pick
different teams in the same round and go out in different rounds without any
special handling. This matches the multi-entry pattern the World Cup predictor
allowed.

### Recording the winner: a person, not an entry

`competitions.winner_participant_id` is the **source of truth for who won**, and
it names a **person**.

It has to, because multi-entry plus winner-takes-all means the last survivors
can be two entries belonging to the same player. One person wins the single pot
regardless of how many entries they finished with, and the payout is made to a
person — so a single winning *entry* id would be arbitrary and lossy.

`entries.status = 'winner'` is the entry-level marker of **which entries
survived to the end**. More than one entry may carry it — both of a multi-entry
player's survivors do — but only ever **one** participant is
`winner_participant_id`.

| Question | Read |
| --- | --- |
| Who won? Who gets paid? | `competitions.winner_participant_id` |
| Which entries were still standing? | `entries.status = 'winner'` |

Payout logic reads `winner_participant_id`. Counting `entries.status = 'winner'`
to work out prize money would double-pay a two-entry winner.

### Money is always integer pence

Every money column is `integer` pence — `amount_paid_pence`,
`pot_carried_in_pence`. £10 = `1000`. No floats, no `numeric`, nothing that can
drift by a penny in a rounding step.

**Pot for a competition:**

```
pot_pence  = competitions.pot_carried_in_pence
           + sum(entries.amount_paid_pence where paid) / 2

club_pence = sum(entries.amount_paid_pence where paid) / 2
```

The 50/50 split applies to **every** payment including the larger newcomer
buy-ins, which is why it is a single halving of the total rather than a
per-entry special case. Buy-ins are whole pounds, so `amount_paid_pence` is
always even and the integer division is exact.

Unpaid entries contribute nothing — the `where paid` filter is what makes the
pot reflect money actually collected.

### Newcomer buy-in: recorded, not enforced

The rules ladder is:

| Player | Buy-in |
| --- | --- |
| Returning (was in the previous competition) | £10 → `1000` |
| Newcomer | £10 × (`rollover_count` + 1) → `1000 * (rollover_count + 1)` |

`is_newcomer` flags which side of that a person falls on, and
`competitions.rollover_count` supplies the multiplier.

There is deliberately **no CHECK constraint tying `amount_paid_pence` to that
formula.** The column records what was *actually paid*, so a part payment, a
goodwill discount, or a correction can be entered truthfully instead of being
rejected by the database. The expected amount is computed and displayed in the
app; the discrepancy is an admin's to see, not the schema's to forbid.

### Round number vs PL matchday

`rounds` carries both:

- `round_number` — position **within the competition** (1, 2, 3…)
- `matchday` — which PL matchday (1–38) supplies the fixtures

They are separate because a rollover restarts the round counter mid-season. If
everyone goes out in PL matchday 5, Competition 2's **round 1** is PL
**matchday 6**:

| Competition | round_number | matchday |
| --- | --- | --- |
| Competition 1 | 1, 2, 3, 4, 5 | 1, 2, 3, 4, 5 |
| Competition 2 | 1, 2, 3 | 6, 7, 8 |

Collapsing the two would make "round 1" ambiguous and break both the board and
the fixture lookup. `fixtures` is season-wide for the same reason — a rollover
reuses the same 380 matches, so fixtures must not belong to a competition.

`deadline` is the first kickoff of that matchday; picks lock there.

### No-repeat-team lives in the engine, not the database

**There is deliberately no unique constraint on `(entry_id, team_id)`.**

The rule is "a team may only be picked once per competition — *until* a player
has used all 20, at which point their pool resets and every team is available
again." A unique index cannot express that: the 21st pick is a legitimate
repeat, and the database has no way to know it is the 21st.

So the check is the engine's job (Phase 4, `lib/lms.ts`): count the entry's
picks, take `count mod 20` as the position in the current cycle, and treat only
teams used **since the last reset** as unavailable. `picks_entry_team_idx`
exists to make that lookup fast.

What the database **does** enforce is **one pick per (entry, round)** —
`picks_one_per_entry_round`. That one has no exceptions in the rules, so it
belongs in the schema.

### Postponed and abandoned matches

`fixtures.result` is `home` / `away` / `draw`, and a CHECK constraint keeps it
`NULL` unless `status = 'played'`. Postponed and abandoned games therefore
carry **no result at all** — they are not recorded as a win.

The rules say the *pick* counts as a win, which is a statement about the pick,
not the match. So the engine settles `picks.outcome = 'survived'` when the
picked team's fixture is postponed or abandoned, and the team still counts as
used because the `picks` row exists. Nothing about the fixture is falsified.

The "can't win outright on a postponed game" rule is a settlement decision, not
a storage one: the round simply stays `locked` rather than `settled` until the
game is played or the organiser calls it.

### Denormalised `competition_id`, guaranteed consistent

`picks.competition_id` is derivable (via `entry_id` or `round_id`) but stored
anyway, so board queries filter on one indexed column instead of joining twice.

To stop it drifting, `picks` uses **composite foreign keys** —
`(entry_id, competition_id) → entries (id, competition_id)` and
`(round_id, competition_id) → rounds (id, competition_id)`. The database now
guarantees a pick's entry, round and competition all agree; a pick pairing a
Competition 2 entry with a Competition 1 round is rejected outright.

### Foreign keys and deletes

| Reference | On delete | Why |
| --- | --- | --- |
| `entries.competition_id` | `CASCADE` | Deleting a competition removes its entries |
| `entries.participant_id` | `CASCADE` | Deleting a person removes their entries |
| `picks.entry_id` / `picks.round_id` | `CASCADE` | Picks are meaningless without them |
| `picks.team_id`, `fixtures.*_team_id` | `RESTRICT` | Never silently delete a club with history |
| `entries.eliminated_round_id` | `SET NULL` | Keep the entry, drop the dangling pointer |
| `competitions.winner_participant_id` | `RESTRICT` | A competition's winner is permanent history — block the delete rather than silently erase who won |

Other guards: one `active` competition at a time (partial unique index); a club
plays at most once per matchday; `eliminated_round_id` may only be set on an
entry whose status is `eliminated`.

### Indexes

On the columns the board and engine filter by: `entries (competition_id)`,
`entries (competition_id, status)` for "who's still in", `picks (round_id)`,
`picks (competition_id)`, `picks (entry_id, team_id)` for the no-repeat check,
`fixtures (matchday)` and `fixtures (kickoff)`, and `participants (phone)` for
entry lookup.

## Access model

**RLS stays off**, matching the World Cup predictor. Access is controlled by
grants instead, and all privileged reads go through the secret key
(`lib/supabase-server.ts`), which bypasses grants entirely.

| Readable with the publishable (anon) key | Secret key only |
| --- | --- |
| `teams`, `fixtures`, `rounds`, `competitions` | `participants` (**phone**) |
| `standing_board` (view) | `entries` (**payment amounts**, `paid`) |
| | `picks` |

Supabase grants `anon` access to new public-schema tables by default, so the
schema file explicitly **revokes** it on `participants`, `entries` and `picks`.
Without those revokes, anyone with the publishable key — which ships in the
browser bundle — could read every phone number in the database.

`picks` is private on purpose: exposing picks before a round locks would let
latecomers copy. A public picks view filtered on `rounds.status <> 'pending'`
can be added once the board needs it.

### `standing_board`

The public "who's still in" view. Columns: `competition_id`, `name`, `status`,
`eliminated_round_number`. **No phone, no payment, no amounts — and no
`entries.id`.** It reads the private base tables safely because a Postgres view
runs with its owner's privileges — the same trick the World Cup
`participant_points` view used.

`entries.id` was removed from this view during the launch review. It names an
entry to every write path in the app — and at the time it was also the whole
credential for `/pick/[entryId]`, since removed — so a column readable with the
publishable key is the wrong place for it. The board never needed it — it
renders names and statuses and keys off
name+index (`lib/public-read.ts`, `tests/public-read.test.ts`). Because
`create or replace view` cannot drop a column, the schema now does
`drop view if exists standing_board` first; the file stays re-runnable, and the
grants that follow are re-applied on every run.

It spans all competitions, so callers must filter on `competition_id`.

## Verified before shipping

The schema was run against a scratch Postgres database and checked to enforce
what this document claims: single active competition; one pick per entry per
round; **multi-entry accepted** — the same person entered twice in one
competition, and the same person across two competitions; a **repeated team
allowed** in a later round; cross-competition picks
rejected; postponed fixtures unable to carry a result; a club appearing once
per matchday; `eliminated_round_id` rejected on an active entry; the pot
formula producing exact pence; a competition recording a `winner_participant_id`
with **two entries of that same person both at `status = 'winner'`** under it;
and `anon` able to read `standing_board` and
`teams` but **denied** on `participants`, `entries` and `picks`.

## Deliberately not here yet

- **Fixtures** — table defined, empty. Seeded in Phase 6, mapping source names
  onto `teams.name` by stripping a trailing `" FC"` / `" AFC"` and a leading
  `"AFC "`.
- **Competition rows** — the first competition is created by an admin action,
  not by this file.
- **Survival logic** — no triggers, no computed `outcome`, no auto-assignment.
  All of it belongs in `lib/lms.ts` (Phase 4) where it can be unit-tested.
- **A pot view** — the formula is documented above; it is computed server-side
  rather than stored, so it can never go stale.

## Open questions

1. **Phase 2 admin code reads `participants.paid`.** That column now lives on
   `entries` instead. `/admin/entrants` is guarded so it degrades to an empty
   state rather than crashing, but it needs rewiring to the
   `entries` + `competitions` model in a later phase.
