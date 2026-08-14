"use client";

import { useActionState } from "react";
import { setPickForEntry } from "@/app/admin/picks/actions";
import { teamColors } from "@/lib/team-colors";
import { displayTeamName } from "@/lib/team-names";

export type SelectableTeam = { id: number; name: string };

/**
 * One entrant's row on /admin/picks: who they are, what they picked (if
 * anything), and a picker to set or change it.
 *
 * A select rather than 10 colour buttons per row: this is used standing in a
 * pub with 50 entries on screen, and the same team list repeated fifty times
 * would be unusable. The colour lives on the current-pick chip, which is what
 * the organiser is scanning for.
 */
export default function PickForEntryRow({
  entryId,
  roundId,
  name,
  currentTeamId,
  currentTeamName,
  autoAssigned,
  options,
  deadlinePassed,
}: {
  entryId: string;
  /** The round this row was RENDERED for — compared server-side, never used
   *  to choose which round to write. */
  roundId: string;
  name: string;
  currentTeamId: number | null;
  currentTeamName: string | null;
  autoAssigned: boolean;
  options: SelectableTeam[];
  deadlinePassed: boolean;
}) {
  const [state, formAction, pending] = useActionState(setPickForEntry, null);

  const picked = currentTeamName !== null;
  const { primary, secondary } = teamColors(currentTeamName);

  return (
    <li className={`p-3 ${picked ? "" : "bg-amber-50/60"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium">{name}</span>
        {picked ? (
          <span
            className="shrink-0 rounded px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ring-black/10"
            style={{ backgroundColor: primary, color: secondary }}
          >
            {displayTeamName(currentTeamName)}
            {autoAssigned && " (auto)"}
          </span>
        ) : (
          <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-amber-700">
            no pick yet
          </span>
        )}
      </div>

      <form
        action={formAction}
        className="mt-2 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          // The organiser override is deliberate, so it asks once. Only after
          // the deadline — before it, this is an ordinary edit.
          if (
            deadlinePassed &&
            !window.confirm(
              `The deadline for this round has PASSED. Enter a pick for ${name} anyway?`
            )
          ) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="entry_id" value={entryId} />
        <input type="hidden" name="round_id" value={roundId} />
        <select
          name="team_id"
          defaultValue={currentTeamId ?? ""}
          disabled={pending}
          className="min-w-0 flex-1 rounded-md border border-gray-300 p-2 text-sm disabled:opacity-50"
          aria-label={`Pick for ${name}`}
        >
          <option value="">— choose a team —</option>
          {options.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending}
          className={`shrink-0 rounded-md px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
            deadlinePassed
              ? "bg-amber-600 hover:bg-amber-700"
              : "bg-blue-600 hover:bg-blue-700"
          }`}
        >
          {pending ? "Saving…" : picked ? "Change" : "Save"}
        </button>
      </form>

      {state && "error" in state && (
        <p role="alert" className="mt-1.5 text-xs text-red-600">
          {state.error}
        </p>
      )}
      {state && "ok" in state && (
        <p className="mt-1.5 text-xs font-medium text-green-700">{state.ok}</p>
      )}
    </li>
  );
}
