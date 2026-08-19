import type { ConcludedSummary } from "@/lib/concluded";

// The one treatment for "this competition is over", shared by the homepage and
// /leaderboard so the two screens cannot tell the story two ways.
//
// A win is gold: the crown, the name, the pot. A rollover is not — nobody won,
// and dressing "everyone's out" up in trophy colours would read as a result.
// It gets the plain panel and the pot's forwarding address instead.
//
// Server component: it renders a summary that was already assembled server-side
// (lib/concluded.ts) and holds no state. Nothing here is interactive.

export default function ConcludedPanel({
  summary,
  className = "",
}: {
  summary: ConcludedSummary;
  className?: string;
}) {
  const { status, winnerName, potLabel, winnerEntryCount } = summary;

  if (status === "won") {
    return (
      <div
        className={`rounded-lg border border-amber-300 bg-amber-50 p-5 text-center ${className}`}
      >
        <p className="text-xs font-bold uppercase tracking-wide text-amber-700">
          Competition complete
        </p>
        {winnerName ? (
          <p className="mt-2 text-2xl font-bold text-amber-900 sm:text-3xl">
            <span aria-hidden>🏆 </span>
            {winnerName} is the Last Man Standing
          </p>
        ) : (
          // The name comes from participants, which needs the server client. If
          // that read failed, the win is still true and still worth saying —
          // only the name is missing, and pretending otherwise would be worse.
          <p className="mt-2 text-2xl font-bold text-amber-900 sm:text-3xl">
            <span aria-hidden>🏆 </span>
            We have a Last Man Standing
          </p>
        )}
        {potLabel && (
          <p className="mt-2 text-sm font-semibold text-amber-800">
            Took the {potLabel} pot.
          </p>
        )}
        {/* One person, one crown. Multi-entry is ordinary — the entries run
            independently — but it never means two prizes, and the winner is
            named once above however many entries they finished holding. */}
        {winnerEntryCount > 1 && (
          <p className="mt-1 text-sm text-amber-800">
            Finished holding {winnerEntryCount} surviving entries — still one
            pot, one winner.
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border border-gray-300 bg-gray-50 p-5 text-center ${className}`}
    >
      <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
        Competition complete
      </p>
      <p className="mt-2 text-xl font-bold text-gray-900 sm:text-2xl">
        Everyone&apos;s out — the pot rolls over to the next competition
      </p>
      {potLabel && (
        <p className="mt-2 inline-block rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-900">
          {potLabel} carries forward
        </p>
      )}
      <p className="mt-3 text-sm text-gray-600">
        A new competition starts soon — your club contact will know when it
        opens.
      </p>
    </div>
  );
}
