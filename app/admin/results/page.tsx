import Link from "next/link";
import ActionForm from "@/components/admin/ActionForm";
import FixtureRow from "@/components/admin/FixtureRow";
import {
  eliminatedRoundNumber,
  planBuybacks,
  planRounds,
} from "@/lib/buyback";
import {
  currentRound,
  getActiveCompetition,
  getBuybacks,
  getEntries,
  getFixturesForMatchday,
  getPicksForRound,
  getRounds,
  getTeams,
  isRoundOpen,
  settledRoundNumber,
  type CompetitionRow,
  type FixtureRow as FixtureRecord,
  type PickRow,
  type RoundRow,
} from "@/lib/lms-db";
import type { Team } from "@/lib/lms";
import {
  buildFinalisationPlan,
  type FinalisationOutcome,
} from "@/lib/settlement-plan";
import { finaliseCompetition, settleCurrentRound } from "./actions";

export const dynamic = "force-dynamic";

const windowFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

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
  // What the COMPETITION is doing, buy-back included: still running, waiting on
  // a buy-back window, or ready to be closed off. Null until it is worked out.
  let finalisation: FinalisationOutcome | null = null;
  let pendingNames: string[] = [];

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

      const buybacks = await getBuybacks(competition.id);
      finalisation = buildFinalisationPlan({
        competitionId: competition.id,
        entries: entries.map((e) => ({
          id: e.id,
          participant_id: e.participant_id,
          status: e.status,
          label: e.participant?.name ?? e.id,
          eliminated_round_number: eliminatedRoundNumber(e, rounds),
        })),
        allRounds: planRounds(rounds),
        buybacks: planBuybacks(buybacks, rounds),
        settledRoundNumber: settledRoundNumber(rounds),
      });

      // Who the competition is waiting on, by name. A count alone ("2 entries
      // can still buy back") is not something an organiser can act on; two
      // names are people they can ring.
      const openIds =
        !finalisation.ok && finalisation.reason === "window_open"
          ? finalisation.state.kind === "pending_rollover" ||
            finalisation.state.kind === "pending_win"
            ? finalisation.state.open_entry_ids
            : []
          : [];
      pendingNames = openIds
        .map(
          (id) =>
            entries.find((e) => e.id === id)?.participant?.name ?? "an entry"
        )
        .sort((a, b) => a.localeCompare(b, "en"));
    }
  } catch (e) {
    console.error("results load failed:", e);
    loadError = "Could not read results.";
  }

  // Bail rather than render the settle button beside zeroed stats: "0 still
  // in" next to a destructive action is the worst possible failure mode.
  if (competition && loadError) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <Link href="/admin" className="text-sm text-blue-600 hover:underline">
          ← Back to dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">
          Results &amp; settling
        </h1>
        <p
          role="alert"
          className="mt-8 rounded-md border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700"
        >
          {loadError} Nothing is shown rather than risk settling against
          incomplete data — reload to try again.
        </p>
      </main>
    );
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

      {competition && finalisation && !finalisation.ok &&
        finalisation.reason === "window_open" && (
          <section className="mt-6 rounded-md border border-amber-300 bg-amber-50 p-5">
            <h2 className="font-semibold text-amber-900">
              {finalisation.state.kind === "pending_rollover"
                ? "Everyone is out — but this competition has NOT rolled over"
                : "Last entry standing — but not the winner yet"}
            </h2>
            <p className="mt-2 text-sm text-amber-900">
              {finalisation.state.kind === "pending_rollover" ? (
                <>
                  The round is settled and nobody survived it. Per the rules the
                  pot does <strong>not</strong> roll over until the buy-back
                  window closes with nobody coming back.
                </>
              ) : (
                <>
                  The round is settled and one entry is left, but an eliminated
                  entry can still pay to come back — so nobody is crowned yet.
                </>
              )}{" "}
              The window shuts at the next round&apos;s deadline,{" "}
              <strong>{windowFormat.format(new Date(finalisation.closesAt))}</strong>.
            </p>
            <p className="mt-2 text-sm text-amber-900">
              {pendingNames.length > 0 ? (
                <>
                  Can still buy back in for £10:{" "}
                  <strong>{pendingNames.join(", ")}</strong>. Take the money and
                  record it on{" "}
                  <Link
                    href="/admin/entrants"
                    className="font-semibold underline"
                  >
                    Entrants
                  </Link>{" "}
                  before the deadline.
                </>
              ) : (
                <>Nobody is eligible to buy back.</>
              )}
            </p>
            <p className="mt-2 text-sm text-amber-900">
              Come back here after the deadline to finish it off — nothing is
              decided until then, and nothing needs doing before it.
            </p>
          </section>
        )}

      {competition && finalisation?.ok && (
        <section className="mt-6 rounded-md border border-blue-300 bg-blue-50 p-5">
          <h2 className="font-semibold text-blue-900">
            {finalisation.state.kind === "rollover"
              ? "Ready to roll over"
              : "Ready to crown the winner"}
          </h2>
          <p className="mt-2 mb-4 text-sm text-blue-900">
            {finalisation.state.kind === "rollover" ? (
              <>
                Everyone is out and the buy-back window has closed with nobody
                coming back. Confirming rolls this competition over — the pot
                carries into the next one.
              </>
            ) : (
              <>
                One entry is left, the round is settled and every buy-back window
                has closed. Confirming ends the competition and pays the pot.
              </>
            )}
          </p>
          <ActionForm
            action={finaliseCompetition}
            submitLabel={
              finalisation.state.kind === "rollover"
                ? "Confirm rollover"
                : "Crown the winner"
            }
            pendingLabel="Finishing…"
            confirm={
              finalisation.state.kind === "rollover"
                ? "Roll this competition over? This ends it — the pot carries into the next one."
                : "End the competition and crown the winner? This cannot be undone here."
            }
          />
        </section>
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
