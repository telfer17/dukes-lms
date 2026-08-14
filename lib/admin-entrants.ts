// Pure entry-grouping logic for the admin entrants page. No DB or framework
// imports — unit-tested in tests/admin-entrants.test.ts.
//
// Groups ENTRIES (not people): one person may hold several entries in a
// competition, and each is paid for and survives independently.

import { expectedBuyInPence } from "@/lib/competition";
import type { EntryStatus } from "@/lib/lms";
import { normaliseUkPhone } from "@/lib/phone";

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

// ---------------------------------------------------------------------------
// Soft duplicate detection on entry creation
// ---------------------------------------------------------------------------

export type DuplicateCandidate = {
  /** Set when an existing person was chosen from the picker. */
  participantId: string | null;
  name: string;
  phone: string | null;
};

export type ExistingEntrant = {
  participantId: string;
  name: string;
  phone: string | null;
};

/**
 * Compare two phone numbers the way a human would: the same number written two
 * ways is the same number. Falls back to the raw text when a value will not
 * normalise, so an oddly-formatted number still matches an identical one rather
 * than matching nothing.
 */
function samePhone(a: string | null, b: string | null): boolean {
  const left = (a ?? "").trim();
  const right = (b ?? "").trim();
  if (left === "" || right === "") return false;
  return (normaliseUkPhone(left) ?? left) === (normaliseUkPhone(right) ?? right);
}

function sameName(a: string, b: string): boolean {
  const left = a.trim();
  const right = b.trim();
  if (left === "" || right === "") return false;
  return left.toLowerCase() === right.toLowerCase();
}

/**
 * The first entry in the ACTIVE competition that looks like the one being
 * created: the same person, the same name (case-insensitively), or the same
 * phone number.
 *
 * This is a NOTICE, never a block. Multiple entries are explicitly allowed —
 * "David Smith 1" and "David Smith 2" are two independent runs, each paid for
 * in full (docs/LMS-RULES.md). The only thing worth catching is the organiser
 * adding the same person twice by accident, which one extra confirmation
 * settles either way.
 *
 * Match order is deliberate: participant id first (the picker was used, so we
 * know), then name, then phone. Only the fact of a match is used, but the
 * matched row is returned so the message can name who.
 */
export function findDuplicateEntrant(
  candidate: DuplicateCandidate,
  existing: ExistingEntrant[]
): ExistingEntrant | null {
  return (
    existing.find(
      (e) =>
        (candidate.participantId !== null &&
          e.participantId === candidate.participantId) ||
        sameName(e.name, candidate.name) ||
        samePhone(e.phone, candidate.phone)
    ) ?? null
  );
}
