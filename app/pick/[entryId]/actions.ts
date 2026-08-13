"use server";

import { revalidatePath } from "next/cache";
import { availableTeams, teamsPlayingIn } from "@/lib/lms";
import {
  getEntry,
  getFixturesForMatchday,
  getPicksForEntry,
  getRounds,
  getTeams,
  isRoundOpen,
  pickHistoryTeamIds,
} from "@/lib/lms-db";
import { supabaseServer } from "@/lib/supabase-server";

export type PickState = { error: string } | { ok: string } | null;

/**
 * Save (or change) an entry's pick for the current open round.
 *
 * Everything the UI enforced is re-checked here against the DATABASE — the
 * deadline comes from rounds.deadline, never from the client clock, and team
 * availability is recomputed with the engine. The UI greying-out is a courtesy;
 * this is the actual gate.
 */
export async function submitPick(
  _prev: PickState,
  formData: FormData
): Promise<PickState> {
  const entryId = String(formData.get("entry_id") ?? "").trim();
  const roundId = String(formData.get("round_id") ?? "").trim();
  const teamId = Number(formData.get("team_id"));

  if (!entryId || !roundId || !Number.isInteger(teamId)) {
    return { error: "Something went wrong — please reload and try again." };
  }

  const entry = await getEntry(entryId);
  if (!entry) return { error: "We couldn't find that entry." };
  if (entry.status !== "active") {
    return { error: "This entry is out — no more picks." };
  }

  const rounds = await getRounds(entry.competition_id);
  const round = rounds.find((r) => r.id === roundId);
  if (!round) return { error: "That round doesn't belong to this competition." };

  // Authoritative deadline check: the DB's deadline against server time.
  if (!isRoundOpen(round)) {
    return { error: "That round is closed — the deadline has passed." };
  }

  const fixtures = await getFixturesForMatchday(round.matchday);
  if (fixtures.length === 0) {
    return { error: "No fixtures loaded for this matchday yet." };
  }
  if (!teamsPlayingIn(fixtures, round.matchday).has(teamId)) {
    return { error: "That team isn't playing this round." };
  }

  // Availability from the engine, over this entry's own history — excluding any
  // pick already made for THIS round, which is being replaced.
  const roundNumberById = new Map(rounds.map((r) => [r.id, r.round_number]));
  const picks = await getPicksForEntry(entryId);
  const history = pickHistoryTeamIds(
    picks.filter((p) => p.round_id !== roundId),
    roundNumberById
  );
  const teams = await getTeams();
  if (!availableTeams(history, teams).some((t) => t.id === teamId)) {
    return { error: "You've already used that team." };
  }

  // One pick per (entry, round) is a DB constraint — upsert on it so changing a
  // pick before the deadline replaces rather than collides.
  const { error } = await supabaseServer.from("picks").upsert(
    {
      competition_id: entry.competition_id,
      entry_id: entryId,
      round_id: roundId,
      team_id: teamId,
      auto_assigned: false,
      outcome: "pending",
    },
    { onConflict: "entry_id,round_id" }
  );

  if (error) {
    console.error("submitPick failed:", error);
    return { error: "Could not save your pick — please try again." };
  }

  revalidatePath(`/pick/${entryId}`);
  const team = teams.find((t) => t.id === teamId);
  return { ok: `Pick saved: ${team?.name ?? "team"}.` };
}
