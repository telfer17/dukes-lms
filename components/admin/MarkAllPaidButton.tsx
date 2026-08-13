"use client";

import { useState, useTransition } from "react";
import { markGroupPaid } from "@/app/admin/entrants/actions";

export default function MarkAllPaidButton({
  clubContact,
}: {
  clubContact: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  return (
    <div className="text-right">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError("");
          startTransition(async () => {
            const result = await markGroupPaid(clubContact);
            if ("error" in result) setError(result.error);
          });
        }}
        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
      >
        {pending ? "Marking…" : "Mark all paid"}
      </button>
      {error && (
        <p role="alert" className="mt-1 text-xs font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
