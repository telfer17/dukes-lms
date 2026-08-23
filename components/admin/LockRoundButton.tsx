"use client";

import { useActionState } from "react";
import { lockRound } from "@/app/admin/entrants/actions";

/**
 * The Lock round press (docs/LMS-RULES.md § The Lock button).
 *
 * Visible to the organiser and club admins AT ALL TIMES, deadline shown beside
 * it — because the deadline is the first kickoff of that matchday and therefore
 * moves every week. An organiser who has to remember whether it is Friday or
 * Saturday this time is an organiser who locks the wrong round.
 *
 * Before the deadline it warns and asks; after it, it just goes. That asymmetry
 * is the whole design: locking early is legitimate (everyone is in, the
 * organiser wants it done) but it also assigns teams to people who still had
 * time to choose, so it is never the quiet default.
 *
 * The button never disappears once pressed. Locking is idempotent, a round with
 * nothing to assign may still be locked, and a late entry can leave a blank
 * behind — so "lock again" has to stay available.
 */
export default function LockRoundButton({
  roundNumber,
  deadlineLabel,
  deadlinePassed,
  blanks,
  lockedAtLabel,
}: {
  roundNumber: number;
  /** This round's actual deadline, formatted — the first kickoff. */
  deadlineLabel: string;
  deadlinePassed: boolean;
  /** Active entries with no pick right now. */
  blanks: number;
  /** When it was locked, formatted, or null if it has not been. */
  lockedAtLabel: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    async () => lockRound(),
    null
  );

  const assigning =
    blanks === 0
      ? "Nobody is missing a pick, so nothing will be assigned."
      : `${blanks} ${blanks === 1 ? "entry has" : "entries have"} no pick and will be given a random team they haven't used.`;

  return (
    <form
      action={formAction}
      className="mt-3 rounded-md border border-gray-200 p-3"
      onSubmit={(e) => {
        // Only before the deadline. After it, this is the ordinary weekly press
        // and a confirm would just be noise.
        if (
          !deadlinePassed &&
          !window.confirm(
            `Picks for round ${roundNumber} lock at ${deadlineLabel} — that hasn't passed yet, so players could still be sending picks in.\n\n${assigning}\n\nLock round ${roundNumber} anyway?`
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            {lockedAtLabel ? `Round ${roundNumber} is locked` : `Lock round ${roundNumber}`}
          </p>
          <p className="mt-0.5 text-xs text-gray-600">
            {lockedAtLabel ? (
              <>Locked {lockedAtLabel}. </>
            ) : (
              <>
                {deadlinePassed ? "Deadline was" : "Picks lock at"}{" "}
                <strong>{deadlineLabel}</strong>.{" "}
              </>
            )}
            {assigning}
          </p>
        </div>
        <button
          type="submit"
          disabled={pending}
          className={`shrink-0 rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
            deadlinePassed
              ? "bg-blue-600 hover:bg-blue-700"
              : "bg-amber-600 hover:bg-amber-700"
          }`}
        >
          {pending
            ? "Locking…"
            : lockedAtLabel
              ? "Lock again"
              : deadlinePassed
                ? "Lock round"
                : "Lock early…"}
        </button>
      </div>

      {state && "error" in state && (
        <p
          role="alert"
          className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700"
        >
          {state.error}
        </p>
      )}
      {state && "ok" in state && (
        <p className="mt-2 rounded-md border border-green-200 bg-green-50 p-2 text-xs text-green-800">
          {state.ok}
        </p>
      )}
    </form>
  );
}
