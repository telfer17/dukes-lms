import Link from "next/link";
import PickForEntryRow from "@/components/admin/PickForEntryRow";
import {
  currentRound,
  getActiveCompetition,
  getEntries,
  getFixturesForMatchday,
  getPicksForCompetition,
  getPicksForRound,
  getRounds,
  getTeams,
  isRoundOpen,
  pickHistoryTeamIds,
  type CompetitionRow,
  type RoundRow,
} from "@/lib/lms-db";
import { selectableTeams } from "@/lib/pick-rules";

// Reads live state and writes through server actions — never cached.
export const dynamic = "force-dynamic";

// Admin-gated by proxy.ts (matcher /admin/:path*), and every read below uses
// the secret key. Nothing here is exposed publicly: /grid shows the same picks
// but this page also shows who has NOT picked, which is organiser business.

const deadlineFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export default async function AdminPicksPage() {
  let competition: CompetitionRow | null = null;
  let round: RoundRow | null = null;
  let rows: {
    entryId: string;
    name: string;
    currentTeamId: number | null;
    currentTeamName: string | null;
    autoAssigned: boolean;
    options: { id: number; name: string }[];
  }[] = [];
  let fixturesMissing = false;
  let loadError: string | null = null;

  try {
    competition = await getActiveCompetition();
    if (competition) {
      const rounds = await getRounds(competition.id);
      round = currentRound(rounds);

      if (round) {
        const [entries, allPicks, roundPicks, teams, fixtures] =
          await Promise.all([
            getEntries(competition.id),
            getPicksForCompetition(competition.id),
            getPicksForRound(round.id),
            getTeams(),
            getFixturesForMatchday(round.matchday),
          ]);

        fixturesMissing = fixtures.length === 0;

        const roundNumberById = new Map(rounds.map((r) => [r.id, r.round_number]));
        const teamNameById = new Map(teams.map((t) => [t.id, t.name]));
        const pickThisRound = new Map(roundPicks.map((p) => [p.entry_id, p]));

        // Every entry's history in one pass, so the per-entry team lists don't
        // each re-query. Only ACTIVE entries can be given a pick.
        const historyByEntry = new Map<string, typeof allPicks>();
        for (const pick of allPicks) {
          const list = historyByEntry.get(pick.entry_id) ?? [];
          list.push(pick);
          historyByEntry.set(pick.entry_id, list);
        }

        rows = entries
          .filter((e) => e.status === "active")
          .map((entry) => {
            const current = pickThisRound.get(entry.id) ?? null;
            const history = pickHistoryTeamIds(
              (historyByEntry.get(entry.id) ?? []).filter(
                (p) => p.round_id !== round!.id
              ),
              roundNumberById
            );
            return {
              entryId: entry.id,
              name: entry.participant?.name ?? "—",
              currentTeamId: current?.team_id ?? null,
              currentTeamName: current
                ? (teamNameById.get(current.team_id) ?? null)
                : null,
              autoAssigned: current?.auto_assigned ?? false,
              // The options offered are exactly what validatePick will accept
              // for THIS entry — same helper, same engine.
              options: selectableTeams({
                fixtures,
                matchday: round!.matchday,
                teams,
                history,
              }).map((t) => ({ id: t.id, name: t.name })),
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name, "en"));
      }
    }
  } catch (e) {
    console.error("admin picks load failed:", e);
    loadError = "Could not read picks.";
  }

  // By id, not name: currentTeamName is also null when a team id fails to
  // resolve to a name, which would report someone who HAS picked as one of the
  // people still to chase.
  const withoutPick = rows.filter((r) => r.currentTeamId === null).length;
  const open = round ? isRoundOpen(round) : false;
  const deadlinePassed = round ? !open && round.status !== "settled" : false;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/admin" className="text-sm text-blue-600 hover:underline">
        ← Back to dashboard
      </Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">Enter picks</h1>
      <p className="mt-1 text-sm text-gray-500">
        For entrants who phone or text theirs in.
      </p>

      {loadError && (
        <p
          role="alert"
          className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {loadError} Nothing is shown rather than risk entering a pick against
          incomplete data — reload to try again.
        </p>
      )}

      {!loadError && !competition && (
        <p className="mt-8 rounded-md border border-gray-200 p-6 text-center text-gray-500">
          No active competition.{" "}
          <Link href="/admin/competition" className="text-blue-600 hover:underline">
            Create one →
          </Link>
        </p>
      )}

      {!loadError && competition && !round && (
        <p className="mt-8 rounded-md border border-gray-200 p-6 text-center text-gray-500">
          Every round is settled — nothing to enter.
        </p>
      )}

      {!loadError && competition && round && (
        <>
          <div className="mt-4 rounded-md border border-gray-200 p-4">
            <p className="font-semibold">
              Round {round.round_number}
              <span className="ml-2 text-sm font-normal text-gray-500">
                matchday {round.matchday}
              </span>
              <span
                className={`ml-2 text-xs font-semibold uppercase tracking-wide ${
                  open ? "text-green-700" : "text-amber-700"
                }`}
              >
                {open ? "open" : "locked"}
              </span>
            </p>
            <p className="mt-1 text-sm text-gray-600">
              {open ? "Picks lock" : "Deadline was"}{" "}
              {deadlineFormat.format(new Date(round.deadline))}
            </p>
          </div>

          {deadlinePassed && (
            <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              <strong>The deadline has passed.</strong> You can still enter a
              pick for someone who got theirs to you in time — each save asks you
              to confirm. Once the round is settled, picks are final.
            </p>
          )}

          {fixturesMissing ? (
            <p className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              No fixtures loaded for matchday {round.matchday} — picks can&apos;t
              be entered until they are.
            </p>
          ) : rows.length === 0 ? (
            <p className="mt-6 rounded-md border border-gray-200 p-6 text-center text-gray-500">
              No active entries.
            </p>
          ) : (
            <>
              <p className="mt-6 text-sm font-semibold">
                {withoutPick === 0 ? (
                  <span className="text-green-700">
                    All {rows.length} in — everyone has picked.
                  </span>
                ) : (
                  <span className="text-amber-700">
                    {withoutPick} of {rows.length} haven&apos;t picked
                  </span>
                )}
              </p>

              <ul className="mt-2 divide-y divide-gray-200 rounded-md border border-gray-200">
                {rows.map((row) => (
                  <PickForEntryRow
                    key={row.entryId}
                    entryId={row.entryId}
                    roundId={round.id}
                    name={row.name}
                    currentTeamId={row.currentTeamId}
                    currentTeamName={row.currentTeamName}
                    autoAssigned={row.autoAssigned}
                    options={row.options}
                    deadlinePassed={deadlinePassed}
                  />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </main>
  );
}
