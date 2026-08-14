// The player-facing ruleset.
//
// KEEP IN SYNC WITH docs/LMS-RULES.md. That document is the single source of
// truth; this page is a hand-written retelling of it in plain English, NOT a
// render of the markdown — nothing here is parsed at runtime. If a rule
// changes, change it there first and then mirror it here. This is the page
// that settles an argument in March, so it has to say the same thing the
// engine does (lib/lms.ts) and the same thing the doc does.
//
// The money figures are computed from lib/competition.ts rather than typed in,
// so the entry fee, the split and the newcomer ladder can never drift from the
// maths the app actually applies.
//
// The explicit {" "} spacers after some </strong> tags are load-bearing, not
// tidy-up fodder: the compiler drops a plain space between a closing tag and a
// text run that contains an escaped entity (&apos;), which silently renders
// "used— you can't" instead of "used — you can't". Check the rendered HTML,
// not the source, if you reflow a paragraph here.

import Link from "next/link";
import {
  BASE_ENTRY_PENCE,
  clubPence,
  expectedBuyInPence,
  formatPence,
  potPence,
} from "@/lib/competition";

export const metadata = {
  title: "Rules · Dukes — Last Man Standing",
  description:
    "The full Last Man Standing ruleset: picks, deadlines, missed picks, postponed games, multiple entries, the pot and rollovers.",
};

const ENTRY_LABEL = formatPence(BASE_ENTRY_PENCE);

function splitOf(amountPence: number) {
  const entry = [{ paid: true, amount_paid_pence: amountPence }];
  return {
    buyIn: formatPence(amountPence),
    pot: formatPence(potPence(0, entry)),
    club: formatPence(clubPence(entry)),
  };
}

const BASE_SPLIT = splitOf(BASE_ENTRY_PENCE);

// The newcomer buy-in ladder, generated from the same function the admin
// screens use: £10 x (prior rollovers + 1).
const ladder = [1, 2, 3].map((priorRollovers) => ({
  priorRollovers,
  ...splitOf(expectedBuyInPence(priorRollovers, true)),
}));

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-gray-200 py-8">
      <h2 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h2>
      <div className="mt-3 space-y-3 text-gray-700">{children}</div>
    </section>
  );
}

const contents = [
  { id: "basics", label: "The basics" },
  { id: "rounds", label: "Rounds and deadlines" },
  { id: "picking", label: "Picking a team" },
  { id: "missed", label: "If you miss the deadline" },
  { id: "called-off", label: "Postponed or abandoned games" },
  { id: "multiple", label: "More than one entry" },
  { id: "money", label: "The entry fee and the pot" },
  { id: "ending", label: "How it ends" },
  { id: "rollovers", label: "Rollovers and re-entry" },
];

export default function RulesPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
        The rules
      </h1>
      <p className="mt-3 text-lg text-gray-600">
        Dukes — Last Man Standing, in full. If there&apos;s ever a disagreement
        about a pick, a deadline or a payout, this page is the answer.
      </p>

      <nav aria-label="Contents" className="mt-6 rounded-md bg-gray-50 p-4">
        <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {contents.map((item) => (
            <li key={item.id}>
              <a href={`#${item.id}`} className="text-blue-600 hover:underline">
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <Section id="basics" title="The basics">
        <p>
          Last Man Standing is a survivor competition run over the English
          Premier League season. Each round you pick one Premier League team you
          think will win.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Your team <strong>wins</strong> — you go through to the next round.
          </li>
          <li>
            Your team <strong>draws or loses</strong>{" "}— you&apos;re out.
          </li>
          <li>
            You can only pick each team <strong>once</strong>.
          </li>
          <li>
            The last player standing wins the <strong>whole pot</strong>.
          </li>
        </ul>
        <p>
          That&apos;s the entire game. Everything below is the small print for
          the situations a season throws up.
        </p>
      </Section>

      <Section id="rounds" title="Rounds and deadlines">
        <p>
          A round is one Premier League matchday — matchday 1, matchday 2, and
          so on. Every round you pick exactly one team from{" "}
          <em>that matchday&apos;s</em> fixtures.
        </p>
        <p>
          Picks lock at the round&apos;s deadline, which is the{" "}
          <strong>first kick-off of that matchday</strong> — not the kick-off of
          your own game. Until then you can change your pick as often as you
          like. After it, nothing can be changed.
        </p>
        <p>
          Picks go through the organiser. Get yours to your club contact before
          the deadline — by text, in person, however suits — and they enter it
          for you. There is no pick page to log into and nothing to lose.
        </p>
      </Section>

      <Section id="picking" title="Picking a team">
        <p>
          A team can only be picked <strong>once per competition</strong>. Pick
          Arsenal in round 1 and Arsenal is gone from your list for the rest of
          the competition — win or lose.
        </p>
        <p>
          Once you have used all 20 teams, your list resets and every team
          becomes available to you again. Used teams are counted{" "}
          <strong>per entry</strong>, and only against your own picks — what
          anyone else has picked makes no difference to what you can pick.
        </p>
        <p>
          A team you picked in a game that was later called off still counts as
          used — see{" "}
          <a href="#called-off" className="text-blue-600 hover:underline">
            postponed or abandoned games
          </a>
          .
        </p>
      </Section>

      <Section id="missed" title="If you miss the deadline">
        <p>
          Missing a pick is <strong>not</strong>{" "}an elimination. If the deadline
          passes and you haven&apos;t picked, a team is assigned to you: the
          first one <strong>alphabetically</strong> that you have not already
          used <em>and</em> that is playing in that matchday.
        </p>
        <p>
          You then live or die by that team exactly as if you had picked it
          yourself, and it counts as used. An auto-assigned pick is shown as
          &ldquo;auto&rdquo; on your pick page and on the board.
        </p>
        <p>
          If you hold more than one entry and miss both, each entry gets its own
          team worked out from its own history — so the two may well be
          different teams.
        </p>
      </Section>

      <Section id="called-off" title="Postponed or abandoned games">
        <p>
          If the game your team was playing in is <strong>postponed</strong> or{" "}
          <strong>abandoned</strong>, your pick counts as a{" "}
          <strong>win</strong> and you go through to the next round.
        </p>
        <p>
          The team still counts as <strong>used</strong>{" "}— you can&apos;t pick
          them again later. The pick stands even though the game never produced
          a proper result.
        </p>
        <p>
          One exception, so that nobody wins the whole thing on a game that was
          never played: the competition{" "}
          <strong>cannot be won outright on a postponed or abandoned game
          alone</strong>. If a called-off game is the only thing keeping the last
          player (or players) in, that round isn&apos;t settled as final — it
          waits until the game is played, or the organiser rules on it.
        </p>
      </Section>

      <Section id="multiple" title="More than one entry">
        <p>
          You can take as many entries as you like, as long as you pay a full
          entry fee for each one. Extra entries are named so they can be told
          apart on the board — &ldquo;David Smith 1&rdquo;, &ldquo;David Smith
          2&rdquo;.
        </p>
        <p>
          Every entry is <strong>completely independent</strong>: its own picks,
          its own list of used teams, its own survival. Two of your entries can
          pick different teams in the same round, and one can go out while the
          other sails on.
        </p>
      </Section>

      <Section id="money" title="The entry fee and the pot">
        <p>
          Entry is <strong>{ENTRY_LABEL}</strong>, split 50/50:{" "}
          <strong>{BASE_SPLIT.pot}</strong> into the prize pot and{" "}
          <strong>{BASE_SPLIT.club}</strong> to the club. That same 50/50 split
          applies to <em>every</em> payment, including the larger newcomer
          buy-ins below.
        </p>
        <p>
          The prize pot is the pot-half of every entry paid, plus anything
          carried over from a previous competition. It is{" "}
          <strong>winner-takes-all</strong> — there are no second or third
          places.
        </p>
        <p>
          Entries are taken by the organiser, not through this site: message your
          club contact to enter or to pay.
        </p>
      </Section>

      <Section id="ending" title="How it ends">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>One entry left</strong> — that entry is the Last Man
            Standing and wins the entire pot. The competition ends.
          </li>
          <li>
            <strong>The last entries all belong to the same person</strong> —
            that person wins. It is winner-takes-all and there is a{" "}
            <strong>single pot</strong>: holding the last two entries does not
            win two shares.
          </li>
          <li>
            <strong>Everyone goes out in the same round</strong> — nobody wins.
            The pot rolls over and a new competition starts.
          </li>
        </ul>
      </Section>

      <Section id="rollovers" title="Rollovers and re-entry">
        <p>
          When a competition rolls over, a brand-new one starts from scratch:
          everyone gets all 20 teams back, the round counter goes back to 1, and
          the rolled-over pot carries in on top of the new entries.
        </p>
        <p>
          <strong>Returning players</strong> — anyone who was in the competition
          that just rolled over — re-enter for the standard {ENTRY_LABEL}.
        </p>
        <p>
          <strong>New players</strong> joining a competition that has already
          rolled over pay a bigger buy-in, so their contribution to the pot
          matches what everyone else has already put in:
        </p>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="border-b border-gray-300 text-left">
                <th className="py-2 pr-4 font-semibold">Rollovers so far</th>
                <th className="py-2 pr-4 font-semibold">Buy-in</th>
                <th className="py-2 pr-4 font-semibold">To the pot</th>
                <th className="py-2 font-semibold">To the club</th>
              </tr>
            </thead>
            <tbody>
              {ladder.map((row) => (
                <tr key={row.priorRollovers} className="border-b border-gray-200">
                  <td className="py-2 pr-4 tabular-nums">{row.priorRollovers}</td>
                  <td className="py-2 pr-4 font-semibold tabular-nums">
                    {row.buyIn}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">{row.pot}</td>
                  <td className="py-2 tabular-nums">{row.club}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-gray-600">
          …and another {ENTRY_LABEL} on top for every further rollover.
        </p>
        <p>
          The reason: it stops someone buying into a jackpot that other people
          spent a season building, for the price of a single entry.
        </p>
      </Section>

      <p className="mt-10 text-center text-sm text-gray-500">
        <Link href="/board" className="text-blue-600 hover:underline">
          See who&apos;s still in
        </Link>{" "}
        ·{" "}
        <Link href="/" className="text-blue-600 hover:underline">
          Home
        </Link>
      </p>
    </main>
  );
}
