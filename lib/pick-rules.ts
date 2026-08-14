// The rules that decide whether a pick may be written. Pure — takes loaded
// state, returns a verdict — so both callers share one implementation and it
// can be unit-tested without a database.
//
// TWO CALLERS, ONE RULE SET:
//   app/pick/[entryId]/actions.ts   the player, before the deadline
//   app/admin/picks/actions.ts      the organiser, entering a pick taken by
//                                   phone or text on someone's behalf
//
// The only thing the organiser gets is `allowAfterDeadline`. Everything else —
// entry still alive, round belongs to this competition, team playing that
// matchday, team not already used by THAT entry since its last reset — is
// identical for both, because they are competition rules rather than UI
// niceties. An organiser who could quietly hand someone a team they had
// already used would be changing the result of the competition, not helping.
//
// What the flag does NOT allow, ever, is writing into a SETTLED round: those
// eliminations have already been computed and announced, and a late pick would
// silently contradict the board.

import { availableTeams, teamsPlayingIn, type Fixture, type Team, type TeamId } from "@/lib/lms";

export type PickRoundState = {
  id: string;
  matchday: number;
  status: "pending" | "locked" | "settled";
  /** ISO instant — the authoritative deadline, from the database. */
  deadline: string;
};

export type PickAttempt = {
  entryStatus: "active" | "eliminated" | "winner";
  /** Undefined when the round id did not belong to the entry's competition. */
  round: PickRoundState | undefined;
  fixtures: Fixture[];
  teams: Team[];
  /**
   * This entry's pick history in round order, EXCLUDING any pick for the round
   * being written — that one is being replaced, so it must not block itself.
   */
  history: TeamId[];
  teamId: number;
  /** The organiser override: write after the deadline, before settlement. */
  allowAfterDeadline: boolean;
  now?: Date;
};

export type PickRejection =
  | "entry_not_active"
  | "unknown_round"
  | "round_settled"
  | "deadline_passed"
  | "no_fixtures"
  | "team_not_playing"
  | "team_used";

export type PickVerdict =
  | { ok: true; deadlinePassed: boolean }
  | { ok: false; code: PickRejection; error: string };

const MESSAGES: Record<PickRejection, string> = {
  entry_not_active: "This entry is out — no more picks.",
  unknown_round: "That round doesn't belong to this competition.",
  round_settled: "That round has been settled — its picks are final.",
  deadline_passed: "That round is closed — the deadline has passed.",
  no_fixtures: "No fixtures loaded for this matchday yet.",
  team_not_playing: "That team isn't playing this round.",
  team_used: "That team has already been used.",
};

function reject(code: PickRejection): PickVerdict {
  return { ok: false, code, error: MESSAGES[code] };
}

export function validatePick(attempt: PickAttempt): PickVerdict {
  const {
    entryStatus,
    round,
    fixtures,
    teams,
    history,
    teamId,
    allowAfterDeadline,
    now = new Date(),
  } = attempt;

  if (entryStatus !== "active") return reject("entry_not_active");
  if (!round) return reject("unknown_round");

  // Settled is final for everyone. Checked before the deadline branch so the
  // override can never reach it.
  if (round.status === "settled") return reject("round_settled");

  const deadlinePassed = now.getTime() >= Date.parse(round.deadline);
  if (deadlinePassed && !allowAfterDeadline) return reject("deadline_passed");

  if (fixtures.length === 0) return reject("no_fixtures");
  if (!teamsPlayingIn(fixtures, round.matchday).has(teamId)) {
    return reject("team_not_playing");
  }
  if (!availableTeams(history, teams).some((t) => t.id === teamId)) {
    return reject("team_used");
  }

  return { ok: true, deadlinePassed };
}

/**
 * The teams an entry may still be given this round: playing that matchday, and
 * not used since that entry's last reset. Used to build the admin's per-entry
 * dropdown, so the options shown are the options validatePick will accept.
 */
export function selectableTeams(input: {
  fixtures: Fixture[];
  matchday: number;
  teams: Team[];
  history: TeamId[];
}): Team[] {
  const playing = teamsPlayingIn(input.fixtures, input.matchday);
  return availableTeams(input.history, input.teams)
    .filter((t) => playing.has(t.id))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
}
