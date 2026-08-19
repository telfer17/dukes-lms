// Public reads — PUBLISHABLE key only, no secrets.
//
// These are the shapes the anon grants actually allow (see the grants block at
// the end of db/lms-schema.sql): the competition header, the standing_board
// view and the rounds table. The homepage renders its live state from exactly
// this data; /leaderboard reads the same competition through
// readPublicCompetition and derives its own counts from the picks projection,
// so the two screens can never disagree about who is still in.
//
// NOTHING here selects entries.id. That uuid names an entry to every write
// path there is, and a React `key` is serialised into the RSC payload — so
// keying a public list off it publishes the internal id of every entry in the
// page source. (It was worse still when /pick/[entryId] existed and the id was
// literally the credential for changing that entry's pick; that page is gone,
// the reason to keep the id private is not.) Public lists key off name+index
// instead. The view no longer exposes the column either (db/lms-schema.sql);
// this is the second lock on the same door, and tests/public-read.test.ts
// fails if it is ever put back.
//
// Each helper returns Supabase's own { data, error } shape rather than
// throwing: a failed read must render as "can't load right now", never as an
// empty competition.

import { supabaseBrowser } from "@/lib/supabase-browser";
import type { RoundRow } from "@/lib/lms-db";

/**
 * How long a public read may hang before it counts as failed.
 *
 * Without this, a Supabase that accepts the connection and then stalls holds
 * the request open until some outer limit kills it, and the visitor watches a
 * blank tab. Five seconds is well past a healthy read (these are small indexed
 * queries) and well short of anyone's patience. An abort surfaces in the
 * `error` slot like any other failure, so it lands on the same honest
 * "can't be loaded right now" panels rather than throwing past them.
 */
const READ_TIMEOUT_MS = 5_000;

export type PublicCompetitionStatus = "active" | "won" | "rolled_over";

export type PublicCompetition = {
  id: string;
  label: string;
  status: PublicCompetitionStatus;
  rollover_count: number;
  pot_carried_in_pence: number;
  /**
   * The winning PERSON, not an entry — one crown however many entries they
   * finished holding (db/lms-schema.sql). Null unless status is 'won'. The
   * competitions table is anon-readable, so the ID travels with the public
   * read; turning it into a NAME needs the participants table and therefore
   * the server client (lib/concluded.ts).
   */
  winner_participant_id: string | null;
};

/** 'won' and 'rolled_over' — a competition that is over but still the record. */
export function isConcluded(
  status: PublicCompetitionStatus
): status is "won" | "rolled_over" {
  return status === "won" || status === "rolled_over";
}

const PUBLIC_COMPETITION_COLUMNS =
  "id, label, status, rollover_count, pot_carried_in_pence, winner_participant_id";

export type BoardRow = {
  competition_id: string;
  name: string;
  status: "active" | "eliminated" | "winner";
  eliminated_round_number: number | null;
};

/**
 * The board's column list. Exported so a test can assert what it does NOT
 * contain — see the note at the top of this file.
 */
export const PUBLIC_BOARD_COLUMNS =
  "competition_id, name, status, eliminated_round_number";

/**
 * The competition to show the public: the active one, or — when nothing is
 * running — the most recently concluded one.
 *
 * The fallback is the whole point. A competition ends at the moment of maximum
 * interest, and until this existed every public page answered "no competition
 * running" the instant it did: the winner's name, the final table and the
 * season's picks all still in the database, none of them on screen. Nothing
 * here is deleted when a competition ends, so nothing has to go blank.
 *
 * ACTIVE WINS. A new competition takes the screens back the moment the
 * organiser opens one — the concluded view only fills the gap between a
 * rollover (or a win) and the restart. That is why this is two queries rather
 * than one `in ('active','won','rolled_over')` ordered by created_at: the
 * ordering would only *usually* put the active one first, and "usually" is not
 * a rule anyone can rely on. Asking for the active row explicitly is.
 *
 * `data` is null with no error when no competition has ever been created — the
 * honest "starts soon" case, which is not a failure. Callers branch on
 * `status` (see isConcluded) rather than on data being present.
 */
export async function readPublicCompetition() {
  const active = await supabaseBrowser
    .from("competitions")
    .select(PUBLIC_COMPETITION_COLUMNS)
    .eq("status", "active")
    .limit(1)
    .abortSignal(AbortSignal.timeout(READ_TIMEOUT_MS))
    .returns<PublicCompetition[]>();

  // A failed lookup must NOT fall through to the concluded competition: that
  // would answer "the season's over, here's who won" to someone whose
  // competition is running and whose database blinked.
  if (active.error) return { data: null, error: active.error };
  if (active.data?.[0]) return { data: active.data[0], error: null };

  const concluded = await supabaseBrowser
    .from("competitions")
    .select(PUBLIC_COMPETITION_COLUMNS)
    .in("status", ["won", "rolled_over"])
    .order("created_at", { ascending: false })
    .limit(1)
    .abortSignal(AbortSignal.timeout(READ_TIMEOUT_MS))
    .returns<PublicCompetition[]>();

  return { data: concluded.data?.[0] ?? null, error: concluded.error };
}

export async function readPublicBoard(competitionId: string) {
  return supabaseBrowser
    .from("standing_board")
    .select(PUBLIC_BOARD_COLUMNS)
    .eq("competition_id", competitionId)
    .abortSignal(AbortSignal.timeout(READ_TIMEOUT_MS))
    .returns<BoardRow[]>();
}

export async function readPublicRounds(competitionId: string) {
  return supabaseBrowser
    .from("rounds")
    .select("id, competition_id, round_number, matchday, deadline, status")
    .eq("competition_id", competitionId)
    .order("round_number")
    .abortSignal(AbortSignal.timeout(READ_TIMEOUT_MS))
    .returns<RoundRow[]>();
}
