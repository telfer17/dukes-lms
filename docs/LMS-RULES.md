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
- Picks lock at the round deadline — the **first kickoff of that matchday**.
  No changes after the deadline.

## Survival rules

- Team **wins** → progress to the next round.
- Team **draws or loses** → eliminated.
- A team may only be picked **once per competition**. Once a player has used all
  20 teams, their pool resets and all teams become available to them again.
- **Missed pick** (no selection by the deadline) → auto-assign the first team
  **alphabetically** that the player has not already used *and* that is playing
  in that matchday. This is the agreed gentle handling — a missed pick is **not**
  automatic elimination.
- Auto-assign applies **per entry**. Someone holding two entries who misses both
  deadlines gets a team auto-assigned for each one, worked out separately from
  that entry's own used-team history (so the two may well be different teams).

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
**same** competition.

- **Who is eligible.** An entry eliminated in **round 1, 2 or 3** may be bought
  back by its owner for another **£10**. Eligibility is decided by the round the
  entry went **out** in — eliminated in round 4 or later, there is **no**
  buy-back. A round-3 elimination is the last that can ever buy back; it returns
  for round 4.
- **One window, immediately following round only.** Eliminated in round N → a
  single buy-back window, for round **N+1**. It must be confirmed — **paid and
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
  deadline, the standard [missed-pick handling](#survival-rules) applies — first
  team **alphabetically** that the entry has not already used and that is playing
  in that matchday, worked out from that entry's **persisted** used-team history.
  Buying back **is** the commitment; a missed pick afterwards is treated exactly
  like any other active entry's, not as a forfeit of the buy-back.

### Buy-back and rollover

Buy-backs resolve **before** rollover.

- If a round ends with **all** remaining entries eliminated, but one or more
  eligible entries buy back in — confirmed before the next round's pick deadline
  — the competition **continues** with those entries. There is **no rollover**.
- **Rollover fires only if** a round ends with **no entries still standing**
  **and** no eligible entry completes a buy-back before the next round's pick
  deadline.

**Pending rollover.** An all-eliminated round is **settled** like any other, but
the competition's **rollover is not finalised** at that moment. The competition
enters a **pending** state that lasts until that round's buy-back window closes —
i.e. until the **next round's pick deadline**:

- Any eligible entry completing a buy-back before then → the competition
  **continues**, the pending state clears, and there is no rollover.
- The window closing with no buy-back taken → the **rollover is confirmed at that
  point**, and the new competition begins.

This mirrors the provisional-win lock: a competition-level state that resolves on
a **deadline**, not instantly.

**Operational rule for the organiser:** when a round wipes out the field, do not
declare or settle the rollover until the buy-back window has closed with no
buy-backs taken. Until then the competition is pending, not rolled over.

## End states

End states are read **after the whole round has been settled**, never mid-round.
A round is not settled until every fixture a surviving entry picked has a result
— including the Sunday and Monday games. Nobody is the Last Man Standing on the
Saturday night just because every other entry has already gone out that day: if
the remaining entry then loses on the Sunday, everyone is out in the same round
and it is a rollover.

A settled round is also not the whole story while a [buy-back](#buy-back) window
is still open. Being the last entry standing before eliminated entries' buy-back
windows close is **not yet winning**.

- **One entry left once the round is settled *and* the buy-back window for that
  round has closed without a buy-back that would revive a competitor** → that
  entry is the Last Man Standing, wins the entire pot, and the competition ends.
  If an eligible entry does buy back in before the next round's pick deadline,
  the sole survivor has not won: the competition continues with both.
- **Last entries all belong to the same person** → that person wins, and takes
  the **single pot**. It is winner-takes-all: holding the last two entries does
  not win two shares, and there are no split or runner-up places.
- **Everyone eliminated in the same round** (no survivors) **and no eligible
  entry buys back** before the next round's pick deadline → the pot rolls over
  and a new competition begins (see [Buy-back](#buy-back) and Rollovers).

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
