// Pure partition helper for the "mark all paid" flow. Newcomers and returning
// players owe different amounts, so a bulk update has to be split by that flag.
// No imports, no I/O — unit-tested in tests/group-payment.test.ts.

export type PayableEntry = { id: string; is_newcomer: boolean };

export type PaymentPartition = {
  newcomerIds: string[];
  returningIds: string[];
};

export function partitionByNewcomer(
  entries: PayableEntry[]
): PaymentPartition {
  const newcomerIds: string[] = [];
  const returningIds: string[] = [];
  for (const entry of entries) {
    (entry.is_newcomer ? newcomerIds : returningIds).push(entry.id);
  }
  return { newcomerIds, returningIds };
}
