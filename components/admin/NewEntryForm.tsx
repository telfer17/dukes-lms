"use client";

import { useActionState, useState } from "react";
import { createEntry } from "@/app/admin/entrants/actions";
import { formatPence } from "@/lib/competition";

type Person = { id: string; name: string; club_contact: string | null };

const input = "mt-1 w-full rounded-md border border-gray-300 p-2 text-sm";

export default function NewEntryForm({
  people,
  returningPence,
  newcomerPence,
}: {
  people: Person[];
  returningPence: number;
  newcomerPence: number;
}) {
  const [state, formAction, pending] = useActionState(createEntry, null);
  const [participantId, setParticipantId] = useState("");
  const [isNewcomer, setIsNewcomer] = useState(false);

  const expected = isNewcomer ? newcomerPence : returningPence;
  const reusingPerson = participantId !== "";

  return (
    <form action={formAction} className="mt-6 space-y-4">
      {people.length > 0 && (
        <div>
          <label htmlFor="participant_id" className="block font-medium">
            Existing person
          </label>
          <select
            id="participant_id"
            name="participant_id"
            value={participantId}
            onChange={(e) => setParticipantId(e.target.value)}
            className={input}
          >
            <option value="">— new person —</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.club_contact ? ` (via ${p.club_contact})` : ""}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">
            Pick someone here to give them a SECOND entry — allowed, as long as
            they pay a full fee for it.
          </p>
        </div>
      )}

      {!reusingPerson && (
        <>
          <div>
            <label htmlFor="name" className="block font-medium">
              Name
            </label>
            <input id="name" name="name" type="text" className={input} />
            <p className="mt-1 text-xs text-gray-500">
              For a second entry on paper, name it so they can tell them apart —
              e.g. &quot;David Smith 2&quot;.
            </p>
          </div>

          <div>
            <label htmlFor="club_contact" className="block font-medium">
              Club contact
            </label>
            <input
              id="club_contact"
              name="club_contact"
              type="text"
              className={input}
            />
          </div>

          <div>
            <label htmlFor="phone" className="block font-medium">
              Phone <span className="font-normal text-gray-500">(optional)</span>
            </label>
            <input id="phone" name="phone" type="tel" className={input} />
          </div>
        </>
      )}

      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          name="is_newcomer"
          checked={isNewcomer}
          onChange={(e) => setIsNewcomer(e.target.checked)}
        />
        Newcomer (was not in the previous competition)
      </label>

      <div>
        <label htmlFor="amount_paid_pounds" className="block font-medium">
          Amount paid (£)
        </label>
        <input
          id="amount_paid_pounds"
          name="amount_paid_pounds"
          type="number"
          min={0}
          step="0.01"
          placeholder={(expected / 100).toFixed(2)}
          className={input}
        />
        <p className="mt-1 text-xs text-gray-500">
          Expected {formatPence(expected)}. Leave blank to use it. What was
          actually paid is what gets recorded.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="paid" />
        Paid
      </label>

      {state && "error" in state && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {state.error}
        </p>
      )}
      {state && "ok" in state && (
        <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          {state.ok}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {pending ? "Adding…" : "Add entry"}
      </button>
    </form>
  );
}
