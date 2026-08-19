import type { GridCell, GridRow } from "@/lib/grid-projection";
import {
  ELIMINATED_HEADING,
  NO_ELIMINATIONS_LINE,
  noStandingLine,
  splitStandings,
  standingHeading,
} from "@/lib/standings";
import { teamColors } from "@/lib/team-colors";
import { displayTeamName } from "@/lib/team-names";

// The public picks grid: a standings sheet in two sections — who is left on
// top, everyone who has gone out below, ranked by how far they got.
//
// It used to be ONE table behind a Still-in/Everyone toggle, which made the
// competition's own shape a thing you had to click for: the toggle hid either
// the survivors or the story of how the field got that small, and defaulted to
// hiding whichever the reader hadn't thought to ask for. Two stacked tables
// show both at once, and the second one carries the ranking a toggle could
// never express — nearest misses at the top, first casualties at the bottom.
//
// One row per ENTRY, not per person: someone with two entries appears twice,
// which is how the competition actually works.
//
// Everything here is public information: names, and which team each entry
// picked. No entry ids, no phone numbers, no payment — the server sends the
// shape below and nothing else, so there is nothing private to leak into the
// payload. See app/leaderboard/page.tsx.
//
// No "use client": with the toggle gone there is no state left, so this is a
// server component and none of it ships as JavaScript.

const OUTCOME_MARK: Record<GridCell["outcome"], string> = {
  survived: "✓",
  eliminated: "✗",
  pending: "",
};

// The column template, shared by both tables. Identical widths and an identical
// column count are what let the two read as one sheet — see the single scroll
// container in PicksGrid below.
const NAME_COL = "w-32 min-w-32";
const WEEK_COL = "w-24 min-w-24";

function Cell({ cell, dead }: { cell: GridCell | null; dead: boolean }) {
  if (!cell) {
    return (
      <td
        className={`border-b border-gray-200 px-1.5 py-1.5 text-center align-middle text-xs ${
          dead ? "bg-gray-50 text-gray-300" : "text-gray-300"
        }`}
      >
        {dead ? "" : "—"}
      </td>
    );
  }

  const { primary, secondary } = teamColors(cell.team);
  const mark = OUTCOME_MARK[cell.outcome];

  return (
    <td className="border-b border-gray-200 p-0.5 align-middle">
      <div
        // Eliminated entries keep their history readable but visibly spent:
        // the colour drops back so the live rows are the ones that catch the
        // eye. Opacity, not a grey overwrite, so the club is still identifiable.
        // ring-black/10 matters more than it looks: the white-shirt clubs
        // (Fulham, Leeds, Spurs) are painted #FFFFFF, and without an edge they
        // read as an EMPTY cell — "no pick" — rather than a pick.
        className={`flex h-full min-h-9 items-center justify-between gap-1 rounded px-1.5 py-1 text-[11px] font-semibold leading-tight ring-1 ring-inset ring-black/10 ${
          dead ? "opacity-40 grayscale" : ""
        }`}
        style={{ backgroundColor: primary, color: secondary }}
      >
        <span className="min-w-0">
          {/* Colours key off the canonical name in the data; only the label
              is shortened, so a cell stays one or two words wide. */}
          {displayTeamName(cell.team)}
          {cell.auto && (
            <span className="block text-[9px] font-normal opacity-80">auto</span>
          )}
        </span>
        {mark && (
          <span
            aria-hidden
            className="shrink-0 text-[11px]"
            title={cell.outcome}
          >
            {mark}
          </span>
        )}
        <span className="sr-only">
          {cell.outcome === "survived"
            ? " — survived"
            : cell.outcome === "eliminated"
              ? " — eliminated"
              : " — awaiting result"}
        </span>
      </div>
    </td>
  );
}

/**
 * One section's table. Both sections render this, so the two can only ever have
 * the same columns in the same widths.
 *
 * `muted` greys the header of the eliminated table — enough to read as the
 * lower half of a standings sheet, not so much that it looks disabled.
 */
function GridTable({
  rows,
  roundLabels,
  caption,
  muted = false,
}: {
  rows: GridRow[];
  roundLabels: string[];
  /** Names the table for screen readers, which get no visual grouping. */
  caption: string;
  muted?: boolean;
}) {
  const head = muted ? "bg-gray-100 text-gray-400" : "bg-gray-50 text-gray-500";

  return (
    <table className="w-full border-collapse text-left text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          <th
            scope="col"
            className={`sticky left-0 z-20 ${NAME_COL} border-b border-r border-gray-200 px-2 py-2 text-xs font-semibold uppercase tracking-wide ${head}`}
          >
            Name
          </th>
          {roundLabels.map((label) => (
            <th
              key={label}
              scope="col"
              className={`${WEEK_COL} border-b border-gray-200 px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide ${head}`}
            >
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          // Keyed by name+index: the entry id is the pick-link credential
          // and a React key is serialised into the payload.
          <tr key={`${row.name}-${i}`}>
            <th
              scope="row"
              className={`sticky left-0 z-10 ${NAME_COL} max-w-32 border-b border-r border-gray-200 px-2 py-1.5 text-left align-middle font-medium ${
                row.status === "eliminated"
                  ? "bg-gray-50 text-gray-400"
                  : "bg-white"
              }`}
            >
              <span className="block truncate text-[13px]">{row.name}</span>
              {row.status === "eliminated" && (
                <span className="block text-[10px] font-semibold uppercase tracking-wide text-red-500">
                  {row.eliminatedRound ? `out R${row.eliminatedRound}` : "out"}
                </span>
              )}
              {row.status === "winner" && (
                <span className="block text-[10px] font-semibold uppercase tracking-wide text-amber-600">
                  winner
                </span>
              )}
            </th>
            {row.cells.map((cell, roundIndex) => (
              <Cell
                key={roundIndex}
                cell={cell}
                dead={
                  row.eliminatedRound !== null &&
                  roundIndex + 1 > row.eliminatedRound
                }
              />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * A heading or a note that sits INSIDE the horizontal scroller.
 *
 * Both tables share one scroll container so their week columns stay locked
 * together — scroll to week 9 and both sections are showing week 9, which is
 * what makes them read as one sheet rather than two lists that happen to be
 * stacked. The cost is that anything between the tables is inside the scroll
 * area too, and would slide out of view with it. inline-block + sticky left-0
 * is the same trick the name column uses: the box shrinks to its text, so
 * sticky has room to pin it at the left edge.
 */
function Pinned({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`sticky left-0 inline-block ${className}`}>{children}</div>
  );
}

export default function PicksGrid({
  rows,
  roundLabels,
  concluded = false,
}: {
  rows: GridRow[];
  roundLabels: string[];
  /** Past tense: "still standing" is not a thing once the competition is over. */
  concluded?: boolean;
}) {
  const { standing, eliminated } = splitStandings(rows);
  const aliveHeading = standingHeading(concluded);

  return (
    <>
      <p className="mb-2 text-xs text-gray-500">
        Scroll sideways for later weeks →
      </p>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <Pinned className="px-2 pt-3 pb-1.5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-900">
            {aliveHeading}{" "}
            <span className="tabular-nums text-gray-500">
              ({standing.length})
            </span>
          </h2>
        </Pinned>

        {standing.length === 0 ? (
          <Pinned className="px-2 pb-3 text-sm text-gray-500">
            {noStandingLine(concluded)}
          </Pinned>
        ) : (
          <GridTable
            rows={standing}
            roundLabels={roundLabels}
            caption={`${aliveHeading}, with every pick`}
          />
        )}

        {/* The gap is the separation — two sections of one sheet, not two
            unrelated tables. */}
        <Pinned className="px-2 pt-8 pb-1.5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">
            {ELIMINATED_HEADING}{" "}
            <span className="tabular-nums text-gray-400">
              ({eliminated.length})
            </span>
          </h2>
          <p className="text-[11px] font-normal normal-case text-gray-400">
            Latest exit first
          </p>
        </Pinned>

        {eliminated.length === 0 ? (
          <Pinned className="px-2 pb-3 text-sm text-gray-500">
            {NO_ELIMINATIONS_LINE}
          </Pinned>
        ) : (
          <GridTable
            rows={eliminated}
            roundLabels={roundLabels}
            caption="Eliminated entries, latest exit first, with every pick"
            muted
          />
        )}
      </div>

      <p className="mt-3 text-xs text-gray-500">
        ✓ through · ✗ out · &ldquo;auto&rdquo; means the deadline passed and a
        team was assigned. Eliminated entries are ranked by how far they got —
        the last ones knocked out at the top — and keep their picks up to the
        round they went out.
      </p>
    </>
  );
}
