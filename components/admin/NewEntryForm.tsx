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
  // Every field is CONTROLLED. React resets an uncontrolled form once a form
  // action resolves, which is right after a successful add but wrong for the
  // duplicate notice: the organiser would be asked "add another?" over a form
  // that had just emptied itself, and confirming would submit nothing. Holding
  // the values in state makes the confirmation resubmit exactly what was typed.
  const [name, setName] = useState("");
  const [clubContact, setClubContact] = useState("");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [paid, setPaid] = useState(false);

  // Set the moment the organiser changes WHO the entry is for, which retires
  // any duplicate confirmation on screen: it was given for the previous person.
  // Cleared again whenever a fresh answer comes back from the server.
  const [identityEdited, setIdentityEdited] = useState(false);

  // Clearing on success is what React's own form reset used to do for these
  // fields; now that they are controlled it has to be done deliberately.
  //
  // Adjusted during render rather than in an effect — React's documented
  // pattern for "reset some state when something changes". An effect would
  // paint the just-added entry's details once and then blank them, and would
  // cost an extra render to do it. The person picker and the newcomer flag are
  // left alone, exactly as before: they were already controlled, so the old
  // reset never touched them either.
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    setIdentityEdited(false);
    if (state && "ok" in state) {
      setName("");
      setClubContact("");
      setPhone("");
      setAmount("");
      setPaid(false);
    }
  }

  const expected = isNewcomer ? newcomerPence : returningPence;
  const reusingPerson = participantId !== "";
  // A soft stop, not a failure: the same person may legitimately hold several
  // entries. While the notice is up, the token below rides along with the next
  // submit and the action goes ahead — one extra confirmation, no block.
  //
  // It disappears on a successful add, and also the instant the organiser edits
  // the person, name or phone: a confirmation given for David Smith must not
  // quietly wave through whoever the form says now. The server re-checks the
  // token against what was actually submitted regardless, so this is the
  // courtesy half of that rule, not the enforcement.
  const duplicate =
    !identityEdited && state && "notice" in state ? state : null;

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
            onChange={(e) => {
              setParticipantId(e.target.value);
              setIdentityEdited(true);
            }}
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
            <input
              id="name"
              name="name"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setIdentityEdited(true);
              }}
              className={input}
            />
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
              value={clubContact}
              onChange={(e) => setClubContact(e.target.value)}
              className={input}
            />
          </div>

          <div>
            <label htmlFor="phone" className="block font-medium">
              Phone <span className="font-normal text-gray-500">(optional)</span>
            </label>
            <input
              id="phone"
              name="phone"
              type="tel"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setIdentityEdited(true);
              }}
              className={input}
            />
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
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={input}
        />
        <p className="mt-1 text-xs text-gray-500">
          Expected {formatPence(expected)}. Leave blank to use it. What was
          actually paid is what gets recorded.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          name="paid"
          checked={paid}
          onChange={(e) => setPaid(e.target.checked)}
        />
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

      {duplicate && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">{duplicate.notice}</p>
          <p className="mt-1 text-amber-800">
            Multiple entries are allowed as long as a full fee is paid for each.
            Press again to add it, or change the details above.
          </p>
          {/* Names the person confirmed, not merely "yes". Change the person,
              name or phone and this token stops matching, so the server asks
              again instead of taking a confirmation meant for someone else. */}
          <input
            type="hidden"
            name="confirm_duplicate"
            value={duplicate.confirm}
          />
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className={`w-full rounded-md px-6 py-3 font-semibold text-white disabled:opacity-50 ${
          duplicate
            ? "bg-amber-600 hover:bg-amber-700"
            : "bg-blue-600 hover:bg-blue-700"
        }`}
      >
        {pending
          ? "Adding…"
          : duplicate
            ? "Yes — add another entry"
            : "Add entry"}
      </button>
    </form>
  );
}
