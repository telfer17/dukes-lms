import Image from "next/image";
import Link from "next/link";
import BoardTabs from "@/components/BoardTabs";
import ConcludedPanel from "@/components/ConcludedPanel";
import DeadlineCountdown from "@/components/DeadlineCountdown";
import { readConcludedSummary, type ConcludedSummary } from "@/lib/concluded";
import { formatPence, potPence } from "@/lib/competition";
import {
  currentRound,
  getEntries,
  getPicksForRound,
  getTeams,
  isRoundOpen,
  type EntryWithParticipant,
} from "@/lib/lms-db";
import {
  isConcluded,
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

  // Over, but not gone. The competition still owns this page — the table below
  // is the final one, and the rounds it never got to are not this board's
  // business any more.
  const concluded = isConcluded(competition.status);

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

  // ---- entries: private rows, read once, projected before anything ships ----
  // The pot is computed SERVER-SIDE from the amounts on these rows and only the
  // total leaves; the concluded summary reuses the same read rather than
  // fetching them a second time.
  let entries: EntryWithParticipant[] | null = null;
  try {
    entries = await getEntries(competition.id);
  } catch (e) {
    console.error("board: entries read failed:", e);
  }

  const potLabel = entries
    ? formatPence(potPence(competition.pot_carried_in_pence, entries))
    : null;

  const summary: ConcludedSummary | null = concluded
    ? await readConcludedSummary(competition, entries ?? undefined)
    : null;

  // ---- this round's picks ----
  // Picks are PUBLIC from the moment they are made. They used to be held back
  // until the deadline passed, on the theory that a latecomer could copy; the
  // decision was reversed before launch — there is no secrecy rule in
  // docs/LMS-RULES.md, and /grid shows the same picks, so hiding them here
  // would only make the two screens disagree. The pick LINK stays private; the
  // pick does not.
  //
  // A concluded competition has none: rounds are generated for the whole season
  // up front, so currentRound() happily returns round 12 of a competition that
  // ended at round 5 — and "picks lock in 4 days" under a winner's name is the
  // sort of thing that gets an organiser phoned.
  let currentPicks: { name: string; team: string }[] = [];
  const revealRound =
    !concluded && round && round.status !== "settled" ? round : null;
  if (revealRound && entries) {
    try {
      const [picks, teams] = await Promise.all([
        getPicksForRound(revealRound.id),
        getTeams(),
      ]);
      const teamName = new Map(teams.map((t) => [t.id, t.name]));
      const entryName = new Map(
        entries.map((e) => [e.id, e.participant?.name ?? "—"])
      );
      currentPicks = picks
        .map((p) => ({
          name: entryName.get(p.entry_id) ?? "—",
          team: teamName.get(p.team_id) ?? "—",
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      console.error("current picks read failed:", e);
    }
  }

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
        {concluded && (
          <p className="mt-4 text-xs font-bold uppercase tracking-wide text-gray-500">
            Final standings
          </p>
        )}
        <h1
          className={`text-2xl font-bold tracking-tight sm:text-3xl ${
            concluded ? "mt-1" : "mt-4"
          }`}
        >
          {competition.label}
        </h1>
        <p className="mt-2 text-3xl font-bold tabular-nums sm:text-4xl">
          {active.length} of {board.length}
        </p>
        {/* The same count, past tense: on a finished competition nobody is
            "still" anything. 0 of 24 made it to the end is exactly what
            happened on a rollover, and the panel below says why. */}
        <p className="text-sm uppercase tracking-wide text-gray-500">
          {concluded ? "made it to the end" : "still standing"}
        </p>
        {/* The pot moves into the panel once it is over — it is no longer a
            prize on offer, it is a prize taken or a prize carried forward. */}
        {potLabel && !concluded && (
          <p className="mt-3 inline-block rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-900">
            Prize pot {potLabel}
          </p>
        )}
      </div>

      {summary && <ConcludedPanel summary={summary} className="mt-6" />}

      {round && !concluded && (
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
          // A finished competition opens on the story everyone wants: on a
          // rollover the survivors' tab is empty, so the full field — with the
          // round each of them went out in — is what comes up first.
          activeLabel={concluded ? "Made it" : "Still in"}
          initialTab={concluded && active.length === 0 ? "out" : "active"}
          active={
            active.length === 0 ? (
              <p className="rounded-md border border-gray-200 p-6 text-center text-gray-500">
                {concluded
                  ? "Nobody made it to the end — everyone went out."
                  : "Nobody is still in."}
              </p>
            ) : (
              <ul className="divide-y divide-gray-200 rounded-md border border-gray-200">
                {/* Keyed by name+index, NOT the entry id: a React key is
                    serialised into the RSC payload, and entries.id is the pick
                    link. See lib/public-read.ts. */}
                {active.map((row, i) => (
                  <li
                    key={`${row.name}-${i}`}
                    className="flex items-center justify-between gap-3 p-3 text-sm"
                  >
                    <span className="min-w-0 truncate font-medium">
                      {row.name}
                    </span>
                    <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-green-700">
                      {row.status === "winner" ? "winner" : "in"}
                    </span>
                  </li>
                ))}
              </ul>
            )
          }
          out={
            out.length === 0 ? (
              <p className="rounded-md border border-gray-200 p-6 text-center text-gray-500">
                {concluded ? "Nobody went out." : "Nobody's out yet."}
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

      {currentPicks.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            This round&apos;s picks
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            {round && isRoundOpen(round)
              ? "Picks show as soon as they're made — and can change until the deadline."
              : "Locked in."}
          </p>
          <ul className="mt-2 divide-y divide-gray-200 rounded-md border border-gray-200">
            {currentPicks.map((p, i) => (
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

      {rounds.length > 0 && (
        <p className="mt-8 text-center">
          <Link
            href="/grid"
            className="inline-block rounded-md border-2 border-blue-600 px-5 py-2.5 text-sm font-semibold text-blue-600 hover:bg-blue-50"
          >
            {concluded ? "See the season's picks →" : "See everyone's picks →"}
          </Link>
        </p>
      )}

      <p className="mt-10 text-center text-sm text-gray-500">
        <Link href="/" className="text-blue-600 hover:underline">
          ← Home
        </Link>
      </p>
    </main>
  );
}
