"use client";

import { useState, useTransition } from "react";
import { setFixtureResult } from "@/app/admin/results/actions";
import type { FixtureResult, FixtureStatus } from "@/lib/lms";

export default function FixtureRow({
  fixtureId,
  home,
  away,
  kickoff,
  initialStatus,
  initialResult,
  pickedBy,
}: {
  fixtureId: number;
  home: string;
  away: string;
  kickoff: string;
  initialStatus: FixtureStatus;
  initialResult: FixtureResult | null;
  pickedBy: number;
}) {
  const [status, setStatus] = useState<FixtureStatus>(initialStatus);
  const [result, setResult] = useState<FixtureResult | null>(initialResult);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function save(nextStatus: FixtureStatus, nextResult: FixtureResult | null) {
    setStatus(nextStatus);
    setResult(nextResult);
    setError("");
    setSaved(false);
    startTransition(async () => {
      try {
        await setFixtureResult(fixtureId, nextStatus, nextResult);
        setSaved(true);
        setTimeout(() => setSaved(false), 2_000);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed.");
      }
    });
  }

  const settled = status === "played" ? result !== null : status !== "scheduled";

  return (
    <div className={settled ? "border-l-2 border-green-500 bg-green-50/40 p-3" : "p-3"}>
      <div className="flex items-baseline justify-between gap-2 text-xs text-gray-400">
        <span className="tabular-nums">{kickoff}</span>
        {pickedBy > 0 && (
          <span>
            {pickedBy} pick{pickedBy === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <div className="mt-1 text-sm font-medium">
        {home} <span className="text-gray-400">v</span> {away}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {/* Result buttons double as "mark played" — LMS needs win/draw/loss only. */}
        {(
          [
            ["home", `${home} won`],
            ["draw", "Draw"],
            ["away", `${away} won`],
          ] as [FixtureResult, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            disabled={pending}
            onClick={() => save("played", value)}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium disabled:opacity-40 ${
              status === "played" && result === value
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-gray-300 text-gray-700 hover:bg-gray-100"
            }`}
          >
            {label}
          </button>
        ))}

        {(["postponed", "abandoned"] as FixtureStatus[]).map((value) => (
          <button
            key={value}
            type="button"
            disabled={pending}
            onClick={() => save(value, null)}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium capitalize disabled:opacity-40 ${
              status === value
                ? "border-amber-600 bg-amber-500 text-white"
                : "border-gray-300 text-gray-700 hover:bg-gray-100"
            }`}
          >
            {value}
          </button>
        ))}

        <button
          type="button"
          disabled={pending || status === "scheduled"}
          onClick={() => save("scheduled", null)}
          className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-40"
        >
          Clear
        </button>

        {saved && (
          <span className="text-xs font-medium text-green-700">Saved ✓</span>
        )}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>

      {status === "postponed" || status === "abandoned" ? (
        <p className="mt-1.5 text-xs text-amber-700">
          Counts as a WIN for anyone who picked either side — team still used.
        </p>
      ) : null}
    </div>
  );
}
