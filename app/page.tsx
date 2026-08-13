import HomeHero from "@/components/HomeHero";
import EnterOptions from "@/components/EnterOptions";

const scoring = [
  { pts: 5, rule: "Exact score" },
  {
    pts: 3,
    rule: "Correct result plus winning team's goals (ie. you predict 3-0, but game finishes 3-1)",
  },
  { pts: 2, rule: "Correct result only" },
  { pts: 0, rule: "Anything else" },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-4xl px-4">
      <HomeHero />

      {/* Prize pot */}
      <section className="pb-16">
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-6 text-center sm:p-8">
          <h2 className="text-3xl font-bold tracking-tight text-blue-900 sm:text-4xl">
            Prize pot: £265
          </h2>
          <div className="mx-auto mt-6 grid max-w-md grid-cols-3 gap-3">
            {[
              { place: "1st", amount: "£160" },
              { place: "2nd", amount: "£80" },
              { place: "3rd", amount: "£25" },
            ].map((tier) => (
              <div
                key={tier.place}
                className="rounded-md border border-blue-200 bg-white p-3"
              >
                <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                  {tier.place}
                </div>
                <div className="mt-1 text-xl font-bold tabular-nums text-gray-900 sm:text-2xl">
                  {tier.amount}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section
        id="how-it-works"
        className="scroll-mt-20 border-t border-gray-200 py-16"
      >
        <h2 className="text-2xl font-bold">How it works</h2>

        <EnterOptions />

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div className="rounded-md border border-gray-200 p-5">
            <h3 className="font-semibold">£10 entry</h3>
            <p className="mt-2 text-sm text-gray-600">
              £5 goes into the prize pot, £5 goes to the club.
            </p>
            <h4 className="mt-4 font-semibold">Prizes (top 3)</h4>
            <ul className="mt-2 space-y-1 text-sm text-gray-600">
              <li className="flex gap-2">
                <span className="w-10 shrink-0 font-semibold text-gray-900">
                  1st
                </span>
                £160
              </li>
              <li className="flex gap-2">
                <span className="w-10 shrink-0 font-semibold text-gray-900">
                  2nd
                </span>
                £80
              </li>
              <li className="flex gap-2">
                <span className="w-10 shrink-0 font-semibold text-gray-900">
                  3rd
                </span>
                £25
              </li>
            </ul>
            <p className="mt-2 text-sm text-gray-600">
              Roughly a 60/30/10 split of the £265 pot, rounded to keep payouts
              tidy.
            </p>
            <p className="mt-2 text-sm text-gray-500">
              53 entries in — £530 collected, half of it (£265) the prize pot.
            </p>
          </div>

          <div className="rounded-md border border-gray-200 p-5">
            <h3 className="font-semibold">Predict every game</h3>
            <p className="mt-2 text-sm text-gray-600">
              Predict the exact score of all 72 group games before the first
              kick-off at 20:00 UK time on 11 June.
            </p>
          </div>

          <div className="rounded-md border border-gray-200 p-5">
            <h3 className="font-semibold">Scoring</h3>
            <ul className="mt-2 space-y-1 text-sm text-gray-600">
              {scoring.map((s) => (
                <li key={s.pts} className="flex gap-2">
                  <span className="w-10 shrink-0 font-semibold text-gray-900">
                    {s.pts} pts
                  </span>
                  {s.rule}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-md border border-gray-200 p-5">
            <h3 className="font-semibold">Edit until kick-off</h3>
            <p className="mt-2 text-sm text-gray-600">
              Change your predictions as often as you like until the first
              kick-off on 11 June — then everything locks.
            </p>
          </div>
        </div>

        <div className="mt-6 rounded-md border border-gray-200 p-5">
          <h3 className="font-semibold">How to pay</h3>
          <p className="mt-2 text-sm text-gray-600">
            £10 per entry. Pay by bank transfer, or hand cash to the club member
            you entered through.
          </p>
          <dl className="mt-3 space-y-1 text-sm text-gray-600">
            <div className="flex gap-2">
              <dt className="w-36 shrink-0 font-semibold text-gray-900">
                Account name
              </dt>
              <dd>Glasgow Wellington Football Club Limited</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-36 shrink-0 font-semibold text-gray-900">
                Bank
              </dt>
              <dd>Co-operative Bank</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-36 shrink-0 font-semibold text-gray-900">
                Sort code
              </dt>
              <dd>08-92-50</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-36 shrink-0 font-semibold text-gray-900">
                Account number
              </dt>
              <dd>63295276</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-36 shrink-0 font-semibold text-gray-900">
                Reference
              </dt>
              <dd>use your entry name, so we can match your payment.</dd>
            </div>
          </dl>
        </div>
      </section>
    </main>
  );
}
