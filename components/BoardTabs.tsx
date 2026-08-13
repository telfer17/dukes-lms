"use client";

import { useState } from "react";

/** Still-in / out toggle, so a long field doesn't bury the survivors. */
export default function BoardTabs({
  active,
  out,
}: {
  active: React.ReactNode;
  out: React.ReactNode;
}) {
  const [tab, setTab] = useState<"active" | "out">("active");

  return (
    <div className="mt-6">
      <div className="flex gap-1 rounded-md bg-gray-100 p-1 text-sm font-medium">
        {(["active", "out"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex-1 rounded px-3 py-1.5 capitalize transition ${
              tab === key ? "bg-white shadow-sm" : "text-gray-500 hover:text-gray-800"
            }`}
          >
            {key === "active" ? "Still in" : "Out"}
          </button>
        ))}
      </div>
      <div className="mt-4">{tab === "active" ? active : out}</div>
    </div>
  );
}
