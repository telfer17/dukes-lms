"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/action-state";

/**
 * Thin wrapper for the admin's small server-action forms: wires useActionState,
 * renders the ok/error line, and disables the button while pending.
 */
export default function ActionForm({
  action,
  submitLabel,
  pendingLabel,
  children,
  destructive = false,
  confirm,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
  pendingLabel?: string;
  children?: React.ReactNode;
  destructive?: boolean;
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form
      action={formAction}
      className="space-y-3"
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}

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
        className={`rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
          destructive
            ? "bg-red-600 hover:bg-red-700"
            : "bg-blue-600 hover:bg-blue-700"
        }`}
      >
        {pending ? (pendingLabel ?? "Working…") : submitLabel}
      </button>
    </form>
  );
}
