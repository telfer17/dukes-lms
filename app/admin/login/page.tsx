"use client";

import { useActionState } from "react";
import { login } from "./actions";

export default function AdminLoginPage() {
  const [state, formAction, pending] = useActionState(login, null);

  return (
    <main className="mx-auto flex max-w-sm flex-col justify-center px-4 py-24">
      <h1 className="text-center text-2xl font-bold tracking-tight">
        Admin login
      </h1>
      <form action={formAction} className="mt-8 space-y-4">
        <div>
          <label htmlFor="password" className="block font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoFocus
            className="mt-1 w-full rounded-md border border-gray-300 p-2"
          />
        </div>

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
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
