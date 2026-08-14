// Public reads — PUBLISHABLE key only, no secrets.
//
// These are the shapes the anon grants actually allow (see the grants block at
// the end of db/lms-schema.sql): the competition header, the standing_board
// view and the rounds table. Both the homepage and /board render from exactly
// this data, so the two screens can never disagree about who is still in or
// when the next deadline is.
//
// NOTHING here selects entries.id. That uuid is the entire credential for
// /pick/[entryId], and a React `key` is serialised into the RSC payload — so
// keying a public list off it publishes every player's pick link in the page
// source. The board keys off name+index instead. The view no longer exposes
// the column either (db/lms-schema.sql); this is the second lock on the same
// door, and tests/public-read.test.ts fails if it is ever put back.
//
// Each helper returns Supabase's own { data, error } shape rather than
// throwing: a failed read must render as "can't load right now", never as an
// empty competition.

import { supabaseBrowser } from "@/lib/supabase-browser";
import type { RoundRow } from "@/lib/lms-db";

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
    .returns<PublicCompetition[]>();

  return { data: data?.[0] ?? null, error };
}

export async function readPublicBoard(competitionId: string) {
  return supabaseBrowser
    .from("standing_board")
    .select(PUBLIC_BOARD_COLUMNS)
    .eq("competition_id", competitionId)
    .returns<BoardRow[]>();
}

export async function readPublicRounds(competitionId: string) {
  return supabaseBrowser
    .from("rounds")
    .select("id, competition_id, round_number, matchday, deadline, status")
    .eq("competition_id", competitionId)
    .order("round_number")
    .returns<RoundRow[]>();
}
