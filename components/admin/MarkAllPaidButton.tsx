"use client";

import { useTransition } from "react";
import { markGroupPaid } from "@/app/admin/entrants/actions";

export default function MarkAllPaidButton({
  clubContact,
}: {
  clubContact: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => markGroupPaid(clubContact))}
      className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
    >
      {pending ? "Marking…" : "Mark all paid"}
    </button>
  );
}
