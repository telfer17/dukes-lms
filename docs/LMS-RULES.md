# Dukes — Last Man Standing Rules

Agreed rules for the "Dukes" Last Man Standing competition. This document is the
single source of truth; later build phases should reference it rather than
re-deriving behaviour.

## Overview

- Last Man Standing / survivor pool for the English Premier League season.
- Each round, every active player picks one PL team to win.
- Win = progress. Draw or loss = eliminated.
- A team can only be picked once per competition.
- Last player remaining wins the pot.

## Entry & money

- Entry is **£10**, split **50/50**: £5 to the prize pot, £5 to the club.
- The 50/50 split applies to **every** payment, including buy-backs (see
  [Buy-back](#buy-back)) and larger newcomer buy-ins (see
  [Rollovers & re-entry](#rollovers--re-entry)).
- The prize pot is the accumulated pot-half of all entries.
- **Multiple entries are allowed.** A person may enter the same competition more
  than once — e.g. "David Smith 1", "David Smith 2" — provided they pay a **full
  entry fee for each entry**.
- Each entry is **completely independent**: its own picks, its own used-team
  history, and its own survival. Two entries belonging to the same person may
  pick **different teams in the same round**, and one can go out while the other
  survives.

## Rounds

- A "round" = one Premier League matchday (Matchday 1, 2, 3, …).
- Each player picks exactly one team from that matchday's fixtures.
- **Players do not use the site.** Picks go to the organiser — in practice by
  WhatsApp — and the **organiser or a club admin enters them on the site**. The
  site is an organiser's tool; there is no player-facing pick screen and nothing
  for a player to log into.
- Picks lock at the round deadline — the **first kickoff of that matchday**.
  The deadline therefore **varies from round to round**: it is not a fixed day
  or time, it is whenever that matchday's earliest game kicks off. A round
  starting on the Friday night locks on the Friday night.
- No changes after the deadline — see [Locking a round](#locking-a-round) for
  what the organiser does then, and for the one correction that is still allowed
  afterwards.

## Survival rules

- Team **wins** → progress to the next round.
- Team **draws or loses** → eliminated.
- A team may only be picked **once per competition**. Once a player has used all
  20 teams, their pool resets and all teams become available to them again.
- **Missed pick** (no selection by the deadline) → a team is **assigned at
  random** from the teams that entry has **not already used** *and* that are
  **playing in that matchday**. This is the agreed gentle handling — a missed
  pick is **not** automatic elimination. It happens when the organiser
  [locks the round](#locking-a-round). If the entry has no unused team playing
  that matchday, it is assigned an unused team that is **not** playing, and goes
  out when the round settles — see [Locking a round](#locking-a-round).
- Auto-assign applies **per entry**. Someone holding two entries who misses both
  deadlines gets a team assigned for each one, drawn separately from that entry's
  own unused teams (so the two will usually be different teams).

## Locking a round

Once the deadline has passed, the organiser presses **Lock round**. That is the
moment missed picks are dealt with, and it is a deliberate press rather than
something that happens quietly on a timer.

- **What locking does.** Every entry that still has **no pick** is assigned one
  **at random**, drawn from that entry's **not-yet-used** teams that are
  **playing that matchday**. Entries that already have a pick are untouched.
- **The draw is seeded, not live.** The randomness is **deterministically seeded
  from the entry and the round**, so the same entry in the same round always
  draws the same team. It does not matter **who** presses Lock, or **when** they
  press it, or how many times — the answer is fixed before anyone asks. Nobody
  can re-roll an assignment they do not like, and the result can be re-derived
  and checked afterwards.
- **It is written permanently.** A locked assignment is a real pick on the
  record, exactly like one a player sent in. It counts as **used** for that
  entry's team pool, win or lose.
- **Per entry**, drawn from that entry's own unused teams — two entries of the
  same person are drawn separately.
- **Nobody is ever skipped.** If the entry has no unused team **playing** that
  matchday, it is still assigned one **at random from its unused teams**, even
  though that team has no game. A team with no game cannot win, so that entry is
  **eliminated when the round settles**. That is the intended consequence of not
  sending a pick in, not a fault: the site never skips an entry and never
  refuses to lock over one.
  - Once an entry has used **all 20** teams the ordinary **pool reset** applies
    (see [Survival rules](#survival-rules)) and every team is available to it
    again — so "no unused teams at all" cannot arise.
- **Locking is idempotent.** Locking a round that is already locked does
  **nothing** to entries that already have a pick — assigned or manual. Only
  **blanks** are filled, and a filled pick is permanent. Pressing Lock twice, or
  by two different people, cannot change a single thing that was already there.
- **A round with no blanks may still be locked**, and that is a normal thing to
  do: nothing is assigned, and the round is marked locked. It is the "everyone
  is in" signal.

### The Lock button

- It is **visible to the organiser and club admins at all times**, and it
  **shows that round's actual deadline** next to it, because the deadline moves
  every week.
- Pressing it **before** the deadline **warns** that players can still be
  sending picks in and **asks for confirmation**. It is allowed — sometimes the
  organiser knows everybody is in — but it is never the quiet default.
- Pressing it **after** the deadline is the **normal path**, and asks nothing.

### Editing after the lock

A round being locked does **not** freeze the picks for the organiser, and
**locking and editing are independent** — neither has to come first. The
organiser can enter a late pick and then lock, or lock and then correct a pick.
Both orders end in the same place.

- The organiser or a club admin may **edit any entry's pick** — assigned or
  manual — **up until the round is settled**. This exists for the ordinary
  case where a pick arrived on time and did not get entered: a WhatsApp message
  read too late, a name missed on the list.
- **Editing an assigned pick to the player's real choice removes the
  "auto-assigned" marker.** It becomes an ordinary manual pick, because that is
  what it is. The **"auto" marker stays only on picks that were genuinely drawn
  at random** — so what the board shows is the truth about how each pick came to
  be there.
- Once the round is **settled**, picks are final. Settlement is what makes
  eliminations real, and a pick changed after it would contradict a result
  people have already been told.

### What "locked" means here

**Locked is about PICKS, not about the result.** It records that the blanks have
been filled and the round's picks are complete. It is deliberately **separate
from the round's settlement state** — pending, settled, and the provisional-win
lock that holds a round open when a win rests on a postponed game
(see [End states](#end-states)) — because those answer a different question:
what has happened to the *players*. A round can be locked and unsettled, and
locking never moves a round towards being settled.

### Backstop: settling an unlocked round

If a round somehow reaches **settlement** without having been locked, settlement
**fills the remaining blanks itself**, using the **same seeded-random-unused
rule**. Locking early changes nothing about the outcome — it is the same draw,
taken at the same seed — so an unlocked round can never stall settlement, and it
can never produce a different result from a locked one. Locking is when it
normally happens; it is not the only thing that can make it happen.

This is a **guarantee, not a coincidence**: the team an entry gets is fixed by
the seed, so the backstop assigns the **identical team** the lock would have.
Whether the organiser locked the round, locked it twice, or never locked it at
all, the entry ends up with the same team — which is what makes locking a
convenience rather than a thing the result depends on.

## Postponed / abandoned matches

- If a player's picked match is postponed or abandoned, the pick counts as a
  **WIN** and the player progresses to the next round.
- The picked team is still counted as **USED** and cannot be picked again by that
  player — the pick stands even though the game did not produce a normal result.
- A player **cannot win the competition outright solely on a postponed/abandoned
  game**. If a postponed game is the only thing keeping the last player(s) in,
  the round is not settled by it; resolve once the game is played, or per
  organiser decision.

## Buy-back

An entry eliminated **early** gets one chance to pay its way back into the
**same** competition — one chance **per elimination**, not one per competition.
An entry that buys back, plays on and is eliminated **again** in an eligible
round gets a **fresh** window for that new elimination.

- **Who is eligible.** An entry eliminated in **round 1, 2 or 3** may be bought
  back by its owner for another **£10**. Eligibility is decided by the round the
  entry went **out** in — eliminated in round 4 or later, there is **no**
  buy-back. A round-3 elimination is the last that can ever buy back; it returns
  for round 4.
- **One window per elimination, immediately following round only.** Eliminated in
  round N → a single buy-back window, for round **N+1**. It must be confirmed — **paid and
  recorded by the organiser** — **before round N+1's pick deadline**. This is a
  single, time-boxed offer, not a standing option: miss that window and the entry
  is **permanently out**. You **cannot** skip a round and buy back later — out in
  R1, sit out R2, rejoin R3 is **not** allowed.
- **Per entry, not per person.** The offer belongs to the **entry**, not its
  owner. Someone holding several entries gets an **independent** buy-back offer
  for **each** eliminated entry, and pays **£10 for each one** they take up.
  Buying one entry back has no effect on their other entries — they may buy back
  one, both, or neither, and an entry still alive is untouched by any of it.
- **Money.** The £10 splits **50/50**: £5 to the prize pot, £5 to the club, same
  as an entry. The pot-half joins **this** competition's pot — the one being
  bought back into. (If this competition later rolls over, that pot carries
  forward as normal; there is no special handling for buy-back money.) A
  bought-back entry that later wins takes the pot normally.
- **Used teams persist.** Buying back restores the entry's **life**, not its
  **team pool**. The team that eliminated the entry — and every team it used
  before that — remains **unavailable**. The bought-back entry continues from its
  existing used-team history; there is **no reset**.
- **Then it is just an active entry.** A bought-back entry picks in round N+1 like
  any other active entry: same deadline, same no-repeat rule against its
  persisted used-team history.
- **Auto-assign applies.** If the owner then makes no pick by round N+1's
  deadline, the standard [missed-pick handling](#locking-a-round) applies — a
  team drawn at random from the ones that entry has not already used and that are
  playing in that matchday, worked out from that entry's **persisted** used-team
  history. Buying back **is** the commitment; a missed pick afterwards is treated
  exactly like any other active entry's, not as a forfeit of the buy-back.

### Buy-back and rollover

Buy-backs resolve **before** rollover.

- If a round ends with **all** remaining entries eliminated, but one or more
  eligible entries buy back in — confirmed before the next round's pick deadline
  — the competition **continues** with those entries. There is **no rollover**.
- **Rollover fires only if** a round ends with **no entries still standing**
  **and** no eligible entry completes a buy-back before the next round's pick
  deadline.

**Pending rollover.** An all-eliminated round is **settled** like any other, but
where a buy-back window exists the competition's **rollover is not finalised** at
that moment. The competition enters a **pending** state that lasts until that
round's buy-back window closes — i.e. until the **next round's pick deadline**:

- Any eligible entry completing a buy-back before then → the competition
  **continues**, the pending state clears, and there is no rollover.
- The window closing with no buy-back taken → the **rollover is confirmed at that
  point**, and the new competition begins.

This mirrors the provisional-win lock: a competition-level state that resolves on
a **deadline**, not instantly.

**Pending only applies to rounds 1, 2 and 3.** There is nothing to wait for
unless a window actually exists, and a window only exists for an elimination in
rounds 1–3. So:

- A field wiped out in **round 1, 2 or 3** → **pending**, until that window
  closes.
- A field wiped out in **round 4 or later** → **rollover immediately, on
  settlement**. Everyone who went out did so too late to buy back, there is no
  window, and waiting would be waiting for nothing.

**Operational rule for the organiser:** when a round **1–3** wipes out the field,
do not declare or settle the rollover until the buy-back window has closed with
no buy-backs taken — until then the competition is pending, not rolled over.
From round 4 on there is no window, and the rollover is final the moment the
round is settled.

## End states

End states are read **after the whole round has been settled**, never mid-round.
A round is not settled until every fixture a surviving entry picked has a result
— including the Sunday and Monday games. Nobody is the Last Man Standing on the
Saturday night just because every other entry has already gone out that day: if
the remaining entry then loses on the Sunday, everyone is out in the same round
and it is a rollover.

A settled round is also not the whole story while a [buy-back](#buy-back) window
is still open. Being the last entry standing before eliminated entries' buy-back
windows close is **not yet winning**. That caveat only bites in **rounds 1, 2 and
3**: from round 4 on nobody eliminated can buy back, so there is no window and
the round settles the competition outright.

- **One entry left once the round is settled *and* the buy-back window for that
  round has closed without a buy-back that would revive a competitor** → that
  entry is the Last Man Standing, wins the entire pot, and the competition ends.
  If an eligible entry does buy back in before the next round's pick deadline,
  the sole survivor has not won: the competition continues with both. A sole
  survivor of **round 4 or later** wins **immediately on settlement** — no window
  can be open, so there is nothing to wait for.
- **Last entries all belong to the same person** → that person wins, and takes
  the **single pot**. It is winner-takes-all: holding the last two entries does
  not win two shares, and there are no split or runner-up places.
- **Everyone eliminated in the same round** (no survivors) **and no eligible
  entry buys back** before the next round's pick deadline → the pot rolls over
  and a new competition begins (see [Buy-back](#buy-back) and Rollovers). From
  round 4 on there is no eligible entry by definition, so the rollover is
  immediate.

## Rollovers & re-entry

- On a rollover, a brand-new competition starts: blank slate, all 20 teams
  available to everyone, matchday counter resets, and the rolled-over pot carries
  in on top.
- **Returning players** (who were in the previous competition) re-enter for the
  standard **£10**.
- **New players** joining a rolled-over competition pay a higher buy-in so their
  pot contribution equals what continuing players have already put in:

  ```
  buy-in = £10 × (number of prior rollovers + 1)
  ```

  i.e. the same **total** a since-the-start player has paid to date.

  | Prior rollovers | Buy-in | Pot | Club |
  | --- | --- | --- | --- |
  | 1 | £20 | £10 | £10 |
  | 2 | £30 | £15 | £15 |
  | 3 | £40 | £20 | £20 |

  …+£10 per further rollover.

- **Rationale:** stops newcomers buying into an accumulated jackpot more cheaply
  than the players who built it.

## Open decisions (TO CONFIRM — not yet finalised)

- (None currently — add any further open items here as they arise.)
