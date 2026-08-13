"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Entry = { id: string; name: string };

export default function FindEntryForm() {
  const router = useRouter();
  const navTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any pending recovery timeout when navigation succeeds (unmount).
  useEffect(
    () => () => {
      if (navTimeout.current) clearTimeout(navTimeout.current);
    },
    []
  );
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotFound(false);
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
      const { entries: found } = (await res.json()) as { entries: Entry[] };
      if (found.length === 0) {
        setNotFound(true);
        setSubmitting(false);
        return;
      }
      if (found.length === 1) {
        // Leave the button disabled while navigating, but recover if the
        // navigation stalls so the user isn't stuck on a dead button.
        navTimeout.current = setTimeout(() => setSubmitting(false), 5_000);
        router.push(`/predict/${found[0].id}`);
        return;
      }
      setEntries(found);
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
            // Digits only, capped at 11 — same as the Enter form.
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

      {notFound && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          No entry found with that number.{" "}
          <Link href="/enter" className="font-semibold underline">
            Enter the competition
          </Link>
        </p>
      )}

      {entries.length > 1 && (
        <div className="rounded-md border border-gray-200 p-3">
          <p className="text-sm font-medium">
            You have {entries.length} entries — pick one to resume:
          </p>
          <ul className="mt-2 space-y-1">
            {entries.map((entry) => (
              <li key={entry.id}>
                <Link
                  href={`/predict/${entry.id}`}
                  className="text-blue-600 underline hover:text-blue-800"
                >
                  {entry.name}
                </Link>
              </li>
            ))}
          </ul>
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
