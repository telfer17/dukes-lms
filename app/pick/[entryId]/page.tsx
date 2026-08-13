import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import PickForm, { type PickOption } from "@/components/PickForm";
import { availableTeams } from "@/lib/lms";
import {
  currentRound,
  getCompetition,
  getEntry,
  getFixturesForMatchday,
  getPicksForEntry,
  getRounds,
  getTeams,
  isRoundOpen,
  pickHistoryTeamIds,
} from "@/lib/lms-db";

// Per-entry and time-sensitive — always render at request time.
export const dynamic = "force-dynamic";

// The uuid in the URL is the credential, same trust model as the World Cup
// predictor's /predict/[id]. Keep it out of search results.
export const metadata = {
  title: "My pick · Dukes — Last Man Standing",
  robots: { index: false, follow: false },
};

const deadlineFormat = new Intl.DateTimeFormat("en-GB", {
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
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const OUTCOME_LABEL: Record<string, string> = {
  survived: "through",
  eliminated: "out",
  pending: "awaiting result",
};

export default async function PickPage({
  params,
}: {
  params: Promise<{ entryId: string }>;
}) {
  const { entryId } = await params;

  const entry = await getEntry(entryId).catch(() => null);
  if (!entry) notFound();

  const competition = await getCompetition(entry.competition_id);
  const rounds = await getRounds(entry.competition_id);
  const teams = await getTeams();
  const picks = await getPicksForEntry(entryId);

  const roundById = new Map(rounds.map((r) => [r.id, r]));
  const roundNumberById = new Map(rounds.map((r) => [r.id, r.round_number]));
  const teamById = new Map(teams.map((t) => [t.id, t]));

  // This entry's own history only — this page never reads anyone else's picks.
  const history = [...picks].sort(
    (a, b) =>
      (roundNumberById.get(a.round_id) ?? 0) -
      (roundNumberById.get(b.round_id) ?? 0)
  );

  const round = currentRound(rounds);
  const open = round ? isRoundOpen(round) : false;
  const canPick = entry.status === "active" && round !== null && open;

  let options: PickOption[] = [];
  let fixturesMissing = false;
  const currentPick = round
    ? (picks.find((p) => p.round_id === round.id) ?? null)
    : null;

  if (round && entry.status === "active") {
    const fixtures = await getFixturesForMatchday(round.matchday);
    fixturesMissing = fixtures.length === 0;

    if (!fixturesMissing) {
      const priorHistory = pickHistoryTeamIds(
        picks.filter((p) => p.round_id !== round.id),
        roundNumberById
      );
      const availableIds = new Set(
        availableTeams(priorHistory, teams).map((t) => t.id)
      );

      options = fixtures
        .flatMap((f) => [
          {
            id: f.home_team_id,
            opponentId: f.away_team_id,
            homeAway: "H" as const,
            kickoff: f.kickoff,
          },
          {
            id: f.away_team_id,
            opponentId: f.home_team_id,
            homeAway: "A" as const,
            kickoff: f.kickoff,
          },
        ])
        .map((slot) => ({
          id: slot.id,
          name: teamById.get(slot.id)?.name ?? `Team ${slot.id}`,
          available: availableIds.has(slot.id),
          opponent: teamById.get(slot.opponentId)?.name ?? "—",
          homeAway: slot.homeAway,
          kickoff: kickoffFormat.format(new Date(slot.kickoff)),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
  }

  const eliminatedRound = entry.eliminated_round_id
    ? roundById.get(entry.eliminated_round_id)
    : null;

  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <div className="text-center">
        <Image
          src="/wellington.jpg"
          alt="Glasgow Wellington logo"
          width={72}
          height={72}
          priority
          className="mx-auto rounded-full"
        />
        <h1 className="mt-4 text-2xl font-bold tracking-tight">
          {entry.participant?.name}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {competition?.label ?? "Last Man Standing"}
        </p>
      </div>

      {/* ---- Status banner ---- */}
      {entry.status === "eliminated" && (
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-center">
          <p className="font-semibold text-red-800">You&apos;re out</p>
          <p className="mt-1 text-sm text-red-700">
            {eliminatedRound
              ? `Eliminated in round ${eliminatedRound.round_number}.`
              : "Eliminated."}{" "}
            Thanks for playing — watch the{" "}
            <Link href="/board" className="underline">
              board
            </Link>{" "}
            for the rest.
          </p>
        </div>
      )}

      {entry.status === "winner" && (
        <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-4 text-center">
          <p className="font-semibold text-amber-800">
            Last Man Standing — you won!
          </p>
        </div>
      )}

      {/* ---- Current round ---- */}
      {entry.status === "active" && (
        <section className="mt-6 rounded-md border border-gray-200 p-5">
          {!round ? (
            <p className="text-center text-sm text-gray-500">
              No rounds set up yet. Check back once the competition starts.
            </p>
          ) : fixturesMissing ? (
            <p className="text-center text-sm text-gray-500">
              Fixtures for matchday {round.matchday} aren&apos;t loaded yet.
            </p>
          ) : (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-semibold">
                  Round {round.round_number}
                  <span className="ml-2 text-sm font-normal text-gray-500">
                    matchday {round.matchday}
                  </span>
                </h2>
                <span
                  className={`text-xs font-semibold uppercase tracking-wide ${
                    open ? "text-green-700" : "text-gray-400"
                  }`}
                >
                  {open ? "open" : "locked"}
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-500">
                {open ? "Picks lock" : "Locked"}{" "}
                {deadlineFormat.format(new Date(round.deadline))}
              </p>

              {canPick ? (
                <PickForm
                  entryId={entry.id}
                  roundId={round.id}
                  options={options}
                  currentTeamId={currentPick?.team_id ?? null}
                />
              ) : (
                <p className="mt-4 rounded-md bg-gray-50 p-4 text-center text-sm">
                  {currentPick ? (
                    <>
                      Your pick is locked in:{" "}
                      <strong>
                        {teamById.get(currentPick.team_id)?.name ?? "—"}
                      </strong>
                      {currentPick.auto_assigned && " (auto-assigned)"}
                    </>
                  ) : (
                    "The deadline passed without a pick — one will be assigned for you."
                  )}
                </p>
              )}
            </>
          )}
        </section>
      )}

      {/* ---- History ---- */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          Your picks
        </h2>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No picks yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-gray-200 rounded-md border border-gray-200">
            {history.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 p-3 text-sm"
              >
                <span className="text-gray-500">
                  Round {roundNumberById.get(p.round_id) ?? "?"}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">
                  {teamById.get(p.team_id)?.name ?? "—"}
                  {p.auto_assigned && (
                    <span className="ml-2 text-xs font-normal text-gray-500">
                      auto
                    </span>
                  )}
                </span>
                <span
                  className={
                    p.outcome === "eliminated"
                      ? "text-red-600"
                      : p.outcome === "survived"
                        ? "text-green-700"
                        : "text-gray-400"
                  }
                >
                  {OUTCOME_LABEL[p.outcome]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-8 text-center text-xs text-gray-400">
        This link is personal to your entry — don&apos;t share it.
      </p>
    </main>
  );
}
