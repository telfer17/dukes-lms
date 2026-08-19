// Buy-back, as the screens and the server actions need it: DB rows in, engine
// answers out.
//
// Pure — no database, no React, no I/O. It imports lib/lms.ts (the rules) and
// lib/settlement-plan.ts (the plan shapes) and nothing else, so "can this entry
// buy back, and for which round?" is answerable from plain rows and testable
// without a server.
//
// The RULES are not here. Every verdict below comes from buybackEligibility();
// what this file does is the joining — an entry knows the ID of the round it
// went out in, the rules want its NUMBER, and a recorded buy-back has to be
// matched to the elimination it bought rather than merely to the entry.

import {
  buybackEligibility,
  type BuybackCandidate,
  type BuybackVerdict,
  type EntryStatus,
} from "@/lib/lms";
import type { PlanBuyback, PlanRoundInfo } from "@/lib/settlement-plan";

/** The entry fields buy-back needs. A subset of lms-db's EntryRow. */
export type BuybackEntry = {
  id: string;
  participant_id: string;
  status: EntryStatus;
  eliminated_round_id: string | null;
};

/** The round fields buy-back needs. A subset of lms-db's RoundRow. */
export type BuybackRoundRow = {
  id: string;
  round_number: number;
  deadline: string;
  status: "pending" | "locked" | "settled";
};

/** One recorded buy-back, as db/buyback.sql stores it. */
export type BuybackRow = {
  id: string;
  entry_id: string;
  eliminated_round_id: string;
  round_id: string;
  paid: boolean;
  amount_paid_pence: number;
};

/** What the admin needs to render, or refuse, one entry's buy-back button. */
export type BuybackOffer = {
  entry_id: string;
  verdict: BuybackVerdict;
  /** The round it would come back for — null when there is no such round. */
  round: BuybackRoundRow | null;
};

function byId(rounds: BuybackRoundRow[]): Map<string, BuybackRoundRow> {
  return new Map(rounds.map((r) => [r.id, r]));
}

function byNumber(rounds: BuybackRoundRow[]): Map<number, BuybackRoundRow> {
  return new Map(rounds.map((r) => [r.round_number, r]));
}

/** The round number an entry went out in, or null if it is not out. */
export function eliminatedRoundNumber(
  entry: BuybackEntry,
  rounds: BuybackRoundRow[]
): number | null {
  if (entry.eliminated_round_id === null) return null;
  return byId(rounds).get(entry.eliminated_round_id)?.round_number ?? null;
}

/**
 * Recorded buy-backs in the shape the plan builders take — round IDs resolved
 * to round NUMBERS, which is the only form the rules are written in.
 *
 * A row whose rounds cannot be resolved is dropped rather than guessed at. It
 * cannot happen through the app (both columns are foreign keys into the same
 * competition's rounds), and inventing a number for one would be worse than
 * leaving it out: it would either invent a buy-back nobody made or cancel a
 * window somebody paid for.
 */
export function planBuybacks(
  buybacks: BuybackRow[],
  rounds: BuybackRoundRow[]
): PlanBuyback[] {
  const rounds_ = byId(rounds);
  const planned: PlanBuyback[] = [];

  for (const b of buybacks) {
    const eliminated = rounds_.get(b.eliminated_round_id);
    const target = rounds_.get(b.round_id);
    if (!eliminated || !target) continue;
    planned.push({
      id: b.id,
      entry_id: b.entry_id,
      eliminated_round_number: eliminated.round_number,
      for_round_number: target.round_number,
    });
  }

  return planned;
}

/** Rounds in the shape the rules read them. */
export function planRounds(rounds: BuybackRoundRow[]): PlanRoundInfo[] {
  return rounds.map((r) => ({
    round_number: r.round_number,
    deadline: r.deadline,
    status: r.status,
  }));
}

/**
 * Every ELIMINATED entry's buy-back offer, keyed by entry id.
 *
 * Eliminated only: an active entry has nothing to buy back, and putting a
 * refusal against every live entry would just be noise on a screen that already
 * has fifty rows. Callers show the button where `verdict.eligible` is true and
 * say nothing at all where it is false — the reason is there for the server
 * action to quote back if the button is pressed on a stale page.
 */
export function buybackOffers(input: {
  entries: BuybackEntry[];
  rounds: BuybackRoundRow[];
  buybacks: BuybackRow[];
  now?: Date;
}): Map<string, BuybackOffer> {
  const { entries, rounds, buybacks, now = new Date() } = input;
  const numbered = byNumber(rounds);

  // Keyed by entry AND elimination round: the offer is per elimination, so an
  // entry that has been out twice has had two of them.
  const used = new Set(
    planBuybacks(buybacks, rounds).map(
      (b) => `${b.entry_id}:${b.eliminated_round_number}`
    )
  );

  const offers = new Map<string, BuybackOffer>();

  for (const entry of entries) {
    if (entry.status !== "eliminated") continue;

    const out = eliminatedRoundNumber(entry, rounds);
    const candidate: BuybackCandidate = {
      entry_id: entry.id,
      participant_id: entry.participant_id,
      status: entry.status,
      eliminated_round_number: out,
      bought_back: out !== null && used.has(`${entry.id}:${out}`),
    };

    const round = out === null ? null : (numbered.get(out + 1) ?? null);
    offers.set(entry.id, {
      entry_id: entry.id,
      verdict: buybackEligibility(candidate, round ?? undefined, now),
      round,
    });
  }

  return offers;
}
