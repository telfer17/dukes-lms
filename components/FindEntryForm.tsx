"use client";

import Link from "next/link";
import { useState } from "react";

type FoundEntry = {
  entryId: string;
  name: string;
  status: "active" | "eliminated" | "winner";
};

type Response =
  | { entries: FoundEntry[]; competition?: string; reason?: never }
  | { entries: []; reason: "no_competition" | "no_entries"; competition?: never };

const STATUS_LABEL: Record<FoundEntry["status"], string> = {
  active: "still in",
  eliminated: "out",
  winner: "winner",
};

export default function FindEntryForm() {
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<"no_competition" | "no_entries" | null>(
    null
  );
  const [competition, setCompetition] = useState<string | null>(null);
  const [entries, setEntries] = useState<FoundEntry[]>([]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setReason(null);
    setCompetition(null);
    setEntries([]);
    setSubmitting(true);
    try {
      const res = await fetch("/api/find-entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Something went wrong — please try again.");
        setSubmitting(false);
        return;
      }
      const data = (await res.json()) as Response;
      if (data.entries.length === 0) {
        setReason(data.reason ?? "no_entries");
        setSubmitting(false);
        return;
      }
      setEntries(data.entries);
      setCompetition(data.competition ?? null);
      setSubmitting(false);
    } catch {
      setError("Something went wrong — please try again.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 space-y-6 text-left">
      <div>
        <label htmlFor="find-phone" className="block font-medium">
          Phone number
        </label>
        <input
          id="find-phone"
          type="tel"
          inputMode="numeric"
          required
          pattern="0[0-9]{10}"
          title="11-digit UK number starting with 0"
          value={phone}
          onChange={(e) =>
            // Digits only, capped at 11 — same as the admin entry form.
            setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))
          }
          className="mt-1 w-full rounded-md border border-gray-300 p-2"
        />
        <p className="mt-1 text-sm text-gray-500">
          11-digit UK mobile, e.g. 07123456789
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}

      {/* Two different honest answers, not one vague "not found". */}
      {reason === "no_competition" && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          There&apos;s no competition running at the moment. Your club contact
          will know when the next one starts.
        </p>
      )}

      {reason === "no_entries" && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          No entry found with that number in the current competition. Entries
          are added by your club contact — have a word with them to get signed
          up.
        </p>
      )}

      {entries.length > 0 && (
        <div className="rounded-md border border-gray-200 p-3">
          <p className="text-sm font-medium">
            {entries.length === 1
              ? "Found your entry:"
              : `You have ${entries.length} entries — each one is separate:`}
          </p>
          {competition && (
            <p className="mt-1 text-xs text-gray-500">{competition}</p>
          )}
          <ul className="mt-3 space-y-2">
            {entries.map((entry) => (
              <li key={entry.entryId}>
                <Link
                  href={`/pick/${entry.entryId}`}
                  className="flex items-center justify-between gap-3 rounded-md border border-gray-200 p-3 text-sm hover:bg-gray-50"
                >
                  <span className="min-w-0 flex-1 truncate font-medium text-blue-600 underline">
                    {entry.name}
                  </span>
                  <span
                    className={
                      entry.status === "eliminated"
                        ? "text-red-600"
                        : entry.status === "winner"
                          ? "text-amber-700"
                          : "text-green-700"
                    }
                  >
                    {STATUS_LABEL[entry.status]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-gray-500">
            These links are personal to your entries — don&apos;t share them.
          </p>
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {submitting ? "Searching…" : "Find my entry"}
      </button>
    </form>
  );
}
