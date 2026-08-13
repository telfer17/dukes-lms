"use client";

import Link from "next/link";
import { useAfterDeadline } from "@/components/useDeadline";

// Pre-deadline: the two ways to enter. Post-deadline: entry is closed, but the
// blank sheets stay downloadable so spectators can tally scores by hand.
export default function EnterOptions() {
  const closed = useAfterDeadline();

  if (closed) {
    return (
      <div className="mt-6 rounded-md border border-gray-200 p-5">
        <h3 className="font-semibold">Track the scores yourself</h3>
        <p className="mt-2 text-sm text-gray-600">
          Entries are closed, but you can still download a blank prediction
          sheet to follow the games and tally your points by hand.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <a
            href="/prediction-sheet.pdf"
            download
            className="inline-block rounded-md bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700"
          >
            Download the prediction sheet (PDF)
          </a>
          <a
            href="/prediction-sheet.xlsx"
            download
            className="inline-block rounded-md bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700"
          >
            Download as Excel (.xlsx)
          </a>
        </div>
      </div>
    );
  }

  return (
    <>
      <h3 className="mt-6 text-lg font-semibold">Two ways to enter</h3>
      <div className="mt-3 grid gap-6 sm:grid-cols-2">
        <div className="rounded-md border border-gray-200 p-5">
          <h3 className="font-semibold">Enter online</h3>
          <p className="mt-2 text-sm text-gray-600">
            Hit Enter, add your details, and fill in your score predictions for
            all 72 group games before the first kick-off.
          </p>
          <Link
            href="/enter"
            className="mt-4 inline-block rounded-md bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700"
          >
            Enter now
          </Link>
        </div>

        <div className="rounded-md border border-gray-200 p-5">
          <h3 className="font-semibold">Enter on paper</h3>
          <p className="mt-2 text-sm text-gray-600">
            Print the PDF and fill it in by hand, or fill in the Excel version on
            a computer — then send your completed sheet to your club contact,
            who&apos;ll pass it on to be added to the leaderboard for you.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a
              href="/prediction-sheet.pdf"
              download
              className="inline-block rounded-md bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700"
            >
              Download the prediction sheet (PDF)
            </a>
            <a
              href="/prediction-sheet.xlsx"
              download
              className="inline-block rounded-md bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700"
            >
              Download as Excel (.xlsx)
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
