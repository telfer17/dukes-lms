import Link from "next/link";
import { resultsEnteredCount } from "@/lib/admin-results";
import { supabaseServer } from "@/lib/supabase-server";
import ResultRow from "@/components/admin/ResultRow";

export const dynamic = "force-dynamic";

type Match = {
  id: number;
  grp: string;
  home: string;
  away: string;
  kickoff: string;
  home_score: number | null;
  away_score: number | null;
};

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "long",
  day: "numeric",
  month: "long",
});

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export default async function ResultsPage() {
  const { data, error } = await supabaseServer
    .from("matches")
    .select("id, grp, home, away, kickoff, home_score, away_score")
    .returns<Match[]>();
  if (error) throw new Error(error.message);

  const matches = (data ?? []).sort(
    (a, b) =>
      new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime() ||
      a.id - b.id
  );

  // Group under date headers; insertion order is chronological.
  const byDate = new Map<string, Match[]>();
  for (const match of matches) {
    const date = dateFormatter.format(new Date(match.kickoff));
    const list = byDate.get(date) ?? [];
    list.push(match);
    byDate.set(date, list);
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/admin" className="text-sm text-blue-600 hover:underline">
        ← Back to dashboard
      </Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">Results</h1>
      <p className="mt-1 text-sm text-gray-500">
        {resultsEnteredCount(matches)}/{matches.length} results in
      </p>

      {[...byDate.entries()].map(([date, dayMatches]) => (
        <section key={date} className="mt-8">
          <h2 className="mb-2 text-lg font-semibold">{date}</h2>
          <div className="divide-y divide-gray-200 rounded-md border border-gray-200">
            {dayMatches.map((match) => (
              <ResultRow
                key={match.id}
                matchId={match.id}
                grp={match.grp}
                home={match.home}
                away={match.away}
                time={timeFormatter.format(new Date(match.kickoff))}
                initialHome={match.home_score === null ? "" : String(match.home_score)}
                initialAway={match.away_score === null ? "" : String(match.away_score)}
              />
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
