import Link from "next/link";
import ActionForm from "@/components/admin/ActionForm";
import { formatPence } from "@/lib/competition";
import {
  currentRound,
  getActiveCompetition,
  getLoadedMatchdays,
  getRounds,
  type CompetitionRow,
  type RoundRow,
} from "@/lib/lms-db";
import {
  createCompetition,
  deleteRounds,
  generateRounds,
} from "./actions";

export const dynamic = "force-dynamic";

const deadlineFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const input =
  "mt-1 w-full rounded-md border border-gray-300 p-2 text-sm";

export default async function CompetitionAdminPage() {
  let competition: CompetitionRow | null = null;
  let rounds: RoundRow[] = [];
  let loadedMatchdays: number[] = [];
  let loadError: string | null = null;

  try {
    competition = await getActiveCompetition();
    loadedMatchdays = await getLoadedMatchdays();
    if (competition) rounds = await getRounds(competition.id);
  } catch (e) {
    console.error("competition admin load failed:", e);
    loadError = "Could not read the competition tables.";
  }

  const current = currentRound(rounds);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/admin" className="text-sm text-blue-600 hover:underline">
        ← Back to dashboard
      </Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">Competition</h1>

      {loadError && (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {loadError}
        </p>
      )}

      {/* ---------------- Active competition ---------------- */}
      {competition ? (
        <section className="mt-6 rounded-md border border-gray-200">
          <header className="border-b border-gray-200 bg-gray-50 p-4">
            <h2 className="font-semibold">{competition.label}</h2>
            <p className="text-xs uppercase tracking-wide text-gray-500">
              {competition.status}
            </p>
          </header>
          <dl className="grid grid-cols-2 gap-4 p-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wide text-gray-500">
                Rollovers before this
              </dt>
              <dd className="mt-1 text-lg font-bold tabular-nums">
                {competition.rollover_count}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-gray-500">
                Pot carried in
              </dt>
              <dd className="mt-1 text-lg font-bold tabular-nums">
                {formatPence(competition.pot_carried_in_pence)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-gray-500">
                Current round
              </dt>
              <dd className="mt-1 text-lg font-bold tabular-nums">
                {current ? `${current.round_number} (MD ${current.matchday})` : "—"}
              </dd>
            </div>
          </dl>
        </section>
      ) : (
        <section className="mt-6 rounded-md border border-gray-200 p-5">
          <h2 className="font-semibold">Start a competition</h2>
          <p className="mt-1 mb-4 text-sm text-gray-600">
            Only one competition runs at a time. After a rollover, set the
            rollover count and carry the pot in — those drive the newcomer
            buy-in ladder.
          </p>
          <ActionForm
            action={createCompetition}
            submitLabel="Create competition"
            pendingLabel="Creating…"
          >
            <div>
              <label htmlFor="label" className="block text-sm font-medium">
                Label
              </label>
              <input
                id="label"
                name="label"
                required
                placeholder="Competition 1"
                className={input}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="rollover_count"
                  className="block text-sm font-medium"
                >
                  Prior rollovers
                </label>
                <input
                  id="rollover_count"
                  name="rollover_count"
                  type="number"
                  min={0}
                  defaultValue={0}
                  className={input}
                />
              </div>
              <div>
                <label
                  htmlFor="pot_carried_in_pounds"
                  className="block text-sm font-medium"
                >
                  Pot carried in (£)
                </label>
                <input
                  id="pot_carried_in_pounds"
                  name="pot_carried_in_pounds"
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={0}
                  className={input}
                />
              </div>
            </div>
          </ActionForm>
        </section>
      )}

      {/* ---------------- Rounds ---------------- */}
      {competition && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Rounds</h2>

          {loadedMatchdays.length === 0 ? (
            <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              No fixtures loaded yet, so rounds can&apos;t be generated — a
              round&apos;s deadline is its matchday&apos;s first kickoff.
              Fixtures arrive in Phase 6.
            </p>
          ) : rounds.length === 0 ? (
            <div className="mt-3 rounded-md border border-gray-200 p-5">
              <p className="mb-4 text-sm text-gray-600">
                Fixtures are loaded for matchdays {loadedMatchdays[0]}–
                {loadedMatchdays[loadedMatchdays.length - 1]}. Round 1 maps to
                the starting matchday you choose; one round follows per matchday
                after it.
              </p>
              <ActionForm
                action={generateRounds}
                submitLabel="Generate rounds"
                pendingLabel="Generating…"
              >
                <div className="max-w-xs">
                  <label
                    htmlFor="start_matchday"
                    className="block text-sm font-medium"
                  >
                    Starting PL matchday
                  </label>
                  <input
                    id="start_matchday"
                    name="start_matchday"
                    type="number"
                    min={1}
                    max={38}
                    defaultValue={loadedMatchdays[0]}
                    className={input}
                  />
                </div>
              </ActionForm>
            </div>
          ) : (
            <>
              <div className="mt-3 overflow-hidden rounded-md border border-gray-200">
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-300 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="py-2 pl-3 font-semibold">Round</th>
                      <th className="py-2 font-semibold">Matchday</th>
                      <th className="py-2 font-semibold">Deadline</th>
                      <th className="py-2 pr-3 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rounds.map((round) => (
                      <tr
                        key={round.id}
                        className={`border-b border-gray-200 last:border-0 ${
                          round.id === current?.id ? "bg-blue-50 font-medium" : ""
                        }`}
                      >
                        <td className="py-2 pl-3 tabular-nums">
                          {round.round_number}
                        </td>
                        <td className="py-2 tabular-nums">{round.matchday}</td>
                        <td className="py-2 tabular-nums">
                          {deadlineFormat.format(new Date(round.deadline))}
                        </td>
                        <td className="py-2 pr-3">{round.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4">
                <ActionForm
                  action={deleteRounds}
                  submitLabel="Clear all rounds"
                  pendingLabel="Clearing…"
                  destructive
                  confirm="Delete every round for this competition?"
                />
              </div>
            </>
          )}
        </section>
      )}
    </main>
  );
}
