"use client";

import Link from "next/link";
import { useAfterDeadline } from "@/components/useDeadline";

export default function FindEntryButton() {
  const locked = useAfterDeadline();
  return (
    <Link
      href="/find"
      className="rounded-md border-2 border-blue-600 px-8 py-3 text-lg font-semibold text-blue-600 hover:bg-blue-50"
    >
      {locked ? "View my entry" : "Edit my entry"}
    </Link>
  );
}
