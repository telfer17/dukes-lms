"use client";

import { useActionState, useState, useTransition } from "react";
import {
  buyBackEntry,
  deleteEntry,
  setEntryPaid,
  setPickForEntry,
} from "@/app/admin/entrants/actions";
import { formatPence } from "@/lib/competition";
import type { EntryStatus } from "@/lib/lms";
import { teamColors } from "@/lib/team-colors";
import { displayTeamName } from "@/lib/team-names";

export type SelectableTeam = { id: number; name: string };

/** What this entry picked for the current round. */
export type CurrentPick = { teamName: string; autoAssigned: boolean };

/**
 * A live buy-back offer for this entry: it went out in round 1, 2 or 3, the
 * window for the next round is still open, and it has not used it.
 *
 * Null whenever there is no offer — which is most of the time, and includes
 * every refusal. A row does not explain why an entry CAN'T buy back: the fold
 * these rows live in is already long, and the reason is only worth reading if
 * somebody presses a button that is no longer there, which is exactly when the
 * server action quotes it back.
 */
export type BuybackControl = {
  /** The round it would come back for. */
  roundNumber: number;
  /** What it costs, formatted — £10. */
  priceLabel: string;
};

/**
 * The picker itself. Null whenever a pick cannot be entered right now — no open
 * round, no fixtures loaded, the round's state could not be read, or the entry
 * is out. The pick STATE is still shown in those cases when it is known; only
 * the control disappears.
 */
export type PickControl = {
  /** The round this row was RENDERED for — compared server-side, never used
   *  to choose which round to write. */
  roundId: string;
  currentTeamId: number | null;
  options: SelectableTeam[];
  deadlinePassed: boolean;
};

const STATUS_TINT: Record<EntryStatus, string> = {
  active: "text-green-700",
  eliminated: "text-gray-400",
  winner: "text-amber-600",
};

/**
 * One entry on /admin/entrants: who they are, whether they have paid, what they
 * picked this round, and the picker to set or change it. The three things the
 * organiser does on a Saturday, one line each, in one place.
 *
 * A select rather than 10 colour buttons per row: this is used standing in a
 * pub with 50 entries on screen, and the same team list repeated fifty times
 * would be unusable. The colour lives on the current-pick chip, which is what
 * the organiser is scanning for.
 */
export default function AdminEntryRow({
  id,
  name,
  clubContact,
  paid,
  amountPaidPence,
  expectedPence,
  amountMismatch,
  isNewcomer,
  status,
  roundKnown,
  currentPick,
  picker,
  buyback = null,
}: {
  id: string;
  name: string;
  clubContact: string;
  paid: boolean;
  amountPaidPence: number;
  expectedPence: number;
  amountMismatch: boolean;
  isNewcomer: boolean;
  status: EntryStatus;
  /** False when this round's picks are unknown — no round, or the read failed.
   *  Then the row says nothing about picking rather than guessing "no pick". */
  roundKnown: boolean;
  currentPick: CurrentPick | null;
  picker: PickControl | null;
  /** A live buy-back offer, or null — see BuybackControl. */
  buyback?: BuybackControl | null;
}) {
  const [pending, startTransition] = useTransition();
  const [rowError, setRowError] = useState("");
  const [pickState, pickAction, pickPending] = useActionState(
    setPickForEntry,
    null
  );

  // "Alice: Arsenal saved." must not still be sitting there once the organiser
  // has moved the select to Chelsea — read at a glance, that says Chelsea was
  // saved when nothing was. useActionState has no reset, so the message is
  // suppressed from the moment the selection changes until a fresh answer comes
  // back. Adjusted during render, the same pattern NewEntryForm uses to clear
  // itself: an effect would paint the stale line once before removing it.
  const [selectionChanged, setSelectionChanged] = useState(false);
  const [seenPickState, setSeenPickState] = useState(pickState);
  if (pickState !== seenPickState) {
    setSeenPickState(pickState);
    setSelectionChanged(false);
  }
  const pickMessage = selectionChanged ? null : pickState;

  /** Run a row action and surface any failure next to the row. */
  function run(action: () => Promise<{ ok: true } | { error: string }>) {
    setRowError("");
    startTransition(async () => {
      const result = await action();
      if ("error" in result) setRowError(result.error);
    });
  }

  const picked = roundKnown && currentPick !== null;
  const needsPick = roundKnown && currentPick === null && status === "active";
  const { primary, secondary } = teamColors(currentPick?.teamName ?? null);

  return (
    <li className={`p-3 ${needsPick ? "bg-amber-50/60" : ""}`}>
      {/* ---- Line 1: who, and what they picked ---- */}
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">
          {name}
          {isNewcomer && (
            <span className="ml-1.5 rounded bg-blue-100 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700">
              new
            </span>
          )}
        </p>
        {picked ? (
          <span
            className="shrink-0 rounded px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ring-black/10"
            style={{ backgroundColor: primary, color: secondary }}
          >
            {displayTeamName(currentPick.teamName)}
            {currentPick.autoAssigned && " (auto)"}
          </span>
        ) : needsPick ? (
          <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-amber-700">
            no pick yet
          </span>
        ) : (
          <span
            className={`shrink-0 text-xs font-semibold uppercase tracking-wide ${STATUS_TINT[status]}`}
          >
            {status}
          </span>
        )}
      </div>

      {/* ---- Line 2: the picker ---- */}
      {picker && (
        <form
          action={pickAction}
          className="mt-2 flex items-center gap-2"
          onSubmit={(e) => {
            // The organiser override is deliberate, so it asks once. Only after
            // the deadline — before it, this is an ordinary edit.
            if (
              picker.deadlinePassed &&
              !window.confirm(
                `The deadline for this round has PASSED. Enter a pick for ${name} anyway?`
              )
            ) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="entry_id" value={id} />
          <input type="hidden" name="round_id" value={picker.roundId} />
          <select
            name="team_id"
            defaultValue={picker.currentTeamId ?? ""}
            onChange={() => setSelectionChanged(true)}
            disabled={pickPending}
            className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-2.5 text-sm disabled:opacity-50"
            aria-label={`Pick for ${name}`}
          >
            <option value="">— choose a team —</option>
            {picker.options.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={pickPending}
            className={`shrink-0 rounded-md px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50 ${
              picker.deadlinePassed
                ? "bg-amber-600 hover:bg-amber-700"
                : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {pickPending ? "…" : picked ? "Change" : "Save"}
          </button>
        </form>
      )}

      {/* ---- Buy-back ----
          Only ever rendered where the rules say the offer is live (the page
          asks lib/lms.ts, and the server action asks it again on press). It is
          money changing hands and it cannot be undone from this screen, so it
          confirms first and says the price out loud. */}
      {buyback && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2">
          <p className="min-w-0 text-xs text-amber-900">
            <strong>Buy back in</strong> for round {buyback.roundNumber} —{" "}
            {buyback.priceLabel}. Used teams stay used.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (
                window.confirm(
                  `Buy ${name} back in for round ${buyback.roundNumber}? This records ${buyback.priceLabel} paid and puts them back in the competition. Their used teams — including the one that put them out — stay used.`
                )
              ) {
                run(() => buyBackEntry(id));
              }
            }}
            className="shrink-0 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {pending ? "…" : `Buy back (${buyback.priceLabel})`}
          </button>
        </div>
      )}

      {/* ---- Line 3: money, and the row's own controls ---- */}
      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
        <label className="flex shrink-0 items-center gap-1.5 py-1 font-medium">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={paid}
            disabled={pending}
            onChange={() => run(() => setEntryPaid(id, !paid, expectedPence))}
          />
          Paid
        </label>
        <p className="min-w-0 flex-1 truncate text-gray-500">
          {paid ? formatPence(amountPaidPence) : "unpaid"}
          {amountMismatch && (
            <span className="ml-1 font-semibold text-amber-700">
              (expected {formatPence(expectedPence)})
            </span>
          )}
          {clubContact && ` · via ${clubContact}`}
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (window.confirm(`Delete this entry for ${name}?`)) {
              run(() => deleteEntry(id));
            }
          }}
          className="shrink-0 py-1 font-medium text-red-600 hover:underline disabled:opacity-50"
        >
          Delete
        </button>
      </div>

      {rowError && (
        <p role="alert" className="mt-1.5 text-xs font-medium text-red-600">
          {rowError}
        </p>
      )}
      {pickMessage && "error" in pickMessage && (
        <p role="alert" className="mt-1.5 text-xs text-red-600">
          {pickMessage.error}
        </p>
      )}
      {pickMessage && "ok" in pickMessage && (
        <p className="mt-1.5 text-xs font-medium text-green-700">
          {pickMessage.ok}
        </p>
      )}
    </li>
  );
}
