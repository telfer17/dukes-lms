"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function EnterForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [clubContact, setClubContact] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/participants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, club_contact: clubContact, phone }),
      });
      if (res.status === 403) {
        setError("Entries are closed.");
        setSubmitting(false);
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Something went wrong — please try again.");
        setSubmitting(false);
        return;
      }
      const { id } = await res.json();
      // Leave the button disabled while navigating.
      router.push(`/predict/${id}`);
    } catch {
      setError("Something went wrong — please try again.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 space-y-6 text-left">
      <p className="rounded-md bg-gray-50 p-3 text-sm text-gray-600">
        Taking more than one shot? Alter so we can tell them apart — e.g.
        &quot;John Smith&quot;, &quot;John Smith (2)&quot;.
      </p>

      <div>
        <label htmlFor="name" className="block font-medium">
          Name
        </label>
        <input
          id="name"
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 p-2"
        />
        <p className="mt-1 text-sm text-gray-500">
          This is what appears on the leaderboard.
        </p>
      </div>

      <div>
        <label htmlFor="club-contact" className="block font-medium">
          Who at the club are you entering through?
        </label>
        <input
          id="club-contact"
          type="text"
          required
          value={clubContact}
          onChange={(e) => setClubContact(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 p-2"
        />
        <p className="mt-1 text-sm text-gray-500">
          The player or member you&apos;ll pay — used to track entries and
          payment.
        </p>
      </div>

      <div>
        <label htmlFor="phone" className="block font-medium">
          Contact number
        </label>
        <input
          id="phone"
          type="tel"
          inputMode="numeric"
          required
          pattern="0[0-9]{10}"
          title="11-digit UK number starting with 0"
          value={phone}
          onChange={(e) =>
            // Digits only, capped at 11.
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

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {submitting ? "Entering…" : "Enter the competition"}
      </button>
    </form>
  );
}
