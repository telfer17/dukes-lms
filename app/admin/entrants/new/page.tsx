import Link from "next/link";
import NewEntryForm from "@/components/admin/NewEntryForm";
import { expectedBuyInPence, formatPence } from "@/lib/competition";
import { getActiveCompetition, getEntries } from "@/lib/lms-db";

export const dynamic = "force-dynamic";

export default async function NewEntryPage() {
  const competition = await getActiveCompetition().catch(() => null);

  if (!competition) {
    return (
      <main className="mx-auto max-w-md px-4 py-8">
        <Link
          href="/admin/entrants"
          className="text-sm text-blue-600 hover:underline"
        >
          ← Back to entrants
        </Link>
        <p className="mt-8 rounded-md border border-gray-200 p-6 text-center text-gray-500">
          No active competition — create one first.
        </p>
      </main>
    );
  }

  // Existing people, so a second entry for the same person reuses their record
  // rather than duplicating them.
  const entries = await getEntries(competition.id).catch(() => []);
  const people = [
    ...new Map(
      entries
        .filter((e) => e.participant)
        .map((e) => [
          e.participant.id,
          {
            id: e.participant.id,
            name: e.participant.name,
            club_contact: e.participant.club_contact,
          },
        ])
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <Link
        href="/admin/entrants"
        className="text-sm text-blue-600 hover:underline"
      >
        ← Back to entrants
      </Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">Add entry</h1>
      <p className="mt-1 text-sm text-gray-500">
        {competition.label} · returning{" "}
        {formatPence(expectedBuyInPence(competition.rollover_count, false))},
        newcomer{" "}
        {formatPence(expectedBuyInPence(competition.rollover_count, true))}
      </p>

      <NewEntryForm
        people={people}
        returningPence={expectedBuyInPence(competition.rollover_count, false)}
        newcomerPence={expectedBuyInPence(competition.rollover_count, true)}
      />
    </main>
  );
}
