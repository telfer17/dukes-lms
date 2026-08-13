import Link from "next/link";

export default function AdminDashboard() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-2xl font-bold tracking-tight">Admin dashboard</h1>
      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <Link
          href="/admin/entrants"
          className="rounded-md border border-gray-200 p-5 hover:border-blue-400 hover:bg-blue-50"
        >
          <h2 className="font-semibold">Entrants & payments</h2>
          <p className="mt-2 text-sm text-gray-600">
            Manage entries, track who has paid, and remove duplicates.
          </p>
        </Link>
        <Link
          href="/admin/results"
          className="rounded-md border border-gray-200 p-5 hover:border-blue-400 hover:bg-blue-50"
        >
          <h2 className="font-semibold">Results</h2>
          <p className="mt-2 text-sm text-gray-600">
            Enter match results as they finish.
          </p>
        </Link>
      </div>
    </main>
  );
}
