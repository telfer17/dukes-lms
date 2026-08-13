// "How the prizes are decided" — shared by the final-phase home and the
// winners podium (where it explains the final result).
export default function PrizeRules() {
  return (
    <div className="mt-8 rounded-md border border-gray-200 p-5">
      <h2 className="text-lg font-semibold">How the prizes are decided</h2>
      <p className="mt-3 text-sm font-medium text-gray-900">Points:</p>
      <ul className="mt-1 space-y-0.5 text-sm text-gray-600">
        <li>5 for an exact score</li>
        <li>
          3 for the right result with the winning team&apos;s goals correct
        </li>
        <li>2 for the right result</li>
      </ul>
      <p className="mt-3 text-sm font-medium text-gray-900">
        Top three take the money:
      </p>
      <p className="mt-1 text-sm text-gray-600">1st £160, 2nd £80, 3rd £25</p>
      <p className="mt-3 text-sm text-gray-600">
        Level on points? The Exact column is the tie-breaker — person with the
        most exact scores predicted will win.
      </p>
      <p className="mt-3 text-sm text-gray-600">
        Identical on points and exact scores? Those tied players share the
        combined prize money for the places they&apos;re tied across, split
        evenly.
      </p>
    </div>
  );
}
