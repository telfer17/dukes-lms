// Pure entrant-grouping logic for the admin entrants page. No DB or
// framework imports — unit-tested in tests/admin-entrants.test.ts.

export const ENTRY_FEE_POUNDS = 10;

export type ParticipantRecord = {
  id: string;
  name: string;
  phone: string | null;
  paid: boolean;
  club_contact: string | null;
};

export type Entrant = {
  id: string;
  name: string;
  phone: string | null;
  paid: boolean;
  predicted: number;
};

export type EntrantGroup = {
  clubContact: string;
  entrants: Entrant[];
  paidCount: number;
  total: number;
};

export type EntrantTotals = {
  entrants: number;
  paid: number;
  unpaid: number;
  collectedPounds: number;
};

export function groupEntrants(
  participants: ParticipantRecord[],
  predictionCountByParticipantId: Record<string, number>
): { groups: EntrantGroup[]; totals: EntrantTotals } {
  const byContact = new Map<string, Entrant[]>();
  for (const p of participants) {
    const contact = p.club_contact ?? "";
    const list = byContact.get(contact) ?? [];
    list.push({
      id: p.id,
      name: p.name,
      phone: p.phone,
      paid: p.paid,
      predicted: predictionCountByParticipantId[p.id] ?? 0,
    });
    byContact.set(contact, list);
  }

  const groups = [...byContact.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([clubContact, entrants]) => ({
      clubContact,
      entrants: [...entrants].sort((a, b) => a.name.localeCompare(b.name)),
      paidCount: entrants.filter((e) => e.paid).length,
      total: entrants.length,
    }));

  const paid = participants.filter((p) => p.paid).length;
  const totals: EntrantTotals = {
    entrants: participants.length,
    paid,
    unpaid: participants.length - paid,
    collectedPounds: paid * ENTRY_FEE_POUNDS,
  };

  return { groups, totals };
}
