"use client";

import Link from "next/link";
import { useActionState } from "react";
import { createEntrant } from "./actions";

export default function NewEntrantPage() {
  const [state, formAction, pending] = useActionState(createEntrant, null);

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <Link
        href="/admin/entrants"
        className="text-sm text-blue-600 hover:underline"
      >
        ← Back to entrants
      </Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">
        Add paper entrant
      </h1>
      <form action={formAction} className="mt-6 space-y-4">
        <div>
          <label htmlFor="name" className="block font-medium">
            Name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            className="mt-1 w-full rounded-md border border-gray-300 p-2"
          />
        </div>

        <div>
          <label htmlFor="club_contact" className="block font-medium">
            Club contact
          </label>
          <input
            id="club_contact"
            name="club_contact"
            type="text"
            required
            className="mt-1 w-full rounded-md border border-gray-300 p-2"
          />
        </div>

        <div>
          <label htmlFor="phone" className="block font-medium">
            Phone{" "}
            <span className="font-normal text-gray-500">(optional)</span>
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            className="mt-1 w-full rounded-md border border-gray-300 p-2"
          />
        </div>

        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" name="paid" />
          Paid
        </label>

        {state?.error && (
          <p
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? "Adding…" : "Add entrant & enter predictions"}
        </button>
      </form>
    </main>
  );
}
