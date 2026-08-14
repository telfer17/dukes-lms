import "server-only";
import { formatPence, potPence } from "@/lib/competition";
import { getEntries, getParticipantNames } from "@/lib/lms-db";
import type { PublicCompetition } from "@/lib/public-read";

// What a finished competition looks like on the public screens.
//
// A competition ends and the pages must keep working: the winner named, the pot
// accounted for, the board and the grid still browsable. Two of those facts are
// not in the public read — the winner's NAME lives in participants (secret key
// only, it carries phone numbers) and the pot is derived from what each entry
// actually paid, which is private in exactly the same way. So the summary is
// assembled here, server-side, and only the finished sentences ship.
//
// EVERY PIECE IS OPTIONAL BY DESIGN. A missing winner name or an unreadable pot
// must not replace the concluded view with an error page: the headline fact —
// this competition is over, and how — comes from the competition row the page
// already holds. A failed lookup drops one line, it does not blank the screen.

export type ConcludedStatus = "won" | "rolled_over";

export type ConcludedSummary = {
  status: ConcludedStatus;
  label: string;
  /**
   * The winning person, named once. Null when the lookup failed, or on a
   * rollover, where by definition nobody won.
   */
  winnerName: string | null;
  /**
   * On a win: the pot they took. On a rollover: the pot carried into the next
   * competition. Same arithmetic either way — carried-in plus half of
   * everything collected — because it is the same pot.
   */
  potLabel: string | null;
  /**
   * How many entries the winner finished holding. More than one is ordinary
   * (multi-entry is allowed and the entries run independently) and changes
   * nothing about the prize: one person, one crown, one pot.
   */
  winnerEntryCount: number;
};

/** The money and status fields the pot arithmetic needs off an entry. */
type EntrySummary = {
  paid: boolean;
  amount_paid_pence: number;
  status: string;
};

/**
 * Assemble the concluded view for a competition that is over.
 *
 * `entries` is a courtesy for callers that have already read them (/board and
 * /grid both do): pass them in and this makes one lookup instead of two. Pass
 * nothing and it reads them itself.
 */
export async function readConcludedSummary(
  competition: PublicCompetition,
  entries?: EntrySummary[]
): Promise<ConcludedSummary> {
  const status = competition.status as ConcludedStatus;

  let known = entries ?? null;
  if (!known) {
    try {
      known = await getEntries(competition.id);
    } catch (e) {
      // Worth a line in the log, not worth a broken page.
      console.error("concluded summary: entries read failed:", e);
    }
  }

  const potLabel = known
    ? formatPence(potPence(competition.pot_carried_in_pence, known))
    : null;

  let winnerName: string | null = null;
  if (status === "won" && competition.winner_participant_id) {
    try {
      const names = await getParticipantNames([competition.winner_participant_id]);
      winnerName = names.get(competition.winner_participant_id) ?? null;
    } catch (e) {
      console.error("concluded summary: winner name read failed:", e);
    }
  }

  return {
    status,
    label: competition.label,
    winnerName,
    potLabel,
    // Scoped to a win on purpose. Nobody survives a rollover, so a 'winner'
    // entry sitting in a rolled-over competition is contradictory data — and
    // this number's only job is to caption a crown that isn't being drawn.
    winnerEntryCount:
      status === "won"
        ? (known?.filter((e) => e.status === "winner").length ?? 0)
        : 0,
  };
}
