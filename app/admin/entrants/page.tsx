import Link from "next/link";
import EntryRow from "@/components/admin/EntryRow";
import MarkAllPaidButton from "@/components/admin/MarkAllPaidButton";
import { groupEntries, type EntryRecord } from "@/lib/admin-entrants";
import {
  BASE_ENTRY_PENCE,
  clubPence,
  collectedPence,
  expectedBuyInPence,
  formatPence,
  potPence,
} from "@/lib/competition";
import {
  getActiveCompetition,
  getEntries,
  type CompetitionRow,
  type EntryWithParticipant,
} from "@/lib/lms-db";

export const dynamic = "force-dynamic";

export default async function EntrantsPage() {
  let competition: CompetitionRow | null = null;
  let entries: EntryWithParticipant[] = [];
  let loadError: string | null = null;

  try {
    competition = await getActiveCompetition();
    if (competition) entries = await getEntries(competition.id);
  } catch (e) {
    console.error("entrants load failed:", e);
    loadError = "Could not read entrants.";
  }

  // A failed entries load must never render as an empty competition — the
  // payment totals would read £0 collected, which is indistinguishable from
  // "nobody has paid" and is the one number an organiser acts on.
  if (competition && loadError) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8">
        <Link href="/admin" className="text-sm text-blue-600 hover:underline">
          ← Back to dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">
          Entrants &amp; payments
        </h1>
        <p className="text-sm text-gray-500">{competition.label}</p>
        <p
          role="alert"
          className="mt-8 rounded-md border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700"
        >
          {loadError} Totals are hidden rather than shown as zero — reload to
          try again.
        </p>
      </main>
    );
  }

  if (!competition) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8">
        <Link href="/admin" className="text-sm text-blue-600 hover:underline">
          ← Back to dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">
          Entrants &amp; payments
        </h1>
        <p className="mt-8 rounded-md border border-gray-200 p-6 text-center text-gray-500">
          {loadError ?? (
            <>
              No active competition yet.{" "}
              <Link
                href="/admin/competition"
                className="text-blue-600 hover:underline"
              >
                Create one first →
              </Link>
            </>
          )}
        </p>
      </main>
    );
  }

  const records: EntryRecord[] = entries.map((e) => ({
    id: e.id,
    name: e.participant?.name ?? "(unknown)",
    phone: e.participant?.phone ?? null,
    club_contact: e.participant?.club_contact ?? null,
    paid: e.paid,
    amount_paid_pence: e.amount_paid_pence,
    is_newcomer: e.is_newcomer,
    status: e.status,
  }));

  const { groups, totals } = groupEntries(records, competition.rollover_count);
  const money = entries.map((e) => ({
    paid: e.paid,
    amount_paid_pence: e.amount_paid_pence,
  }));

  const stats = [
    { label: "Entries", value: String(totals.entries) },
    { label: "Paid", value: String(totals.paid) },
    { label: "Unpaid", value: String(totals.unpaid) },
    { label: "Collected", value: formatPence(collectedPence(money)) },
    {
      label: "Pot",
      value: formatPence(potPence(competition.pot_carried_in_pence, money)),
    },
    { label: "Club", value: formatPence(clubPence(money)) },
  ];

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <Link href="/admin" className="text-sm text-blue-600 hover:underline">
        ← Back to dashboard
      </Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Entrants &amp; payments
          </h1>
          <p className="text-sm text-gray-500">{competition.label}</p>
        </div>
        <Link
          href="/admin/entrants/new"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Add entry
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-md border border-gray-200 p-3 text-center"
          >
            <div className="text-lg font-bold tabular-nums">{stat.value}</div>
            <div className="text-[10px] uppercase tracking-wide text-gray-500">
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3 text-xs text-gray-500">
        Buy-in for this competition: {formatPence(expectedBuyInPence(competition.rollover_count, false))} returning,{" "}
        {formatPence(expectedBuyInPence(competition.rollover_count, true))} newcomer
        {competition.rollover_count > 0 &&
          ` (${formatPence(BASE_ENTRY_PENCE)} × ${competition.rollover_count + 1})`}
        . Pot includes {formatPence(competition.pot_carried_in_pence)} carried in.
      </p>

      <div className="mt-4">
        <a
          href="/api/admin/export/entries"
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
        >
          Export entries (CSV)
        </a>
      </div>

      {groups.length === 0 ? (
        <p className="mt-8 rounded-md border border-gray-200 p-6 text-center text-gray-500">
          No entries yet.
        </p>
      ) : (
        groups.map((group) => (
          <section
            key={group.clubContact}
            className="mt-6 rounded-md border border-gray-200"
          >
            <header className="flex items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 p-3">
              <div>
                <h2 className="font-semibold">
                  {group.clubContact || "(no club contact)"}
                </h2>
                <p className="text-xs text-gray-500">
                  {group.paidCount}/{group.total} paid
                </p>
              </div>
              <MarkAllPaidButton clubContact={group.clubContact} />
            </header>
            <div className="divide-y divide-gray-200">
              {group.entries.map((entry) => (
                <EntryRow
                  key={entry.id}
                  id={entry.id}
                  name={entry.name}
                  paid={entry.paid}
                  amountPaidPence={entry.amount_paid_pence}
                  expectedPence={entry.expected_pence}
                  amountMismatch={entry.amount_mismatch}
                  isNewcomer={entry.is_newcomer}
                  status={entry.status}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </main>
  );
}
