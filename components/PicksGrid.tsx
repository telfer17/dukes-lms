"use client";

import { useMemo, useState } from "react";
import type { GridCell, GridRow } from "@/lib/grid-projection";
import { teamColors } from "@/lib/team-colors";
import { displayTeamName } from "@/lib/team-names";

// The public picks grid: one row per ENTRY (not per person — someone with two
// entries appears twice, which is how the competition actually works), one
// column per round played so far.
//
// Everything here is public information: names, and which team each entry
// picked. No entry ids, no phone numbers, no payment — the server sends the
// shape below and nothing else, so there is nothing private to leak into the
// payload. See app/grid/page.tsx.

type Filter = "in" | "all";

const OUTCOME_MARK: Record<GridCell["outcome"], string> = {
  survived: "✓",
  eliminated: "✗",
  pending: "",
};

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

export default function PicksGrid({
  rows,
  roundLabels,
  defaultFilter = "in",
  concluded = false,
}: {
  rows: GridRow[];
  roundLabels: string[];
  /** Which rows to open on. A finished competition opens on everyone. */
  defaultFilter?: Filter;
  /** Past tense: "still in" is not a thing once the competition is over. */
  concluded?: boolean;
}) {
  const [filter, setFilter] = useState<Filter>(defaultFilter);

  const aliveCount = useMemo(
    () => rows.filter((r) => r.status !== "eliminated").length,
    [rows]
  );

  // Both views come from the same server data — the toggle only chooses which
  // rows to draw. Nothing is fetched again, and nothing is hidden with CSS that
  // the other view would reveal.
  const visible = filter === "in"
    ? rows.filter((r) => r.status !== "eliminated")
    : rows;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div
          className="inline-flex rounded-md border border-gray-300 p-0.5 text-sm"
          role="group"
          aria-label="Which entries to show"
        >
          {(
            [
              ["in", `${concluded ? "Made it" : "Still in"} (${aliveCount})`],
              ["all", `Everyone (${rows.length})`],
            ] as [Filter, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              aria-pressed={filter === value}
              className={`rounded px-3 py-1 font-medium ${
                filter === value
                  ? "bg-gray-900 text-white"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500">Scroll sideways for later weeks →</p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-20 w-32 min-w-32 border-b border-r border-gray-200 bg-gray-50 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500"
              >
                Name
              </th>
              {roundLabels.map((label) => (
                <th
                  key={label}
                  scope="col"
                  className="w-24 min-w-24 border-b border-gray-200 bg-gray-50 px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-gray-500"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
              // Keyed by name+index: the entry id is the pick-link credential
              // and a React key is serialised into the payload.
              <tr key={`${row.name}-${i}`}>
                <th
                  scope="row"
                  className={`sticky left-0 z-10 w-32 min-w-32 max-w-32 border-b border-r border-gray-200 px-2 py-1.5 text-left align-middle font-medium ${
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
      </div>

      {visible.length === 0 && (
        <p className="mt-4 rounded-md border border-gray-200 p-6 text-center text-gray-500">
          {filter === "in"
            ? concluded
              ? "Nobody made it to the end — everyone went out."
              : "Nobody is still in — the competition rolled over."
            : "No entries yet."}
        </p>
      )}

      <p className="mt-3 text-xs text-gray-500">
        ✓ through · ✗ out · &ldquo;auto&rdquo; means the deadline passed and a
        team was assigned. Eliminated entries keep their picks up to the round
        they went out.
      </p>
    </>
  );
}
