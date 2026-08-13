import Link from "next/link";
import { groupEntrants, type ParticipantRecord } from "@/lib/admin-entrants";
import { supabaseServer } from "@/lib/supabase-server";
import EntrantRow from "@/components/admin/EntrantRow";
import MarkAllPaidButton from "@/components/admin/MarkAllPaidButton";

export const dynamic = "force-dynamic";

// The Last Man Standing schema isn't built yet, so `participants` may not
// exist. Degrade to an empty list rather than crashing the admin panel.
async function loadParticipants(): Promise<{
  participants: ParticipantRecord[];
  unavailable: boolean;
}> {
  try {
    const { data, error } = await supabaseServer
      .from("participants")
      .select("id, name, phone, paid, club_contact")
      .returns<ParticipantRecord[]>();
    if (error) throw new Error(error.message);
    return { participants: data ?? [], unavailable: false };
  } catch (e) {
    console.error("participants lookup failed:", e);
    return { participants: [], unavailable: true };
  }
}

export default async function EntrantsPage() {
  const { participants, unavailable } = await loadParticipants();
  const { groups, totals } = groupEntrants(participants);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <Link href="/admin" className="text-sm text-blue-600 hover:underline">
        ← Back to dashboard
      </Link>
      <div className="mt-2 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">
          Entrants & payments
        </h1>
        <Link
          href="/admin/entrants/new"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Add paper entrant
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Entrants", value: String(totals.entrants) },
          { label: "Paid", value: String(totals.paid) },
          { label: "Unpaid", value: String(totals.unpaid) },
          { label: "Collected", value: `£${totals.collectedPounds}` },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-md border border-gray-200 p-3 text-center"
          >
            <div className="text-2xl font-bold tabular-nums">{stat.value}</div>
            <div className="text-xs uppercase tracking-wide text-gray-500">
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <a
          href="/api/admin/export/entrants"
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
        >
          Export entrants (CSV)
        </a>
      </div>

      {groups.length === 0 ? (
        <p className="mt-8 rounded-md border border-gray-200 p-6 text-center text-gray-500">
          {unavailable
            ? "No entrants table yet — this page will fill in once the Last Man Standing schema is set up."
            : "No entrants yet."}
        </p>
      ) : (
        groups.map((group) => (
          <section
            key={group.clubContact}
            className="mt-6 rounded-md border border-gray-200"
          >
            <header className="flex items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 p-3">
              <div>
                <h2 className="font-semibold">{group.clubContact}</h2>
                <p className="text-xs text-gray-500">
                  {group.paidCount}/{group.total} paid
                </p>
              </div>
              <MarkAllPaidButton clubContact={group.clubContact} />
            </header>
            <div className="divide-y divide-gray-200">
              {group.entrants.map((entrant) => (
                <EntrantRow
                  key={entrant.id}
                  id={entrant.id}
                  name={entrant.name}
                  phone={entrant.phone}
                  paid={entrant.paid}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </main>
  );
}
