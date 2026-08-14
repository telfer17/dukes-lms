// Turning the private tables into the public picks grid.
//
// Pure — no imports, no I/O — so what the browser is handed can be asserted in
// a unit test (tests/grid-projection.test.ts) rather than eyeballed in a page.
//
// THE PROJECTION IS THE SECURITY BOUNDARY. The inputs carry entry ids,
// participant ids, phone numbers and payment amounts; the output carries a
// name, a status, an elimination round and per-round { team, outcome, auto }.
// entries.id in particular names an entry to every write path, and a value
// that reaches props reaches the RSC payload even if nothing renders it —
// that is how the board leaked entry ids through a React `key`. So ids are used
// to join here and are dropped on the way out, by construction: the row type
// has nowhere to put one.

export type GridCell = {
  team: string;
  /** From picks.outcome — 'pending' until the round is settled. */
  outcome: "pending" | "survived" | "eliminated";
  /** Assigned by the deadline rule rather than chosen. */
  auto: boolean;
};

export type GridRow = {
  name: string;
  status: "active" | "eliminated" | "winner";
  /** Round number they went out in, if they did. */
  eliminatedRound: number | null;
  /** One slot per round column, in round order; null where no pick exists. */
  cells: (GridCell | null)[];
};

type RoundInput = { id: string; round_number: number; status: string };
type EntryInput = {
  id: string;
  status: "active" | "eliminated" | "winner";
  eliminated_round_id: string | null;
  participant: { name: string } | null;
};
type PickInput = {
  entry_id: string;
  round_id: string;
  team_id: number;
  auto_assigned: boolean;
  outcome: "pending" | "survived" | "eliminated";
};

/**
 * How many week columns to draw: every round that has started, plus any round
 * that already has picks in it (which is the round being played right now).
 *
 * Rounds are generated for the whole season up front, so drawing "every round
 * that exists" would mean 38 columns of blank from day one.
 */
export function relevantRoundCount(
  rounds: RoundInput[],
  roundNumbersWithPicks: number[]
): number {
  const started = rounds
    .filter((r) => r.status !== "pending")
    .map((r) => r.round_number);
  return Math.max(0, ...started, ...roundNumbersWithPicks);
}

export function buildGridRows(input: {
  rounds: RoundInput[];
  entries: EntryInput[];
  picks: PickInput[];
  teamNameById: Map<number, string>;
}): { rows: GridRow[]; roundLabels: string[] } {
  const { rounds, entries, picks, teamNameById } = input;
  const roundNumberById = new Map(rounds.map((r) => [r.id, r.round_number]));

  const columns = relevantRoundCount(
    rounds,
    picks
      .map((p) => roundNumberById.get(p.round_id))
      .filter((n): n is number => n !== undefined)
  );

  const cellsByEntry = new Map<string, Map<number, GridCell>>();
  for (const pick of picks) {
    const roundNumber = roundNumberById.get(pick.round_id);
    if (roundNumber === undefined) continue;
    const byRound =
      cellsByEntry.get(pick.entry_id) ?? new Map<number, GridCell>();
    byRound.set(roundNumber, {
      team: teamNameById.get(pick.team_id) ?? "—",
      outcome: pick.outcome,
      auto: pick.auto_assigned,
    });
    cellsByEntry.set(pick.entry_id, byRound);
  }

  const rows = entries
    .map((entry): GridRow => {
      const byRound = cellsByEntry.get(entry.id);
      const eliminatedRound = entry.eliminated_round_id
        ? (roundNumberById.get(entry.eliminated_round_id) ?? null)
        : null;
      return {
        name: entry.participant?.name ?? "—",
        status: entry.status,
        eliminatedRound,
        cells: Array.from(
          { length: columns },
          (_, i) => byRound?.get(i + 1) ?? null
        ),
      };
    })
    // Alphabetical, with an explicit locale so the order cannot drift with the
    // server's default.
    .sort((a, b) => a.name.localeCompare(b.name, "en"));

  return {
    rows,
    roundLabels: Array.from({ length: columns }, (_, i) => `Week ${i + 1}`),
  };
}
