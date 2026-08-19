import "server-only";
import { supabaseServer } from "@/lib/supabase-server";
import type { EntryStatus, Fixture, PickOutcome, Team } from "@/lib/lms";

// Shared server-side reads for the Last Man Standing screens. The engine
// (lib/lms.ts) stays pure — everything that touches Supabase lives here or in
// a server action, and hands the engine plain data.

export type CompetitionStatus = "active" | "won" | "rolled_over";
export type RoundStatus = "pending" | "locked" | "settled";

export type CompetitionRow = {
  id: string;
  label: string;
  status: CompetitionStatus;
  rollover_count: number;
  pot_carried_in_pence: number;
  winner_participant_id: string | null;
  created_at: string;
};

export type RoundRow = {
  id: string;
  competition_id: string;
  round_number: number;
  matchday: number;
  deadline: string;
  status: RoundStatus;
};

export type ParticipantRow = {
  id: string;
  name: string;
  phone: string | null;
  club_contact: string | null;
};

export type EntryRow = {
  id: string;
  competition_id: string;
  participant_id: string;
  paid: boolean;
  amount_paid_pence: number;
  is_newcomer: boolean;
  status: EntryStatus;
  eliminated_round_id: string | null;
  joined_at: string;
};

/** One recorded buy-back. See db/buyback.sql. */
export type BuybackRow = {
  id: string;
  competition_id: string;
  entry_id: string;
  eliminated_round_id: string;
  round_id: string;
  paid: boolean;
  amount_paid_pence: number;
  created_at: string;
};

export type PickRow = {
  id: string;
  competition_id: string;
  entry_id: string;
  round_id: string;
  team_id: number;
  auto_assigned: boolean;
  outcome: PickOutcome;
};

/** An entry joined to the person holding it. */
export type EntryWithParticipant = EntryRow & { participant: ParticipantRow };

const COMPETITION_COLS =
  "id, label, status, rollover_count, pot_carried_in_pence, winner_participant_id, created_at";
const ROUND_COLS =
  "id, competition_id, round_number, matchday, deadline, status";
const ENTRY_COLS =
  "id, competition_id, participant_id, paid, amount_paid_pence, is_newcomer, status, eliminated_round_id, joined_at";
const BUYBACK_COLS =
  "id, competition_id, entry_id, eliminated_round_id, round_id, paid, amount_paid_pence, created_at";
const PICK_COLS =
  "id, competition_id, entry_id, round_id, team_id, auto_assigned, outcome";
const FIXTURE_COLS =
  "id, matchday, kickoff, home_team_id, away_team_id, status, result";

function fail(what: string, message: string): never {
  throw new Error(`${what}: ${message}`);
}

/** The single active competition, or null if none has been created yet. */
export async function getActiveCompetition(): Promise<CompetitionRow | null> {
  const { data, error } = await supabaseServer
    .from("competitions")
    .select(COMPETITION_COLS)
    .eq("status", "active")
    .maybeSingle<CompetitionRow>();
  if (error) fail("active competition lookup failed", error.message);
  return data ?? null;
}

export async function getCompetition(id: string): Promise<CompetitionRow | null> {
  const { data, error } = await supabaseServer
    .from("competitions")
    .select(COMPETITION_COLS)
    .eq("id", id)
    .maybeSingle<CompetitionRow>();
  if (error) fail("competition lookup failed", error.message);
  return data ?? null;
}

/**
 * Competitions that are over, newest first — the history behind the concluded
 * public view and the admin's read-only list. 'active' is deliberately absent:
 * this answers "what has already happened", never "what is running".
 */
export async function getConcludedCompetitions(
  limit = 10
): Promise<CompetitionRow[]> {
  const { data, error } = await supabaseServer
    .from("competitions")
    .select(COMPETITION_COLS)
    .in("status", ["won", "rolled_over"])
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<CompetitionRow[]>();
  if (error) fail("concluded competitions lookup failed", error.message);
  return data ?? [];
}

/**
 * Names for a set of participant ids. Participants are secret-key-only (they
 * carry phone numbers), so this is the only way a winner's ID becomes a winner's
 * name. Ids with no row are simply absent from the map — the caller decides
 * whether that is worth saying out loud.
 */
export async function getParticipantNames(
  ids: string[]
): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (wanted.length === 0) return new Map();

  const { data, error } = await supabaseServer
    .from("participants")
    .select("id, name")
    .in("id", wanted)
    .returns<{ id: string; name: string }[]>();
  if (error) fail("participant name lookup failed", error.message);
  return new Map((data ?? []).map((p) => [p.id, p.name]));
}

/** All 20 clubs, alphabetical. */
export async function getTeams(): Promise<Team[]> {
  const { data, error } = await supabaseServer
    .from("teams")
    .select("id, name")
    .order("name")
    .returns<Team[]>();
  if (error) fail("teams lookup failed", error.message);
  return data ?? [];
}

export async function getRounds(competitionId: string): Promise<RoundRow[]> {
  const { data, error } = await supabaseServer
    .from("rounds")
    .select(ROUND_COLS)
    .eq("competition_id", competitionId)
    .order("round_number")
    .returns<RoundRow[]>();
  if (error) fail("rounds lookup failed", error.message);
  return data ?? [];
}

/**
 * The round the competition is on: the lowest-numbered round not yet settled.
 * Null once every round is settled (or before any exist).
 */
export function currentRound(rounds: RoundRow[]): RoundRow | null {
  return rounds.find((r) => r.status !== "settled") ?? null;
}

/** True while picks may still be made or changed. Uses the DB deadline. */
export function isRoundOpen(round: RoundRow, now: Date = new Date()): boolean {
  return round.status === "pending" && now.getTime() < Date.parse(round.deadline);
}

/**
 * Every person on record, name-sorted. The add-entry form needs ALL
 * participants, not just those with an entry in the active competition —
 * someone from a previous competition must be reusable rather than duplicated.
 */
export async function getParticipants(): Promise<ParticipantRow[]> {
  const { data, error } = await supabaseServer
    .from("participants")
    .select("id, name, phone, club_contact")
    .order("name")
    .returns<ParticipantRow[]>();
  if (error) fail("participants lookup failed", error.message);
  return data ?? [];
}

export async function getEntries(
  competitionId: string
): Promise<EntryWithParticipant[]> {
  const { data, error } = await supabaseServer
    .from("entries")
    .select(`${ENTRY_COLS}, participant:participants (id, name, phone, club_contact)`)
    .eq("competition_id", competitionId)
    .returns<EntryWithParticipant[]>();
  if (error) fail("entries lookup failed", error.message);
  return data ?? [];
}

export async function getEntry(
  entryId: string
): Promise<EntryWithParticipant | null> {
  const { data, error } = await supabaseServer
    .from("entries")
    .select(`${ENTRY_COLS}, participant:participants (id, name, phone, club_contact)`)
    .eq("id", entryId)
    .maybeSingle<EntryWithParticipant>();
  if (error) fail("entry lookup failed", error.message);
  return data ?? null;
}

/** Every pick this entry has made, oldest first — the engine's pick history. */
export async function getPicksForEntry(entryId: string): Promise<PickRow[]> {
  const { data, error } = await supabaseServer
    .from("picks")
    .select(PICK_COLS)
    .eq("entry_id", entryId)
    .returns<PickRow[]>();
  if (error) fail("picks lookup failed", error.message);
  return data ?? [];
}

export async function getPicksForCompetition(
  competitionId: string
): Promise<PickRow[]> {
  const { data, error } = await supabaseServer
    .from("picks")
    .select(PICK_COLS)
    .eq("competition_id", competitionId)
    .returns<PickRow[]>();
  if (error) fail("picks lookup failed", error.message);
  return data ?? [];
}

/**
 * Every buy-back recorded in this competition.
 *
 * Read wherever the pot is totted up as well as wherever eligibility is
 * decided: a buy-back is another £10 through the same 50/50 split, so a screen
 * that adds up entries alone now understates both the pot and the club's half.
 */
export async function getBuybacks(
  competitionId: string
): Promise<BuybackRow[]> {
  const { data, error } = await supabaseServer
    .from("buybacks")
    .select(BUYBACK_COLS)
    .eq("competition_id", competitionId)
    .returns<BuybackRow[]>();
  if (error) fail("buybacks lookup failed", error.message);
  return data ?? [];
}

/**
 * The highest round number already SETTLED in this competition, or 0 if none
 * has been. The reference point for "has this entry played since it bought
 * back?" — see resolveCompetitionState.
 */
export function settledRoundNumber(rounds: RoundRow[]): number {
  const settled = rounds.filter((r) => r.status === "settled");
  return settled.length === 0
    ? 0
    : Math.max(...settled.map((r) => r.round_number));
}

export async function getPicksForRound(roundId: string): Promise<PickRow[]> {
  const { data, error } = await supabaseServer
    .from("picks")
    .select(PICK_COLS)
    .eq("round_id", roundId)
    .returns<PickRow[]>();
  if (error) fail("round picks lookup failed", error.message);
  return data ?? [];
}

// The "is this matchday already settled?" guard used to live here as a read,
// with the write that depended on it happening afterwards over a separate
// connection. That gap is exactly what let a settle land between the check and
// the write. It now lives INSIDE the settlement lock, in lms_set_fixture_result
// (db/settlement-fn.sql), where the check and the write share a transaction.
// Reading it out here again would just reintroduce the race in a place that
// looks safe.

export type FixtureRow = Fixture & { kickoff: string };

export async function getFixturesForMatchday(
  matchday: number
): Promise<FixtureRow[]> {
  const { data, error } = await supabaseServer
    .from("fixtures")
    .select(FIXTURE_COLS)
    .eq("matchday", matchday)
    .order("kickoff")
    .returns<FixtureRow[]>();
  if (error) fail("fixtures lookup failed", error.message);
  return data ?? [];
}

/** Distinct matchdays that have fixtures loaded, ascending. */
export async function getLoadedMatchdays(): Promise<number[]> {
  const { data, error } = await supabaseServer
    .from("fixtures")
    .select("matchday")
    .order("matchday")
    .returns<{ matchday: number }[]>();
  if (error) fail("matchday lookup failed", error.message);
  return [...new Set((data ?? []).map((r) => r.matchday))];
}

/**
 * Earliest kickoff per matchday — a round's deadline. Only matchdays that
 * actually have fixtures appear.
 */
export async function getMatchdayDeadlines(): Promise<Map<number, string>> {
  const { data, error } = await supabaseServer
    .from("fixtures")
    .select("matchday, kickoff")
    .order("kickoff")
    .returns<{ matchday: number; kickoff: string }[]>();
  if (error) fail("matchday deadline lookup failed", error.message);
  const earliest = new Map<number, string>();
  for (const row of data ?? []) {
    if (!earliest.has(row.matchday)) earliest.set(row.matchday, row.kickoff);
  }
  return earliest;
}

/** Ordered pick history (team ids) for an entry — what availableTeams wants. */
export function pickHistoryTeamIds(
  picks: PickRow[],
  roundNumberById: Map<string, number>
): number[] {
  return [...picks]
    .sort(
      (a, b) =>
        (roundNumberById.get(a.round_id) ?? 0) -
        (roundNumberById.get(b.round_id) ?? 0)
    )
    .map((p) => p.team_id);
}
