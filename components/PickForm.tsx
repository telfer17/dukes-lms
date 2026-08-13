"use client";

import { useActionState, useState } from "react";
import { submitPick } from "@/app/pick/[entryId]/actions";

export type PickOption = {
  id: number;
  name: string;
  available: boolean;
  opponent: string;
  homeAway: "H" | "A";
  kickoff: string;
};

export default function PickForm({
  entryId,
  roundId,
  options,
  currentTeamId,
}: {
  entryId: string;
  roundId: string;
  options: PickOption[];
  currentTeamId: number | null;
}) {
  const [state, formAction, pending] = useActionState(submitPick, null);
  const [selected, setSelected] = useState<number | null>(currentTeamId);

  return (
    <form action={formAction} className="mt-4">
      <input type="hidden" name="entry_id" value={entryId} />
      <input type="hidden" name="round_id" value={roundId} />
      <input type="hidden" name="team_id" value={selected ?? ""} />

      <ul className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const isSelected = selected === option.id;
          return (
            <li key={option.id}>
              <button
                type="button"
                disabled={!option.available || pending}
                onClick={() => setSelected(option.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-md border p-3 text-left text-sm transition ${
                  isSelected
                    ? "border-blue-600 bg-blue-50 font-semibold"
                    : option.available
                      ? "border-gray-200 hover:border-blue-400 hover:bg-blue-50/40"
                      : "cursor-not-allowed border-gray-100 bg-gray-50 text-gray-400"
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate">{option.name}</span>
                  <span
                    className={`block text-xs ${
                      option.available ? "text-gray-500" : "text-gray-400"
                    }`}
                  >
                    {option.homeAway === "H" ? "v" : "at"} {option.opponent} ·{" "}
                    {option.kickoff}
                  </span>
                </span>
                {!option.available && (
                  <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide">
                    used
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {state && "error" in state && (
        <p
          role="alert"
          className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {state.error}
        </p>
      )}
      {state && "ok" in state && (
        <p className="mt-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          {state.ok}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || selected === null}
        className="mt-4 w-full rounded-md bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {pending
          ? "Saving…"
          : currentTeamId === null
            ? "Confirm pick"
            : "Change pick"}
      </button>
      <p className="mt-2 text-center text-xs text-gray-500">
        You can change your pick any time before the deadline.
      </p>
    </form>
  );
}
