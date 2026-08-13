// Pure competition maths: the newcomer buy-in ladder and the pot split.
// No imports, no I/O — unit-tested in tests/competition.test.ts.
//
// Money is ALWAYS integer pence (£10 = 1000). See docs/LMS-SCHEMA.md.

export const BASE_ENTRY_PENCE = 1000;

/**
 * What this entry is expected to pay, per docs/LMS-RULES.md:
 *   returning player → £10
 *   newcomer         → £10 x (rollover_count + 1)
 *
 * Expected only — entries.amount_paid_pence records what was ACTUALLY paid.
 */
export function expectedBuyInPence(
  rolloverCount: number,
  isNewcomer: boolean
): number {
  const multiplier = isNewcomer ? Math.max(0, rolloverCount) + 1 : 1;
  return BASE_ENTRY_PENCE * multiplier;
}

export type EntryMoney = {
  paid: boolean;
  amount_paid_pence: number;
};

/** Everything actually collected — unpaid entries contribute nothing. */
export function collectedPence(entries: EntryMoney[]): number {
  return entries
    .filter((e) => e.paid)
    .reduce((sum, e) => sum + e.amount_paid_pence, 0);
}

/**
 * The prize pot: whatever rolled in from the previous competition, plus half
 * of everything collected. The 50/50 split applies to every payment including
 * the larger newcomer buy-ins, so it is one halving of the total.
 *
 * Buy-ins are whole pounds so the halving is exact; if an odd number of pence
 * ever arrived, the stray penny goes to the club (pot floors) rather than
 * inventing money.
 */
export function potPence(
  carriedInPence: number,
  entries: EntryMoney[]
): number {
  return carriedInPence + Math.floor(collectedPence(entries) / 2);
}

/** The club's half of everything collected. Never includes the carried-in pot. */
export function clubPence(entries: EntryMoney[]): number {
  const collected = collectedPence(entries);
  return collected - Math.floor(collected / 2);
}

/** "£10" for whole pounds, "£12.50" otherwise. */
export function formatPence(pence: number): string {
  const pounds = pence / 100;
  return Number.isInteger(pounds) ? `£${pounds}` : `£${pounds.toFixed(2)}`;
}
