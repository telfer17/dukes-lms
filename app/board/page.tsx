import Image from "next/image";
import Link from "next/link";
import BoardTabs from "@/components/BoardTabs";
import DeadlineCountdown from "@/components/DeadlineCountdown";
import { formatPence, potPence } from "@/lib/competition";
import {
  currentRound,
  getEntries,
  getPicksForRound,
  getTeams,
  isRoundOpen,
} from "@/lib/lms-db";
import {
  readPublicBoard,
  readPublicCompetition,
  readPublicRounds,
} from "@/lib/public-read";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Who's still standing · Dukes — Last Man Standing",
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

export default async function BoardPage() {
  // ---- public reads: publishable key only (lib/public-read.ts) ----
  const { data: competition, error: compError } = await readPublicCompetition();

  // A failed lookup is NOT "no competition". Saying "check back soon" to
  // someone whose competition is running, because the database was briefly
  // unreachable, is the same lie as an empty board — and it sends them to the
  // organiser asking why they've been dropped. Two reads, two answers.
  if (compError) {
    console.error("board: competition read failed:", compError);
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold tracking-tight">
          Dukes — Last Man Standing
        </h1>
        <p className="mt-3 text-gray-600">
          The board can&apos;t be loaded right now. Try again in a minute.
        </p>
      </main>
    );
  }

  if (!competition) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold tracking-tight">
          Dukes — Last Man Standing
        </h1>
        <p className="mt-3 text-gray-600">
          No competition running yet. Check back soon.
        </p>
      </main>
    );
  }

  const [boardRes, roundsRes] = await Promise.all([
    readPublicBoard(competition.id),
    readPublicRounds(competition.id),
  ]);

  // A failed read must not render as an empty competition — "0 of 53 still
  // standing" on a live board is worse than saying the board is down.
  if (boardRes.error || roundsRes.error) {
    console.error("board read failed:", boardRes.error ?? roundsRes.error);
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold tracking-tight">
          {competition.label}
        </h1>
        <p className="mt-3 text-gray-600">
          The board can&apos;t be loaded right now. Try again in a minute.
        </p>
      </main>
    );
  }

  const board = boardRes.data ?? [];
  const rounds = roundsRes.data ?? [];
  const round = currentRound(rounds);

  const active = board
    .filter((r) => r.status === "active" || r.status === "winner")
    .sort((a, b) => a.name.localeCompare(b.name));
  const out = board
    .filter((r) => r.status === "eliminated")
    .sort(
      (a, b) =>
        (b.eliminated_round_number ?? 0) - (a.eliminated_round_number ?? 0) ||
        a.name.localeCompare(b.name)
    );

  // ---- pot: computed SERVER-SIDE from private amounts, only the total ships ----
  let potLabel: string | null = null;
  try {
    const entries = await getEntries(competition.id);
    potLabel = formatPence(
      potPence(
        competition.pot_carried_in_pence,
        entries.map((e) => ({
          paid: e.paid,
          amount_paid_pence: e.amount_paid_pence,
        }))
      )
    );
  } catch (e) {
    console.error("pot computation failed:", e);
  }

  // ---- picks for a LOCKED round may be shown; never for an open one ----
  let lockedPicks: { name: string; team: string }[] = [];
  const revealRound =
    round && !isRoundOpen(round) && round.status !== "settled" ? round : null;
  if (revealRound) {
    try {
      const [picks, teams, entries] = await Promise.all([
        getPicksForRound(revealRound.id),
        getTeams(),
        getEntries(competition.id),
      ]);
      const teamName = new Map(teams.map((t) => [t.id, t.name]));
      const entryName = new Map(
        entries.map((e) => [e.id, e.participant?.name ?? "—"])
      );
      lockedPicks = picks
        .map((p) => ({
          name: entryName.get(p.entry_id) ?? "—",
          team: teamName.get(p.team_id) ?? "—",
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      console.error("locked picks read failed:", e);
    }
  }

  const winner = board.find((r) => r.status === "winner");

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="text-center">
        <Image
          src="/wellington.jpg"
          alt="Glasgow Wellington logo"
          width={72}
          height={72}
          priority
          className="mx-auto rounded-full"
        />
        <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
          {competition.label}
        </h1>
        <p className="mt-2 text-3xl font-bold tabular-nums sm:text-4xl">
          {active.length} of {board.length}
        </p>
        <p className="text-sm uppercase tracking-wide text-gray-500">
          still standing
        </p>
        {potLabel && (
          <p className="mt-3 inline-block rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-900">
            Prize pot {potLabel}
          </p>
        )}
      </div>

      {winner && (
        <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-5 text-center">
          <p className="text-xs font-bold uppercase tracking-wide text-amber-700">
            Last Man Standing
          </p>
          <p className="mt-1 text-2xl font-bold text-amber-900">{winner.name}</p>
        </div>
      )}

      {round && !winner && (
        <div className="mt-6 rounded-md border border-gray-200 p-4 text-center">
          <p className="font-semibold">
            Round {round.round_number}
            <span className="ml-2 text-sm font-normal text-gray-500">
              matchday {round.matchday}
            </span>
          </p>
          <p className="mt-1 text-sm text-gray-600">
            {isRoundOpen(round) ? (
              <>
                Picks lock in <DeadlineCountdown deadline={round.deadline} /> —{" "}
                {deadlineFormat.format(new Date(round.deadline))}
              </>
            ) : (
              <>Locked — {deadlineFormat.format(new Date(round.deadline))}</>
            )}
          </p>
        </div>
      )}

      {board.length === 0 ? (
        <p className="mt-8 rounded-md border border-gray-200 p-6 text-center text-gray-500">
          No entries yet.
        </p>
      ) : (
        <BoardTabs
          active={
            <ul className="divide-y divide-gray-200 rounded-md border border-gray-200">
              {/* Keyed by name+index, NOT the entry id: a React key is
                  serialised into the RSC payload, and entries.id is the pick
                  link. See lib/public-read.ts. */}
              {active.map((row, i) => (
                <li
                  key={`${row.name}-${i}`}
                  className="flex items-center justify-between gap-3 p-3 text-sm"
                >
                  <span className="min-w-0 truncate font-medium">{row.name}</span>
                  <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-green-700">
                    {row.status === "winner" ? "winner" : "in"}
                  </span>
                </li>
              ))}
            </ul>
          }
          out={
            out.length === 0 ? (
              <p className="rounded-md border border-gray-200 p-6 text-center text-gray-500">
                Nobody&apos;s out yet.
              </p>
            ) : (
              <ul className="divide-y divide-gray-200 rounded-md border border-gray-200">
                {out.map((row, i) => (
                  <li
                    key={`${row.name}-${i}`}
                    className="flex items-center justify-between gap-3 p-3 text-sm text-gray-500"
                  >
                    <span className="min-w-0 truncate">{row.name}</span>
                    <span className="shrink-0 text-xs">
                      {row.eliminated_round_number
                        ? `out round ${row.eliminated_round_number}`
                        : "out"}
                    </span>
                  </li>
                ))}
              </ul>
            )
          }
        />
      )}

      {lockedPicks.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            This round&apos;s picks
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            Revealed now the round is locked.
          </p>
          <ul className="mt-2 divide-y divide-gray-200 rounded-md border border-gray-200">
            {lockedPicks.map((p, i) => (
              <li
                key={`${p.name}-${i}`}
                className="flex items-center justify-between gap-3 p-3 text-sm"
              >
                <span className="min-w-0 truncate">{p.name}</span>
                <span className="shrink-0 font-medium">{p.team}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-10 text-center text-sm text-gray-500">
        <Link href="/" className="text-blue-600 hover:underline">
          ← Home
        </Link>
      </p>
    </main>
  );
}
