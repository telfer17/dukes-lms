import Link from "next/link";
import ActionForm from "@/components/admin/ActionForm";
import FixtureRow from "@/components/admin/FixtureRow";
import {
  currentRound,
  getActiveCompetition,
  getEntries,
  getFixturesForMatchday,
  getPicksForRound,
  getRounds,
  getTeams,
  isRoundOpen,
  type CompetitionRow,
  type FixtureRow as FixtureRecord,
  type PickRow,
  type RoundRow,
} from "@/lib/lms-db";
import type { Team } from "@/lib/lms";
import { settleCurrentRound } from "./actions";

export const dynamic = "force-dynamic";

const kickoffFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export default async function ResultsPage() {
  let competition: CompetitionRow | null = null;
  let rounds: RoundRow[] = [];
  let round: RoundRow | null = null;
  let fixtures: FixtureRecord[] = [];
  let teams: Team[] = [];
  let picks: PickRow[] = [];
  let activeCount = 0;
  let loadError: string | null = null;

  try {
    competition = await getActiveCompetition();
    if (competition) {
      rounds = await getRounds(competition.id);
      round = currentRound(rounds);
      teams = await getTeams();
      const entries = await getEntries(competition.id);
      activeCount = entries.filter((e) => e.status === "active").length;
      if (round) {
        fixtures = await getFixturesForMatchday(round.matchday);
        picks = await getPicksForRound(round.id);
      }
    }
  } catch (e) {
    console.error("results load failed:", e);
    loadError = "Could not read results.";
  }

  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const pickCountByTeam = new Map<number, number>();
  for (const p of picks) {
    pickCountByTeam.set(p.team_id, (pickCountByTeam.get(p.team_id) ?? 0) + 1);
  }

  const withoutPick = activeCount - picks.length;
  const stillOpen = round ? isRoundOpen(round) : false;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/admin" className="text-sm text-blue-600 hover:underline">
        ← Back to dashboard
      </Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">
        Results &amp; settling
      </h1>

      {loadError && (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {loadError}
        </p>
      )}

      {!competition ? (
        <p className="mt-8 rounded-md border border-gray-200 p-6 text-center text-gray-500">
          No active competition.{" "}
          <Link href="/admin/competition" className="text-blue-600 hover:underline">
            Create one →
          </Link>
        </p>
      ) : !round ? (
        <p className="mt-8 rounded-md border border-gray-200 p-6 text-center text-gray-500">
          {rounds.length === 0
            ? "No rounds generated yet."
            : "Every round is settled."}
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-gray-500">
            {competition.label} · round {round.round_number} · matchday{" "}
            {round.matchday}
          </p>

          <div className="mt-4 grid grid-cols-3 gap-3">
            {[
              { label: "Still in", value: String(activeCount) },
              { label: "Picked", value: String(picks.length) },
              { label: "No pick", value: String(Math.max(0, withoutPick)) },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-md border border-gray-200 p-3 text-center"
              >
                <div className="text-xl font-bold tabular-nums">
                  {stat.value}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-gray-500">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>

          {fixtures.length === 0 ? (
            <p className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              No fixtures loaded for matchday {round.matchday} yet — results
              can&apos;t be entered until they are (Phase 6).
            </p>
          ) : (
            <>
              <h2 className="mt-8 text-lg font-semibold">
                Matchday {round.matchday}
              </h2>
              <div className="mt-2 divide-y divide-gray-200 rounded-md border border-gray-200">
                {fixtures.map((f) => (
                  <FixtureRow
                    key={f.id}
                    fixtureId={f.id}
                    home={teamName.get(f.home_team_id) ?? `#${f.home_team_id}`}
                    away={teamName.get(f.away_team_id) ?? `#${f.away_team_id}`}
                    kickoff={kickoffFormat.format(new Date(f.kickoff))}
                    initialStatus={f.status}
                    initialResult={f.result}
                    pickedBy={
                      (pickCountByTeam.get(f.home_team_id) ?? 0) +
                      (pickCountByTeam.get(f.away_team_id) ?? 0)
                    }
                  />
                ))}
              </div>

              <section className="mt-8 rounded-md border border-gray-200 p-5">
                <h2 className="font-semibold">Settle round {round.round_number}</h2>
                <p className="mt-1 mb-4 text-sm text-gray-600">
                  Auto-assigns a team to anyone who missed the deadline, settles
                  every pick, then advances or ends the competition.
                  {stillOpen && (
                    <strong className="block text-amber-700">
                      Heads up: this round is still open for picks.
                    </strong>
                  )}
                  {withoutPick > 0 && (
                    <span className="block">
                      {withoutPick} active{" "}
                      {withoutPick === 1 ? "entry has" : "entries have"} no pick
                      and will be auto-assigned.
                    </span>
                  )}
                </p>
                <ActionForm
                  action={settleCurrentRound}
                  submitLabel="Settle round"
                  pendingLabel="Settling…"
                  confirm={`Settle round ${round.round_number}? This eliminates entries and can end the competition.`}
                />
              </section>
            </>
          )}
        </>
      )}
    </main>
  );
}
