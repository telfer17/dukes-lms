"use client";

import { DEADLINE } from "@/lib/constants";
import { useNow } from "@/components/useDeadline";

const kickoffFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function remainingParts(now: number) {
  const ms = Math.max(0, DEADLINE.getTime() - now);
  const minutes = Math.floor(ms / 60_000);
  return {
    days: Math.floor(minutes / (60 * 24)),
    hours: Math.floor(minutes / 60) % 24,
    minutes: minutes % 60,
  };
}

export default function Countdown() {
  const now = useNow();
  const parts = now === null ? null : remainingParts(now);

  const units: { label: string; value: number | null }[] = [
    { label: "days", value: parts?.days ?? null },
    { label: "hours", value: parts?.hours ?? null },
    { label: "minutes", value: parts?.minutes ?? null },
  ];

  return (
    <div className="text-center">
      <div className="flex justify-center gap-4">
        {units.map((unit) => (
          <div
            key={unit.label}
            className="w-20 rounded-md border border-gray-200 bg-white p-3"
          >
            <div className="text-3xl font-bold tabular-nums">
              {unit.value ?? "–"}
            </div>
            <div className="text-xs uppercase tracking-wide text-gray-500">
              {unit.label}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-sm text-gray-500">
        Entries lock at the first kick-off —{" "}
        {kickoffFormatter.format(DEADLINE)} UK time.
      </p>
    </div>
  );
}
