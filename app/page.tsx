import Image from "next/image";
import Link from "next/link";
import ConcludedPanel from "@/components/ConcludedPanel";
import DeadlineCountdown from "@/components/DeadlineCountdown";
import fixtureData from "@/data/fixtures-2026-27.json";
import { readConcludedSummary, type ConcludedSummary } from "@/lib/concluded";
import {
  BASE_ENTRY_PENCE,
  clubPence,
  formatPence,
  potPence,
} from "@/lib/competition";
import { currentRound, isRoundOpen } from "@/lib/lms-db";
import {
  isConcluded,
  readPublicBoard,
  readPublicCompetition,
  readPublicRounds,
  type BoardRow,
} from "@/lib/public-read";

// Live state — never cached.
export const dynamic = "force-dynamic";

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
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

// Season start read off the committed fixture list rather than typed in, so
// the "starts soon" screen can't drift from the fixtures the rounds are built
// from. Kickoffs are UTC instants; the formatter puts them back into UK time.
const seasonKickoff = fixtureData.fixtures
  .filter((f) => f.matchday === 1)
  .map((f) => f.kickoff)
  .sort()[0];

// The money, straight from the rules maths — one £10 entry through the same
// functions the pot and the admin screens use, so the split shown here can
// never drift from the split actually applied.
const oneEntry = [{ paid: true, amount_paid_pence: BASE_ENTRY_PENCE }];
const ENTRY_LABEL = formatPence(BASE_ENTRY_PENCE);
const POT_SHARE_LABEL = formatPence(potPence(0, oneEntry));
const CLUB_SHARE_LABEL = formatPence(clubPence(oneEntry));

type LiveState =
  | { kind: "preseason" }
  | { kind: "between" }
  | { kind: "unavailable" }
  | { kind: "concluded"; summary: ConcludedSummary }
  | {
      kind: "running";
      label: string;
      alive: number;
      total: number;
      round: {
        number: number;
        matchday: number;
        deadline: string;
        open: boolean;
      } | null;
    };

/**
 * "No competition" is two different facts and they must not share a screen.
 *
 * Before the season starts, it means "starts soon, here is the first kick-off".
 * AFTER it starts it means something else entirely — the competition rolled
 * over and the next one isn't up yet, or the season is done — and telling a
 * player in December that the season kicks off on 21 August is a straight lie
 * that also buries the real answer (ask the organiser).
 *
 * This is now the narrow case it always should have been: readPublicCompetition
 * falls back to the last concluded competition, so a finished one lands on the
 * concluded panel — winner, pot, final table — instead of here. Nothing reaches
 * this function unless the database holds no competition at all.
 */
function noCompetitionState(): LiveState {
  return Date.now() < Date.parse(seasonKickoff)
    ? { kind: "preseason" }
    : { kind: "between" };
}

async function readLiveState(): Promise<LiveState> {
  const { data: competition, error } = await readPublicCompetition();
  if (error) {
    console.error("home: competition read failed:", error);
    return { kind: "unavailable" };
  }
  if (!competition) return noCompetitionState();

  // Over, but not gone: the winner (or the rollover) and the pot come off the
  // same rows the board and the grid are still rendering from.
  if (isConcluded(competition.status)) {
    return {
      kind: "concluded",
      summary: await readConcludedSummary(competition),
    };
  }

  const [boardRes, roundsRes] = await Promise.all([
    readPublicBoard(competition.id),
    readPublicRounds(competition.id),
  ]);

  // Half a read is worse than none: "0 still standing" on a live competition
  // would be a lie, so a failed read says so instead.
  if (boardRes.error || roundsRes.error) {
    console.error(
      "home: live state read failed:",
      boardRes.error ?? roundsRes.error,
    );
    return { kind: "unavailable" };
  }

  const board: BoardRow[] = boardRes.data ?? [];
  const round = currentRound(roundsRes.data ?? []);

  // No winner branch here any more: a competition with a winner is 'won', and
  // 'won' is the concluded state above. This one is genuinely still running.
  return {
    kind: "running",
    label: competition.label,
    alive: board.filter((r) => r.status === "active" || r.status === "winner")
      .length,
    total: board.length,
    round: round
      ? {
          number: round.round_number,
          matchday: round.matchday,
          deadline: round.deadline,
          open: isRoundOpen(round),
        }
      : null,
  };
}

const howItWorks = [
  {
    title: "Pick one team a round",
    body: "Every round is a Premier League matchday. Pick one team from that matchday to win.",
  },
  {
    title: "Win and you're through",
    body: "A draw or a defeat and you're out. No second chances, no points, no tie-breaks.",
  },
  {
    title: "Never the same team twice",
    body: "Once you've picked a team it's gone for good — until you've used all 20, when the whole list comes back.",
  },
  {
    title: "Last one standing takes the pot",
    body: "If everyone goes out in the same round nobody wins: the pot rolls over into a new competition.",
  },
];

export default async function Home() {
  // supabase-js reports query failures in `error`, but a DNS or TLS failure
  // still throws. That must land on the honest "can't load" panel rather than
  // replacing the whole homepage — including how it works and the entry
  // price, which are true whatever the database is doing — with an error page.
  const live = await readLiveState().catch((e): LiveState => {
    console.error("home: live state threw:", e);
    return { kind: "unavailable" };
  });

  return (
    <main className="mx-auto max-w-4xl px-4">
      {/* ---- Hero ---- */}
      <section className="pt-12 pb-10 text-center sm:pt-16">
        <Image
          src="/wellington.jpg"
          alt="Glasgow Wellington logo"
          width={140}
          height={140}
          priority
          className="mx-auto rounded-full"
        />
        <h1 className="mt-6 text-3xl font-bold tracking-tight sm:text-5xl">
          Glasgow Dukes — Last Man Standing
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-gray-600">
          One Premier League team each round. Win and you&apos;re through, draw
          or lose and you&apos;re out. The last one standing takes the pot.
        </p>

        {/* ---- Live state, server-derived ---- */}
        <div className="mx-auto mt-8 max-w-lg">
          {live.kind === "unavailable" && (
            <div className="rounded-lg border border-gray-200 p-5 text-sm text-gray-500">
              The live state can&apos;t be loaded right now. Try again in a
              minute.
            </div>
          )}

          {live.kind === "preseason" && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-5">
              <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
                Starts soon
              </p>
              <p className="mt-2 font-semibold">
                Season kicks off {kickoffFormat.format(new Date(seasonKickoff))}
              </p>
              <p className="mt-1 text-sm text-gray-600">
                That first kick-off is the round 1 deadline. Entries are taken
                by the organiser — message your club contact to get in.
              </p>
            </div>
          )}

          {live.kind === "between" && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-5">
              <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
                Between competitions
              </p>
              <p className="mt-2 text-sm text-gray-600">
                No competition is running at the moment. If the last one rolled
                over, the next one starts once the organiser opens it — your
                club contact will know.
              </p>
            </div>
          )}

          {live.kind === "concluded" && (
            <>
              <ConcludedPanel summary={live.summary} />
              <p className="mt-3 text-sm text-gray-600">
                {live.summary.label} — final standings and every pick of the
                season are still up.
              </p>
            </>
          )}

          {live.kind === "running" && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-5">
              <p className="text-xs font-bold uppercase tracking-wide text-blue-700">
                {live.label}
              </p>

              {/* A competition with no entries yet is not "0 of 0 still
                  standing" — that reads as a wipeout on the one screen people
                  check to see whether they're still in. Same wording as
                  /board, which the CTA sends them to. */}
              {live.total === 0 ? (
                <p className="mt-2 text-lg font-semibold text-blue-900">
                  No entries yet.
                </p>
              ) : (
                <p className="mt-2 text-3xl font-bold tabular-nums text-blue-900">
                  {live.alive}{" "}
                  <span className="text-xl font-semibold">
                    of {live.total} still standing
                  </span>
                </p>
              )}
              {live.round && (
                <p className="mt-3 text-sm text-blue-900">
                  <span className="font-semibold">
                    Round {live.round.number}
                  </span>{" "}
                  <span className="text-blue-700">
                    (matchday {live.round.matchday})
                  </span>
                  <br />
                  {live.round.open ? (
                    <>
                      Picks lock in{" "}
                      <DeadlineCountdown deadline={live.round.deadline} /> —{" "}
                      {deadlineFormat.format(new Date(live.round.deadline))}
                    </>
                  ) : (
                    <>
                      Locked —{" "}
                      {deadlineFormat.format(new Date(live.round.deadline))}
                    </>
                  )}
                </p>
              )}
            </div>
          )}
        </div>

        {/* ---- CTAs ----
            Past tense once the competition is over: "see who's still in" points
            at a board where nobody is, and "this round's picks" at a round that
            will never be played. Same two links, honest labels. */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/board"
            className="rounded-md bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700"
          >
            {live.kind === "concluded"
              ? "See the final standings"
              : "See who's still in"}
          </Link>
          <Link
            href="/grid"
            className="rounded-md border-2 border-blue-600 px-6 py-3 font-semibold text-blue-600 hover:bg-blue-50"
          >
            {live.kind === "concluded"
              ? "The season's picks"
              : "This round's picks"}
          </Link>
        </div>

        <p className="mx-auto mt-6 max-w-lg text-sm text-gray-600">
          {live.kind === "concluded"
            ? "Nothing to pick right now. When the next competition opens, entries and picks go through your club contact as usual."
            : "Picks go through your club contact — get yours to them before the deadline and they'll put it in for you."}
        </p>
      </section>

      {/* ---- How it works ---- */}
      <section
        id="how-it-works"
        className="scroll-mt-20 border-t border-gray-200 py-12"
      >
        <h2 className="text-2xl font-bold">How it works</h2>

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          {howItWorks.map((card) => (
            <div
              key={card.title}
              className="rounded-md border border-gray-200 p-5"
            >
              <h3 className="font-semibold">{card.title}</h3>
              <p className="mt-2 text-sm text-gray-600">{card.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-md border border-gray-200 p-5">
          <h3 className="font-semibold">{ENTRY_LABEL} to enter</h3>
          <p className="mt-2 text-sm text-gray-600">
            {POT_SHARE_LABEL} goes into the prize pot, {CLUB_SHARE_LABEL} goes
            to the club. The pot is winner-takes-all — no second or third
            places.
          </p>
          <p className="mt-2 text-sm text-gray-600">
            Entries and picks both go through the organiser: message your club
            contact to get in, then tell them your team each round before the
            deadline. You can take more than one entry, as long as you pay a
            full entry for each — they run completely independently of each
            other.
          </p>
        </div>

        <p className="mt-6 text-sm text-gray-600">
          Missed a deadline? Picked a team whose game got called off?{" "}
          <Link
            href="/rules"
            className="font-semibold text-blue-600 hover:underline"
          >
            The full rules
          </Link>{" "}
          cover every one of those, and settle any argument later in the season.
        </p>
      </section>
    </main>
  );
}
