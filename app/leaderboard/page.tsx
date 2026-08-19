import Image from "next/image";
import Link from "next/link";
import ConcludedPanel from "@/components/ConcludedPanel";
import DeadlineCountdown from "@/components/DeadlineCountdown";
import PicksGrid from "@/components/PicksGrid";
import { formatPence, potPence } from "@/lib/competition";
import { readConcludedSummary, type ConcludedSummary } from "@/lib/concluded";
import { buildGridRows, type GridRow } from "@/lib/grid-projection";
import {
  currentRound,
  getBuybacks,
  getEntries,
  getPicksForCompetition,
  getRounds,
  getTeams,
  isRoundOpen,
  type RoundRow,
} from "@/lib/lms-db";
import { isConcluded, readPublicCompetition } from "@/lib/public-read";
import { splitStandings, standingHeading } from "@/lib/standings";

// Live data, never cached.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Leaderboard · Glasgow Dukes — Last Man Standing",
  description:
    "Who's still standing and every entry's pick, week by week, for the Glasgow Dukes Last Man Standing competition.",
};

/**
 * THE public screen: the state of the competition and every pick that produced
 * it, on one page.
 *
 * It used to be two — /board (who is left, the pot, the deadline) and /grid
 * (the picks). They read the same competition and answered overlapping
 * questions, so they could disagree, and a player checking "am I still in?"
 * had to know which of two links to open. The board's headline block is now the
 * top of this page and its IN/OUT name list is gone: the standings tables below
 * carry the same names with the week each of them went out, which is strictly
 * more than the list said. Both old routes redirect here (next.config.ts).
 *
 * WHAT LEAVES THE SERVER.
 *
 * This page needs picks, which are secret-key-only (db/lms-schema.sql revokes
 * them from anon), so it reads with the server client and PROJECTS. The rows
 * handed to the client component carry a name, a status, an elimination round,
 * and per-round { team, outcome, auto } — and nothing else.
 *
 * Deliberately absent: entries.id (the handle every write path takes),
 * participant ids, phone numbers, payment amounts, team ids, round ids. They
 * are never put on the props, so they cannot appear in the RSC payload — the
 * lesson from the board's entry-id leak, where a value used only as a React key
 * still reached the browser. tests/grid-projection.test.ts pins the shape.
 *
 * The pot is the same story: computed here from what each entry actually paid,
 * and only the total ships.
 *
 * Picks themselves are public the moment they are made: there is no secrecy
 * rule in docs/LMS-RULES.md, and this page is the competition's scoreboard.
 * What stays private is who owes what and how to reach them.
 */

const deadlineFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export default async function LeaderboardPage() {
  const { data: competition, error } = await readPublicCompetition();

  // A failed lookup is NOT "no competition". Telling someone whose competition
  // is running that nothing is on, because the database was briefly
  // unreachable, is the same lie as an empty board — and it sends them to the
  // organiser asking why they have been dropped.
  if (error) {
    console.error("leaderboard: competition read failed:", error);
    return (
      <Shell>
        <p className="mt-6 text-center text-gray-600">
          The leaderboard can&apos;t be loaded right now. Try again in a minute.
        </p>
      </Shell>
    );
  }

  if (!competition) {
    return (
      <Shell>
        <p className="mt-6 text-center text-gray-600">
          No competition running yet. Check back soon.
        </p>
      </Shell>
    );
  }

  // A finished competition's picks are the record of it, not a stale page —
  // every round it played, who picked what, and where each of them went out.
  const concluded = isConcluded(competition.status);

  let rows: GridRow[] = [];
  let roundLabels: string[] = [];
  let summary: ConcludedSummary | null = null;
  let potLabel: string | null = null;
  let round: RoundRow | null = null;

  try {
    const [rounds, entries, picks, teams, buybacks] = await Promise.all([
      getRounds(competition.id),
      getEntries(competition.id),
      getPicksForCompetition(competition.id),
      getTeams(),
      getBuybacks(competition.id),
    ]);

    const projected = buildGridRows({
      rounds,
      entries,
      picks,
      teamNameById: new Map(teams.map((t) => [t.id, t.name])),
    });
    rows = projected.rows;
    roundLabels = projected.roundLabels;

    // Entries AND buy-backs: every payment is £10 through the same 50/50 split,
    // so a bought-back entry has put another £5 in the pot people are playing
    // for. See docs/LMS-RULES.md § Buy-back.
    potLabel = formatPence(
      potPence(competition.pot_carried_in_pence, [...entries, ...buybacks])
    );

    // Rounds are generated for the whole season up front, so currentRound()
    // happily returns round 12 of a competition that ended at round 5 — and
    // "picks lock in 4 days" under a winner's name is the sort of thing that
    // gets an organiser phoned.
    round = concluded ? null : currentRound(rounds);

    // Same entries, no second read.
    if (concluded)
      summary = await readConcludedSummary(competition, entries, buybacks);
  } catch (e) {
    console.error("leaderboard: read failed:", e);
    return (
      <Shell label={competition.label}>
        <p className="mt-6 text-center text-gray-600">
          The leaderboard can&apos;t be loaded right now. Try again in a minute.
        </p>
      </Shell>
    );
  }

  // The headline count, off the same rows the tables render — one source, so
  // the number at the top can never disagree with the table under it.
  const { standing } = splitStandings(rows);

  return (
    <Shell
      label={competition.label}
      concluded={concluded}
      standing={standing.length}
      total={rows.length}
      potLabel={potLabel}
    >
      {/* Where the round card goes once there is no next round: same slot, and
          the only thing on the page that changes place when it ends. */}
      {summary && <ConcludedPanel summary={summary} className="mt-5" />}

      {round && (
        <div className="mt-5 rounded-md border border-gray-200 p-3 text-center sm:p-4">
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

      {rows.length === 0 || roundLabels.length === 0 ? (
        <p className="mt-6 rounded-md border border-gray-200 p-6 text-center text-gray-500">
          {rows.length === 0
            ? "No entries yet."
            : "No picks yet — the first round hasn't started."}
        </p>
      ) : (
        <div className="mt-6">
          <PicksGrid
            rows={rows}
            roundLabels={roundLabels}
            concluded={concluded}
          />
        </div>
      )}

      <p className="mt-8 text-center text-sm text-gray-500">
        <Link href="/" className="text-blue-600 hover:underline">
          Home
        </Link>{" "}
        ·{" "}
        <Link href="/rules" className="text-blue-600 hover:underline">
          The full rules
        </Link>
      </p>
    </Shell>
  );
}

/**
 * The page frame and its headline block.
 *
 * Deliberately compact on a phone: everything above the tables is a header, and
 * a header that fills the first screen pushes the thing people came for below
 * the fold. The crest steps down to 56px, the vertical padding halves, and the
 * count sits straight under the name.
 */
function Shell({
  label,
  concluded = false,
  standing,
  total,
  potLabel,
  children,
}: {
  label?: string;
  concluded?: boolean;
  /** Entries still in. Omitted on the error and empty states. */
  standing?: number;
  total?: number;
  potLabel?: string | null;
  children: React.ReactNode;
}) {
  return (
    // w-full is load-bearing, not tidiness. The root layout makes <body> a flex
    // column, so this <main> is a flex item — and `mx-auto` on a flex item
    // cancels the usual stretch-to-fit, leaving it sized by its own content.
    // That content is a 20-column table, so without an explicit width the table
    // never scrolls inside its own overflow-x-auto box: it widens MAIN instead
    // and the entire page (nav, heading, winner panel and all) slides sideways
    // on a phone. A finished competition is the worst case — the full season is
    // the widest this grid ever gets.
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:py-10">
      <div className="text-center">
        <Image
          src="/wellington.jpg"
          alt="Glasgow Wellington logo"
          width={64}
          height={64}
          priority
          className="mx-auto h-14 w-14 rounded-full sm:h-16 sm:w-16"
        />
        <p className="mt-3 text-xs font-bold uppercase tracking-wide text-gray-500">
          {concluded ? "Final standings" : "Leaderboard"}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
          {label ?? "Glasgow Dukes — Last Man Standing"}
        </h1>

        {standing !== undefined && total !== undefined && (
          <>
            <p className="mt-2 text-3xl font-bold tabular-nums sm:text-4xl">
              {standing} of {total}
            </p>
            {/* The same words as the table heading below, from the same helper:
                past tense once it is over, because nobody is "still" anything
                on a competition that has finished. */}
            <p className="text-sm uppercase tracking-wide text-gray-500">
              {standingHeading(concluded).toLowerCase()}
            </p>
          </>
        )}

        {/* The pot moves into the concluded panel once it is over — it is no
            longer a prize on offer, it is a prize taken or carried forward. */}
        {potLabel && !concluded && (
          <p className="mt-3 inline-block rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-900">
            Prize pot {potLabel}
          </p>
        )}
      </div>
      {children}
    </main>
  );
}
