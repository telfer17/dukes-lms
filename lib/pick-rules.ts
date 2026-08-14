// The rules that decide whether a pick may be written. Pure — takes loaded
// state, returns a verdict — so both callers share one implementation and it
// can be unit-tested without a database.
//
// ONE CALLER TODAY, ONE RULE SET:
//   app/admin/entrants/actions.ts   the organiser, entering the picks that
//                                   reach them through club contacts
//
// There were two. The player's own /pick/[entryId] door was removed when picks
// became organiser-entered only — recoverable from git history if that is ever
// reversed. `allowAfterDeadline` survives that removal deliberately: it is the
// shape of the rule, not a feature toggle. Passing `false` is what a
// before-the-deadline door means, the tests pin both sides of it, and the
// difference between the two answers is the whole reason this file is a shared
// validator rather than an inline check. The only live caller passes `true`.
//
// The override is ALL the organiser gets. Everything else — entry still alive,
// round belongs to this competition, team playing that matchday, team not
// already used by THAT entry since its last reset — applies identically either
// way, because they are competition rules rather than UI niceties. An organiser
// who could quietly hand someone a team they had already used would be changing
// the result of the competition, not helping.
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
  /**
   * The round the FORM was rendered against, if the caller has one. The admin
   * screen sits open on a phone while rounds get settled; without this the
   * write would silently land on whatever round became current in the
   * meantime — a pick nobody asked for, in a round nobody was looking at.
   */
  submittedRoundId?: string;
  fixtures: Fixture[];
  teams: Team[];
  /**
   * This entry's pick history in round order, EXCLUDING any pick for the round
   * being written — that one is being replaced, so it must not block itself.
   */
  history: TeamId[];
  teamId: number;
  /**
   * The organiser override: write after the deadline, before settlement. Every
   * live caller passes `true` — the only door left is the organiser's. `false`
   * is kept because it is what the rule MEANS, and tests/pick-rules.test.ts
   * runs every rejection both ways to prove the override relaxes nothing else.
   */
  allowAfterDeadline: boolean;
  now?: Date;
};

export type PickRejection =
  | "entry_not_active"
  | "unknown_round"
  | "round_moved_on"
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
  round_moved_on:
    "This round has moved on since the page loaded — refresh and try again.",
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
    submittedRoundId,
    fixtures,
    teams,
    history,
    teamId,
    allowAfterDeadline,
    now = new Date(),
  } = attempt;

  if (entryStatus !== "active") return reject("entry_not_active");
  if (!round) return reject("unknown_round");
  if (submittedRoundId !== undefined && submittedRoundId !== round.id) {
    return reject("round_moved_on");
  }

  // Settled is final for everyone. Checked before the deadline branch so the
  // override can never reach it.
  if (round.status === "settled") return reject("round_settled");

  // A deadline that will not parse is not "no deadline". `now >= NaN` is
  // false, which would have read as "the round is open" and let a pick through
  // on a round whose deadline nobody can determine. Fail closed, and closed to
  // the organiser too: the override is for a deadline that has passed, not for
  // one that cannot be read at all — that is a data fault to fix, not to
  // work around.
  const deadlineMs = Date.parse(round.deadline);
  if (Number.isNaN(deadlineMs)) return reject("deadline_passed");

  const deadlinePassed = now.getTime() >= deadlineMs;
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
