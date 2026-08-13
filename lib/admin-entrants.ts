// Pure entry-grouping logic for the admin entrants page. No DB or framework
// imports — unit-tested in tests/admin-entrants.test.ts.
//
// Groups ENTRIES (not people): one person may hold several entries in a
// competition, and each is paid for and survives independently.

import { expectedBuyInPence } from "@/lib/competition";
import type { EntryStatus } from "@/lib/lms";

export type EntryRecord = {
  id: string;
  name: string;
  phone: string | null;
  club_contact: string | null;
  paid: boolean;
  amount_paid_pence: number;
  is_newcomer: boolean;
  status: EntryStatus;
};

export type GroupedEntry = EntryRecord & {
  /** What the ladder says this entry should have paid. */
  expected_pence: number;
  /** Paid, but not the expected amount — worth an admin's eye. */
  amount_mismatch: boolean;
};

export type EntryGroup = {
  clubContact: string;
  entries: GroupedEntry[];
  paidCount: number;
  total: number;
};

export type EntryTotals = {
  entries: number;
  paid: number;
  unpaid: number;
  active: number;
};

export function groupEntries(
  entries: EntryRecord[],
  rolloverCount: number
): { groups: EntryGroup[]; totals: EntryTotals } {
  const byContact = new Map<string, GroupedEntry[]>();

  for (const e of entries) {
    const contact = e.club_contact ?? "";
    const expected_pence = expectedBuyInPence(rolloverCount, e.is_newcomer);
    const list = byContact.get(contact) ?? [];
    list.push({
      ...e,
      expected_pence,
      amount_mismatch: e.paid && e.amount_paid_pence !== expected_pence,
    });
    byContact.set(contact, list);
  }

  const groups = [...byContact.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([clubContact, list]) => ({
      clubContact,
      entries: [...list].sort((a, b) => a.name.localeCompare(b.name)),
      paidCount: list.filter((e) => e.paid).length,
      total: list.length,
    }));

  const paid = entries.filter((e) => e.paid).length;
  const totals: EntryTotals = {
    entries: entries.length,
    paid,
    unpaid: entries.length - paid,
    active: entries.filter((e) => e.status === "active").length,
  };

  return { groups, totals };
}
