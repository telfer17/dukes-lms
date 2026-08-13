"use client";

import { useNow } from "@/components/useNow";

/** Live "time until the next deadline", ticking off the shared 1-second clock. */
export default function DeadlineCountdown({ deadline }: { deadline: string }) {
  const now = useNow();
  const target = Date.parse(deadline);

  if (now === null) {
    // SSR / first paint — render the static label so hydration matches.
    return <span className="tabular-nums">—</span>;
  }

  const ms = target - now;
  if (ms <= 0) return <span className="font-semibold">locked</span>;

  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / (60 * 24));
  const hours = Math.floor(minutes / 60) % 24;
  const mins = minutes % 60;

  return (
    <span className="tabular-nums">
      {days > 0 && `${days}d `}
      {(days > 0 || hours > 0) && `${hours}h `}
      {mins}m
    </span>
  );
}
