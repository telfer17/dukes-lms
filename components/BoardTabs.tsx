"use client";

import { useState } from "react";

/**
 * Still-in / out toggle, so a long field doesn't bury the survivors.
 *
 * The labels and the opening tab are props because a finished competition is a
 * different sentence: "Still in" is a lie once it is over, and on a rollover
 * that tab is empty — the record everyone came for is on the other one, so it
 * opens there.
 */
export default function BoardTabs({
  active,
  out,
  activeLabel = "Still in",
  outLabel = "Out",
  initialTab = "active",
}: {
  active: React.ReactNode;
  out: React.ReactNode;
  activeLabel?: string;
  outLabel?: string;
  initialTab?: "active" | "out";
}) {
  const [tab, setTab] = useState<"active" | "out">(initialTab);

  return (
    <div className="mt-6">
      <div className="flex gap-1 rounded-md bg-gray-100 p-1 text-sm font-medium">
        {(["active", "out"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
            className={`flex-1 rounded px-3 py-1.5 transition ${
              tab === key ? "bg-white shadow-sm" : "text-gray-500 hover:text-gray-800"
            }`}
          >
            {key === "active" ? activeLabel : outLabel}
          </button>
        ))}
      </div>
      <div className="mt-4">{tab === "active" ? active : out}</div>
    </div>
  );
}
