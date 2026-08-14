// Public reads — PUBLISHABLE key only, no secrets.
//
// These are the shapes the anon grants actually allow (see the grants block at
// the end of db/lms-schema.sql): the competition header, the standing_board
// view and the rounds table. Both the homepage and /board render from exactly
// this data, so the two screens can never disagree about who is still in or
// when the next deadline is.
//
// NOTHING here selects entries.id. That uuid names an entry to every write
// path there is, and a React `key` is serialised into the RSC payload — so
// keying a public list off it publishes the internal id of every entry in the
// page source. (It was worse still when /pick/[entryId] existed and the id was
// literally the credential for changing that entry's pick; that page is gone,
// the reason to keep the id private is not.) The board keys off name+index
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

export type PublicCompetition = {
  id: string;
  label: string;
  status: string;
  rollover_count: number;
  pot_carried_in_pence: number;
};

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
 * The competition to show the public: the newest that is running or won.
 * `data` is null with no error when none has been created yet — the honest
 * "starts soon" case, which is not a failure.
 */
export async function readPublicCompetition() {
  const { data, error } = await supabaseBrowser
    .from("competitions")
    .select("id, label, status, rollover_count, pot_carried_in_pence")
    .in("status", ["active", "won"])
    .order("created_at", { ascending: false })
    .limit(1)
    .abortSignal(AbortSignal.timeout(READ_TIMEOUT_MS))
    .returns<PublicCompetition[]>();

  return { data: data?.[0] ?? null, error };
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
