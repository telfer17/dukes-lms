"use client";

import { useMemo, useRef } from "react";
import TeamFlag from "@/components/TeamFlag";

export type GridParticipant = { id: string; name: string };
export type GridMatch = {
  id: number;
  home: string;
  away: string;
  kickoff: string;
  home_score: number | null;
  away_score: number | null;
};
// participant id -> match id -> [home_pred, away_pred]
export type GridPreds = Record<string, Record<number, [number, number]>>;

const dayFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "short",
  day: "numeric",
  month: "short",
});

function dayKey(iso: string) {
  return dayFmt.format(new Date(iso));
}

export default function PredictionsGrid({
  participants,
  matches,
  preds,
}: {
  participants: GridParticipant[];
  matches: GridMatch[];
  preds: GridPreds;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Mark the first fixture of each day so we can draw a divider before it.
  const cols = useMemo(
    () =>
      matches.map((m, i) => ({
        ...m,
        dayStart: i === 0 || dayKey(m.kickoff) !== dayKey(matches[i - 1].kickoff),
        day: dayKey(m.kickoff),
      })),
    [matches]
  );

  function jumpToNext() {
    const now = Date.now();
    const next =
      matches.find((m) => new Date(m.kickoff).getTime() > now) ??
      matches[matches.length - 1];
    if (next) {
      document
        .getElementById(`col-${next.id}`)
        ?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          {participants.length} entrants · {matches.length} fixtures · scroll
          sideways
        </p>
        <button
          type="button"
          onClick={jumpToNext}
          className="shrink-0 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
        >
          Jump to next match
        </button>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-green-100 ring-1 ring-green-300" />
          green = exact score
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-amber-100 ring-1 ring-amber-300" />
          yellow = correct result
        </span>
      </div>

      <div
        ref={scrollRef}
        className="overflow-auto rounded-lg border border-gray-200"
        style={{ maxHeight: "75vh" }}
      >
        <table className="border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 w-36 min-w-36 border-b border-r border-gray-200 bg-gray-50 px-3 py-2 text-left font-semibold">
                Name
              </th>
              {cols.map((m) => {
                const hasResult =
                  m.home_score !== null && m.away_score !== null;
                return (
                  <th
                    key={m.id}
                    id={`col-${m.id}`}
                    title={`${m.home} v ${m.away}`}
                    className={`sticky top-0 z-20 w-20 min-w-20 border-b border-gray-200 bg-gray-50 px-1 py-2 align-top font-normal ${
                      m.dayStart ? "border-l-2 border-l-gray-300" : ""
                    }`}
                  >
                    <div className="text-[9px] uppercase tracking-wide text-gray-400">
                      {m.day}
                    </div>
                    <div className="mt-0.5 flex flex-col items-center gap-0.5">
                      <span className="flex items-center gap-1">
                        <TeamFlag team={m.home} />
                        <span className="max-w-[3.5rem] truncate">{m.home}</span>
                      </span>
                      <span className="text-[9px] text-gray-400">v</span>
                      <span className="flex items-center gap-1">
                        <TeamFlag team={m.away} />
                        <span className="max-w-[3.5rem] truncate">{m.away}</span>
                      </span>
                    </div>
                    {hasResult && (
                      <div className="mt-0.5 font-semibold text-red-600">
                        {m.home_score}–{m.away_score}
                      </div>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {participants.map((p) => {
              const row = preds[p.id] ?? {};
              return (
                <tr key={p.id}>
                  <th
                    scope="row"
                    title={p.name}
                    className="sticky left-0 z-10 w-36 min-w-36 max-w-36 truncate border-b border-r border-gray-200 bg-white px-3 py-1.5 text-left font-medium"
                  >
                    {p.name}
                  </th>
                  {cols.map((m) => {
                    const pick = row[m.id];
                    const hasResult =
                      m.home_score !== null && m.away_score !== null;
                    const exact =
                      !!pick &&
                      hasResult &&
                      pick[0] === m.home_score &&
                      pick[1] === m.away_score;
                    // Right winner/draw but wrong score (exact already excluded).
                    const correctResult =
                      !!pick &&
                      hasResult &&
                      !exact &&
                      Math.sign(pick[0] - pick[1]) ===
                        Math.sign(
                          (m.home_score as number) - (m.away_score as number)
                        );
                    return (
                      <td
                        key={m.id}
                        className={`border-b border-gray-100 px-1 py-1.5 text-center tabular-nums ${
                          m.dayStart ? "border-l-2 border-l-gray-200" : ""
                        } ${
                          exact
                            ? "bg-green-100 font-semibold text-green-800"
                            : correctResult
                              ? "bg-amber-100 font-semibold text-amber-800"
                              : pick
                                ? "text-gray-700"
                                : "text-gray-300"
                        }`}
                      >
                        {pick ? `${pick[0]}-${pick[1]}` : "–"}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
