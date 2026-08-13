"use client";

import { useRef, useState, useTransition } from "react";
import { setResult } from "@/app/admin/results/actions";
import { validateResult } from "@/lib/admin-results";
import { TeamLabel } from "@/components/TeamFlag";

type Props = {
  matchId: number;
  grp: string;
  home: string;
  away: string;
  time: string;
  initialHome: string;
  initialAway: string;
};

export default function ResultRow({
  matchId,
  grp,
  home,
  away,
  time,
  initialHome,
  initialAway,
}: Props) {
  const [homeVal, setHomeVal] = useState(initialHome);
  const [awayVal, setAwayVal] = useState(initialAway);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [pending, startTransition] = useTransition();
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Compare against props: after a save revalidates the page, fresh props
  // make the row read as unchanged again.
  const changed = homeVal !== initialHome || awayVal !== initialAway;
  const hasResult = initialHome !== "" && initialAway !== "";

  function setScore(side: "home" | "away", value: string) {
    if (!/^\d{0,2}$/.test(value)) return;
    (side === "home" ? setHomeVal : setAwayVal)(value);
    setStatus("idle");
  }

  function save(homeRaw: string, awayRaw: string) {
    const validation = validateResult(homeRaw, awayRaw);
    if (!validation.ok) {
      setErrorMsg(validation.error);
      setStatus("error");
      return;
    }
    startTransition(async () => {
      try {
        await setResult(matchId, homeRaw, awayRaw);
        setStatus("saved");
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setStatus("idle"), 2_500);
      } catch {
        setErrorMsg("Save failed — try again.");
        setStatus("error");
      }
    });
  }

  return (
    <div className={hasResult ? "border-l-2 border-green-500 bg-green-50/40" : ""}>
      <div className="w-full p-3">
        <div className="text-xs text-gray-400">
          <span className="tabular-nums">{time}</span> · Group {grp}
        </div>
        <div className="mt-1 flex w-full items-center gap-2">
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere] text-right text-sm font-medium">
            <TeamLabel team={home} flagSide="right" />
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={homeVal}
            disabled={pending}
            onChange={(e) => setScore("home", e.target.value)}
            aria-label={`${home} score`}
            className="w-12 shrink-0 rounded border border-gray-300 p-1 text-center disabled:bg-gray-100"
          />
          <span className="shrink-0 text-gray-400">–</span>
          <input
            type="text"
            inputMode="numeric"
            value={awayVal}
            disabled={pending}
            onChange={(e) => setScore("away", e.target.value)}
            aria-label={`${away} score`}
            className="w-12 shrink-0 rounded border border-gray-300 p-1 text-center disabled:bg-gray-100"
          />
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere] text-sm font-medium">
            <TeamLabel team={away} flagSide="left" />
          </span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            disabled={!changed || pending}
            onClick={() => save(homeVal, awayVal)}
            className="rounded-md bg-blue-600 px-3 py-1 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
          >
            Save
          </button>
          <button
            type="button"
            disabled={pending || (homeVal === "" && awayVal === "")}
            onClick={() => {
              setHomeVal("");
              setAwayVal("");
              save("", "");
            }}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-40"
          >
            Clear
          </button>
          {status === "saved" && (
            <span className="text-xs font-medium text-green-700">Saved ✓</span>
          )}
          {status === "error" && (
            <span className="text-xs text-red-600">{errorMsg}</span>
          )}
        </div>
      </div>
    </div>
  );
}
