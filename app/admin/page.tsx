import Link from "next/link";

export default function AdminDashboard() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-2xl font-bold tracking-tight">Admin dashboard</h1>
      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <Link
          href="/admin/competition"
          className="rounded-md border border-gray-200 p-5 hover:border-blue-400 hover:bg-blue-50"
        >
          <h2 className="font-semibold">Competition &amp; rounds</h2>
          <p className="mt-2 text-sm text-gray-600">
            Start a competition, carry a pot over, and generate rounds from the
            fixture list.
          </p>
        </Link>
        <Link
          href="/admin/entrants"
          className="rounded-md border border-gray-200 p-5 hover:border-blue-400 hover:bg-blue-50"
        >
          <h2 className="font-semibold">Entrants & payments</h2>
          <p className="mt-2 text-sm text-gray-600">
            Add entries, track who has paid, and hand out pick links.
          </p>
        </Link>
        <Link
          href="/admin/picks"
          className="rounded-md border border-gray-200 p-5 hover:border-blue-400 hover:bg-blue-50"
        >
          <h2 className="font-semibold">Enter picks</h2>
          <p className="mt-2 text-sm text-gray-600">
            Put in a pick for anyone who phones or texts theirs in, and see who
            hasn&apos;t picked yet.
          </p>
        </Link>
        <Link
          href="/admin/results"
          className="rounded-md border border-gray-200 p-5 hover:border-blue-400 hover:bg-blue-50"
        >
          <h2 className="font-semibold">Results &amp; settling</h2>
          <p className="mt-2 text-sm text-gray-600">
            Enter this matchday&apos;s results, then settle the round.
          </p>
        </Link>
        <Link
          href="/board"
          className="rounded-md border border-gray-200 p-5 hover:border-blue-400 hover:bg-blue-50"
        >
          <h2 className="font-semibold">Public board</h2>
          <p className="mt-2 text-sm text-gray-600">
            What everyone else sees — who&apos;s still standing.
          </p>
        </Link>
      </div>
    </main>
  );
}
