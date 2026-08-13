"use client";

import { useState, useTransition } from "react";
import { deleteEntry, setEntryPaid } from "@/app/admin/entrants/actions";
import { formatPence } from "@/lib/competition";
import type { EntryStatus } from "@/lib/lms";

const STATUS_TINT: Record<EntryStatus, string> = {
  active: "text-green-700",
  eliminated: "text-gray-400",
  winner: "text-amber-600",
};

export default function EntryRow({
  id,
  name,
  paid,
  amountPaidPence,
  expectedPence,
  amountMismatch,
  isNewcomer,
  status,
}: {
  id: string;
  name: string;
  paid: boolean;
  amountPaidPence: number;
  expectedPence: number;
  amountMismatch: boolean;
  isNewcomer: boolean;
  status: EntryStatus;
}) {
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  const pickPath = `/pick/${id}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}${pickPath}`
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Clipboard blocked — the link is on screen to copy by hand.
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {name}
          {isNewcomer && (
            <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700">
              newcomer
            </span>
          )}
        </p>
        <p className={`text-xs ${STATUS_TINT[status]}`}>
          {status}
          {paid ? ` · paid ${formatPence(amountPaidPence)}` : " · unpaid"}
          {amountMismatch && (
            <span className="ml-1 font-semibold text-amber-700">
              (expected {formatPence(expectedPence)})
            </span>
          )}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={copyLink}
          title={pickPath}
          className="text-xs font-medium text-blue-600 hover:underline"
        >
          {copied ? "Copied ✓" : "Copy pick link"}
        </button>

        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={paid}
            disabled={pending}
            onChange={() =>
              startTransition(() => setEntryPaid(id, !paid, expectedPence))
            }
          />
          Paid
        </label>

        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (window.confirm(`Delete this entry for ${name}?`)) {
              startTransition(() => deleteEntry(id));
            }
          }}
          className="text-sm font-medium text-red-600 hover:underline disabled:opacity-50"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
