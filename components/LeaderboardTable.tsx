"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { useAfterFinalPhase, usePreviewFinal } from "@/components/useDeadline";
import { computePlaces, MEDAL_TINTS, type StandingRow } from "@/lib/standings";

type LeaderboardRow = StandingRow;

const REFRESH_MS = 60_000;

const updatedFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export default function LeaderboardTable({
  limit,
  forceExact = false,
}: { limit?: number; forceExact?: boolean } = {}) {
  // Exact column is hidden until the closing stretch (same flip moment for the
  // home snapshot and the full board). The forceExact prop (home snapshot) and
  // ?preview=final (full board) both reveal it regardless of date.
  const afterFinalPhase = useAfterFinalPhase();
  const previewFinal = usePreviewFinal();
  const showExact = afterFinalPhase || forceExact || previewFinal;
  // null = first fetch not finished yet (loading state).
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [hasResults, setHasResults] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    async function load() {
      if (inFlight || cancelled) return;
      inFlight = true;
      try {
        const [board, firstResult] = await Promise.all([
          supabaseBrowser
            .from("leaderboard")
            .select("*")
            .order("points", { ascending: false })
            .order("exact_scores", { ascending: false })
            .order("name")
            .returns<LeaderboardRow[]>(),
          supabaseBrowser
            .from("matches")
            .select("id")
            .not("home_score", "is", null)
            .limit(1),
        ]);
        if (cancelled) return;
        if (board.error || firstResult.error) {
          setFailed(true);
          return;
        }
        setRows(board.data);
        setHasResults(firstResult.data.length > 0);
        setUpdatedAt(new Date());
        setFailed(false);
      } finally {
        inFlight = false;
      }
    }

    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (rows === null) {
    return (
      <p className="mt-8 text-center text-gray-500">
        {failed
          ? "Couldn't load the leaderboard — retrying shortly."
          : "Loading the leaderboard…"}
      </p>
    );
  }

  if (!hasResults) {
    return (
      <p className="mt-8 rounded-md border border-gray-200 p-6 text-center text-gray-500">
        The leaderboard goes live once the first game&apos;s result is in.
        Predictions lock at the first kick-off — Thursday 11 June, 20:00 UK
        time.
      </p>
    );
  }

  // Medals by PLACE via standard competition ranking ("1-2-2-4"). Computed over
  // the full field so a top-N snapshot still medals the right rows.
  const placeOf = computePlaces(rows);

  // The home snapshot shows a top-N slice; the count line still reflects the
  // full field. Slice keeps the same indices, so placeOf lines up.
  const displayRows = limit ? rows.slice(0, limit) : rows;

  return (
    <div className="mt-6">
      <div className="flex items-baseline justify-between text-sm text-gray-500">
        <span>
          {rows.length} {rows.length === 1 ? "entry" : "entries"}
        </span>
        <span>
          {failed
            ? "Refresh failed — showing last results"
            : updatedAt && `Updated ${updatedFormatter.format(updatedAt)}`}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="mt-8 rounded-md border border-gray-200 p-6 text-center text-gray-500">
          No entries on the board yet.
        </p>
      ) : (
        <div className="mt-3 overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-300 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="py-2 pl-3 pr-2 font-semibold sm:pl-4">#</th>
                <th className="py-2 pr-2 font-semibold">Name</th>
                <th
                  className={`py-2 text-right font-semibold ${
                    showExact ? "pr-2" : "pr-3 sm:pr-4"
                  }`}
                >
                  Points
                </th>
                {showExact && (
                  <th className="py-2 pr-3 text-right font-semibold sm:pr-4">
                    Exact
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row, i) => {
                // Only places 1–3 with a score get a medal.
                const medal =
                  row.points > 0 ? MEDAL_TINTS[placeOf[i]] : undefined;
                return (
                  <tr
                    key={i}
                    className={`border-b border-gray-200 last:border-0 ${
                      medal ? `${medal} font-medium` : ""
                    }`}
                  >
                    <td className="py-2 pl-3 pr-2 tabular-nums sm:pl-4">
                      {/* Intentional (product decision): # is row position
                          (1,2,3,4), NOT competition rank. The tie-aware place
                          lives in placeOf[i] and is shown via the medals.
                          Competition-rank numbering ("1,1,3") was considered
                          and parked — don't "fix" this to placeOf[i]. */}
                      {i + 1}
                    </td>
                    <td className="py-2 pr-2">{row.name}</td>
                    <td
                      className={`py-2 text-right tabular-nums font-semibold ${
                        showExact ? "pr-2" : "pr-3 sm:pr-4"
                      }`}
                    >
                      {row.points}
                    </td>
                    {showExact && (
                      <td className="py-2 pr-3 text-right tabular-nums sm:pr-4">
                        {row.exact_scores}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
