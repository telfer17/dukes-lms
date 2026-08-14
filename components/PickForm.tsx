"use client";

import { useActionState, useState } from "react";
import { submitPick } from "@/app/pick/[entryId]/actions";
import { teamColors } from "@/lib/team-colors";
import { displayTeamName } from "@/lib/team-names";

export type PickTeam = {
  id: number;
  name: string;
  /** False once this entry has used the team — still shown, never pickable. */
  available: boolean;
};

export type PickFixture = {
  /** Stable within the round; NOT a database id anyone can act on. */
  key: string;
  kickoff: string;
  home: PickTeam;
  away: PickTeam;
};

/**
 * One pickable team. This is the fun moment of the whole app, so the buttons
 * wear full club colours rather than the chips used on the admin screens.
 *
 * A used team keeps its place in the row — seeing "Arsenal, already used" is
 * the useful information; silently dropping it would leave a gap in the
 * fixture and make the list stop matching the matchday.
 */
function TeamButton({
  team,
  selected,
  disabled,
  onSelect,
}: {
  team: PickTeam;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const { primary, secondary } = teamColors(team.name);
  const usable = team.available && !disabled;

  return (
    <button
      type="button"
      disabled={!usable}
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex min-w-0 flex-1 items-center justify-between gap-1.5 rounded-md border px-2.5 py-2.5 text-left text-sm font-semibold transition ${
        team.available
          ? selected
            ? "border-gray-900 ring-2 ring-gray-900 ring-offset-1"
            : "border-black/10 hover:brightness-95"
          : "cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400"
      }`}
      // Club colours only while the team can actually be picked: a used team
      // painted in full colour reads as available at a glance.
      style={
        team.available
          ? { backgroundColor: primary, color: secondary }
          : undefined
      }
    >
      {/* Short display name, so this stays one line and unambiguous. The
          canonical name is still what colours and used-team history key off —
          only the label is shortened.

          "used" sits UNDER the name rather than beside it: on the badge shared
          a line, the longest names ("Sunderland") lost characters to it, and a
          clipped team name on the pick screen is the one thing this change was
          meant to stop. */}
      <span className="min-w-0">
        <span className="block truncate">{displayTeamName(team.name)}</span>
        {!team.available && (
          <span className="block text-[9px] font-bold uppercase tracking-wide">
            used
          </span>
        )}
      </span>
      {selected && team.available ? (
        <span aria-hidden className="shrink-0 text-xs">
          ✓
        </span>
      ) : null}
    </button>
  );
}

export default function PickForm({
  entryId,
  roundId,
  fixtures,
  currentTeamId,
}: {
  entryId: string;
  roundId: string;
  fixtures: PickFixture[];
  currentTeamId: number | null;
}) {
  const [state, formAction, pending] = useActionState(submitPick, null);
  const [selected, setSelected] = useState<number | null>(currentTeamId);

  const selectedTeam = fixtures
    .flatMap((f) => [f.home, f.away])
    .find((t) => t.id === selected);
  const selectedName = selectedTeam ? displayTeamName(selectedTeam.name) : null;

  return (
    <form action={formAction} className="mt-4">
      <input type="hidden" name="entry_id" value={entryId} />
      <input type="hidden" name="round_id" value={roundId} />
      <input type="hidden" name="team_id" value={selected ?? ""} />

      {/* One row per fixture, in kickoff order — the matchday as it is played,
          not an alphabetical list of teams detached from their games. */}
      <ul className="divide-y divide-gray-200 rounded-md border border-gray-200">
        {fixtures.map((fixture) => (
          <li key={fixture.key} className="p-3">
            <div className="text-[11px] uppercase tracking-wide text-gray-400">
              {fixture.kickoff}
            </div>
            <div className="mt-1.5 flex items-stretch gap-2">
              <TeamButton
                team={fixture.home}
                selected={selected === fixture.home.id}
                disabled={pending}
                onSelect={() => setSelected(fixture.home.id)}
              />
              <span className="self-center text-xs font-medium text-gray-400">
                vs
              </span>
              <TeamButton
                team={fixture.away}
                selected={selected === fixture.away.id}
                disabled={pending}
                onSelect={() => setSelected(fixture.away.id)}
              />
            </div>
          </li>
        ))}
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
          : selectedName
            ? currentTeamId === null
              ? `Confirm ${selectedName}`
              : `Change to ${selectedName}`
            : "Pick a team"}
      </button>
      <p className="mt-2 text-center text-xs text-gray-500">
        You can change your pick any time before the deadline.
      </p>
    </form>
  );
}
