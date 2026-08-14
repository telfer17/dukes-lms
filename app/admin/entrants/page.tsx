import Link from "next/link";
import AdminEntryRow, {
  type CurrentPick,
  type PickControl,
} from "@/components/admin/AdminEntryRow";
import MarkAllPaidButton from "@/components/admin/MarkAllPaidButton";
import {
  groupEntries,
  orderForPicking,
  type EntryRecord,
  type PickBucket,
} from "@/lib/admin-entrants";
import {
  BASE_ENTRY_PENCE,
  clubPence,
  collectedPence,
  expectedBuyInPence,
  formatPence,
  potPence,
} from "@/lib/competition";
import {
  currentRound,
  getActiveCompetition,
  getEntries,
  getFixturesForMatchday,
  getPicksForCompetition,
  getPicksForRound,
  getRounds,
  getTeams,
  isRoundOpen,
  pickHistoryTeamIds,
  type CompetitionRow,
  type EntryWithParticipant,
  type RoundRow,
} from "@/lib/lms-db";
import { selectableTeams } from "@/lib/pick-rules";

export const dynamic = "force-dynamic";

// The organiser's one weekly screen: people, payment and THIS ROUND'S PICKS in
// one list. Picks used to live on /admin/picks; there is no second door to
// drift out of step with this one, and since players no longer enter their own
// picks at all, this is the only place a pick is ever written.
//
// Admin-gated by proxy.ts (matcher /admin/:path*), and every read below uses
// the secret key. /grid shows the same picks publicly, but this page also shows
// who has NOT picked and what they paid, which is organiser business.

const deadlineFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const BUCKET_HEADING: Record<PickBucket, string> = {
  to_pick: "Still to pick",
  picked: "Picked",
  out: "Out",
};

/** Everything one row needs, once the payment side and the pick side are joined. */
type Row = EntryRecord & {
  expected_pence: number;
  amount_mismatch: boolean;
  hasPick: boolean;
  currentPick: CurrentPick | null;
  picker: PickControl | null;
};

function Shell({
  subtitle,
  children,
}: {
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    // w-full is load-bearing, not decoration. This <main> is a flex item of the
    // admin layout's column, which sizes it to its own content rather than to
    // the viewport — so without it, ONE long entrant name stretches the whole
    // page wider than the phone and every row's Save button falls off the right
    // edge. Measured at 390px: 459px wide without it, 390px with it.
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <Link href="/admin" className="text-sm text-blue-600 hover:underline">
        ← Back to dashboard
      </Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">Entrants</h1>
      {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
      {children}
    </main>
  );
}

export default async function EntrantsPage() {
  let competition: CompetitionRow | null = null;
  let entries: EntryWithParticipant[] = [];
  let loadError: string | null = null;

  try {
    competition = await getActiveCompetition();
    if (competition) entries = await getEntries(competition.id);
  } catch (e) {
    console.error("entrants load failed:", e);
    loadError = "Could not read entrants.";
  }

  // A failed entries load must never render as an empty competition — the
  // payment totals would read £0 collected, which is indistinguishable from
  // "nobody has paid" and is the one number an organiser acts on.
  if (competition && loadError) {
    return (
      <Shell subtitle={competition.label}>
        <p
          role="alert"
          className="mt-8 rounded-md border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700"
        >
          {loadError} Totals are hidden rather than shown as zero — reload to
          try again.
        </p>
      </Shell>
    );
  }

  if (!competition) {
    return (
      <Shell>
        <p className="mt-8 rounded-md border border-gray-200 p-6 text-center text-gray-500">
          {loadError ?? (
            <>
              No active competition yet.{" "}
              <Link
                href="/admin/competition"
                className="text-blue-600 hover:underline"
              >
                Create one first →
              </Link>
            </>
          )}
        </p>
      </Shell>
    );
  }

  // ---- The pick side, loaded separately ----
  //
  // Its own try/catch on purpose: a picks read that fails must not take the
  // payment screen down with it. The rows then say nothing at all about
  // picking — an unknown pick state is NOT "no pick yet", and reporting it as
  // one would send the organiser chasing people who have already picked.
  let round: RoundRow | null = null;
  let pickError: string | null = null;
  let fixturesMissing = false;
  const pickByEntry = new Map<
    string,
    { currentPick: CurrentPick | null; picker: PickControl | null }
  >();

  try {
    const rounds = await getRounds(competition.id);
    round = currentRound(rounds);

    if (round) {
      const [allPicks, roundPicks, teams, fixtures] = await Promise.all([
        getPicksForCompetition(competition.id),
        getPicksForRound(round.id),
        getTeams(),
        getFixturesForMatchday(round.matchday),
      ]);

      fixturesMissing = fixtures.length === 0;

      const roundNumberById = new Map(rounds.map((r) => [r.id, r.round_number]));
      const teamNameById = new Map(teams.map((t) => [t.id, t.name]));
      const pickThisRound = new Map(roundPicks.map((p) => [p.entry_id, p]));

      // Every entry's history in one pass, so the per-entry team lists don't
      // each re-query.
      const historyByEntry = new Map<string, typeof allPicks>();
      for (const pick of allPicks) {
        const list = historyByEntry.get(pick.entry_id) ?? [];
        list.push(pick);
        historyByEntry.set(pick.entry_id, list);
      }

      const open = isRoundOpen(round);
      const deadlinePassed = !open && round.status !== "settled";

      for (const entry of entries) {
        const current = pickThisRound.get(entry.id) ?? null;
        // By id, not name: a team name that fails to resolve would otherwise
        // read as "hasn't picked" and put someone on the chase list twice.
        const teamName = current
          ? (teamNameById.get(current.team_id) ?? null)
          : null;

        const history = pickHistoryTeamIds(
          (historyByEntry.get(entry.id) ?? []).filter(
            (p) => p.round_id !== round!.id
          ),
          roundNumberById
        );

        pickByEntry.set(entry.id, {
          currentPick:
            current && teamName
              ? { teamName, autoAssigned: current.auto_assigned }
              : null,
          // Only ACTIVE entries can be given a pick, and only once the
          // matchday's fixtures are loaded.
          picker:
            entry.status === "active" && !fixturesMissing
              ? {
                  roundId: round.id,
                  currentTeamId: current?.team_id ?? null,
                  // The options offered are exactly what validatePick will
                  // accept for THIS entry — same helper, same engine.
                  options: selectableTeams({
                    fixtures,
                    matchday: round.matchday,
                    teams,
                    history,
                  }).map((t) => ({ id: t.id, name: t.name })),
                  deadlinePassed,
                }
              : null,
        });
      }
    }
  } catch (e) {
    console.error("entrants pick state load failed:", e);
    pickError = "Could not read this round's picks.";
    round = null;
  }

  const roundKnown = round !== null && pickError === null;

  // ---- Money, unchanged ----
  const records: EntryRecord[] = entries.map((e) => ({
    id: e.id,
    name: e.participant?.name ?? "(unknown)",
    phone: e.participant?.phone ?? null,
    club_contact: e.participant?.club_contact ?? null,
    paid: e.paid,
    amount_paid_pence: e.amount_paid_pence,
    is_newcomer: e.is_newcomer,
    status: e.status,
  }));

  const { groups, totals } = groupEntries(records, competition.rollover_count);
  const money = entries.map((e) => ({
    paid: e.paid,
    amount_paid_pence: e.amount_paid_pence,
  }));

  const stats = [
    { label: "Entries", value: String(totals.entries) },
    { label: "Paid", value: String(totals.paid) },
    { label: "Unpaid", value: String(totals.unpaid) },
    { label: "Collected", value: formatPence(collectedPence(money)) },
    {
      label: "Pot",
      value: formatPence(potPence(competition.pot_carried_in_pence, money)),
    },
    { label: "Club", value: formatPence(clubPence(money)) },
  ];

  // groupEntries has already worked out each entry's expected amount and
  // flagged mismatches; flattening its groups reuses that rather than redoing
  // the ladder maths here. The grouping itself still drives "Mark all paid".
  const rows: Row[] = groups
    .flatMap((group) => group.entries)
    .map((entry) => {
      const pick = pickByEntry.get(entry.id);
      return {
        ...entry,
        hasPick: roundKnown && (pick?.currentPick ?? null) !== null,
        currentPick: roundKnown ? (pick?.currentPick ?? null) : null,
        picker: roundKnown ? (pick?.picker ?? null) : null,
      };
    });

  const ordered = orderForPicking(rows);
  const activeCount = rows.filter((r) => r.status === "active").length;
  const toPick = ordered.filter((r) => r.bucket === "to_pick").length;

  const open = round ? isRoundOpen(round) : false;
  const deadlinePassed = round ? !open && round.status !== "settled" : false;

  // A heading goes above the first row of each block. Derived by looking back
  // one row rather than carrying a running variable, so the list stays a pure
  // function of `ordered`.
  const listItems = ordered.map((row, i) => ({
    row,
    heading:
      roundKnown && (i === 0 || ordered[i - 1].bucket !== row.bucket)
        ? row.bucket
        : null,
  }));

  return (
    <Shell subtitle={competition.label}>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <a
          href="/api/admin/export/entries"
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
        >
          Export entries (CSV)
        </a>
        <Link
          href="/admin/entrants/new"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Add entry
        </Link>
      </div>

      {/* ---- This round ---- */}
      {pickError && (
        <p
          role="alert"
          className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {pickError} Payment is still editable below; picks are hidden rather
          than guessed at — reload to try again.
        </p>
      )}

      {!pickError && !round && (
        <p className="mt-4 rounded-md border border-gray-200 p-3 text-sm text-gray-500">
          No round is open — every round is settled. Nothing to enter.
        </p>
      )}

      {round && (
        <div className="mt-4 rounded-md border border-gray-200 p-3">
          <p className="font-semibold">
            Round {round.round_number}
            <span className="ml-2 text-sm font-normal text-gray-500">
              matchday {round.matchday}
            </span>
            <span
              className={`ml-2 text-xs font-semibold uppercase tracking-wide ${
                open ? "text-green-700" : "text-amber-700"
              }`}
            >
              {open ? "open" : "locked"}
            </span>
          </p>
          <p className="mt-1 text-sm text-gray-600">
            {open ? "Picks lock" : "Deadline was"}{" "}
            {deadlineFormat.format(new Date(round.deadline))}
          </p>
        </div>
      )}

      {deadlinePassed && (
        <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <strong>The deadline has passed.</strong> You can still enter a pick
          for someone who got theirs to you in time — each save asks you to
          confirm. Once the round is settled, picks are final.
        </p>
      )}

      {fixturesMissing && round && (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          No fixtures loaded for matchday {round.matchday} — picks can&apos;t be
          entered until they are.
        </p>
      )}

      {/* ---- The list ---- */}
      {rows.length === 0 ? (
        <p className="mt-6 rounded-md border border-gray-200 p-6 text-center text-gray-500">
          No entries yet.
        </p>
      ) : (
        <>
          {/* Sticky, because the whole point of the screen is "who still owes
              me a pick" and fifty rows scroll that answer off the top. */}
          {roundKnown && round && (
            <div className="sticky top-0 z-10 -mx-4 mt-6 border-y border-gray-200 bg-white/95 px-4 py-2 backdrop-blur">
              <p className="flex items-center justify-between gap-2 text-sm font-semibold">
                {toPick === 0 ? (
                  <span className="text-green-700">
                    All {activeCount} in — everyone has picked.
                  </span>
                ) : (
                  <span className="text-amber-700">
                    {/* The {" "} is load-bearing — see the note at the top of
                        app/rules/page.tsx: the compiler drops a plain space
                        between an expression and a text run containing an
                        escaped entity, rendering "5haven't picked". */}
                    {toPick} of {activeCount}{" "}
                    haven&apos;t picked
                  </span>
                )}
                <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-gray-500">
                  R{round.round_number} · {open ? "open" : "locked"}
                </span>
              </p>
            </div>
          )}

          <ul
            className={`divide-y divide-gray-200 rounded-md border border-gray-200 ${
              roundKnown ? "mt-2" : "mt-6"
            }`}
          >
            {/* Headings are siblings of the rows in ONE flat keyed array, not
                wrappers around them: a row keeps its React identity — and with
                it the "saved" message under it — when a successful save moves
                it from "still to pick" down into "picked". */}
            {listItems.flatMap(({ row, heading }) => {
              const rowNode = (
                <AdminEntryRow
                  key={row.id}
                  id={row.id}
                  name={row.name}
                  clubContact={row.club_contact ?? ""}
                  paid={row.paid}
                  amountPaidPence={row.amount_paid_pence}
                  expectedPence={row.expected_pence}
                  amountMismatch={row.amount_mismatch}
                  isNewcomer={row.is_newcomer}
                  status={row.status}
                  roundKnown={roundKnown}
                  currentPick={row.currentPick}
                  picker={row.picker}
                />
              );

              return heading
                ? [
                    <li
                      key={`heading-${heading}`}
                      className="bg-gray-50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-500"
                    >
                      {BUCKET_HEADING[heading]}
                    </li>,
                    rowNode,
                  ]
                : [rowNode];
            })}
          </ul>
        </>
      )}

      {/* ---- Money ---- */}
      <div className="mt-8 grid grid-cols-3 gap-3 sm:grid-cols-6">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-md border border-gray-200 p-3 text-center"
          >
            <div className="text-lg font-bold tabular-nums">{stat.value}</div>
            <div className="text-[10px] uppercase tracking-wide text-gray-500">
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3 text-xs text-gray-500">
        Buy-in for this competition:{" "}
        {formatPence(expectedBuyInPence(competition.rollover_count, false))}{" "}
        returning,{" "}
        {formatPence(expectedBuyInPence(competition.rollover_count, true))}{" "}
        newcomer
        {competition.rollover_count > 0 &&
          ` (${formatPence(BASE_ENTRY_PENCE)} × ${competition.rollover_count + 1})`}
        . Pot includes {formatPence(competition.pot_carried_in_pence)} carried
        in.
      </p>

      {/* Bulk payment still works club contact by club contact — the same
          action as before. Only the club-contact SECTIONS moved down here: the
          main list is now ordered by who still owes a pick, which is the job
          being done every week, and payment chasing is the job done once. */}
      {groups.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Payment by club contact
          </h2>
          <ul className="mt-2 divide-y divide-gray-200 rounded-md border border-gray-200">
            {groups.map((group) => (
              <li
                key={group.clubContact}
                className="flex items-center justify-between gap-3 p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {group.clubContact || "(no club contact)"}
                  </p>
                  <p className="text-xs text-gray-500">
                    {group.paidCount}/{group.total} paid
                  </p>
                </div>
                <MarkAllPaidButton clubContact={group.clubContact} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </Shell>
  );
}
