"use server";

import { revalidatePath } from "next/cache";
import { validatePick } from "@/lib/pick-rules";
import {
  getEntry,
  getFixturesForMatchday,
  getPicksForEntry,
  getRounds,
  getTeams,
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
  const fixtures = round ? await getFixturesForMatchday(round.matchday) : [];

  // Availability from the engine, over this entry's own history — excluding any
  // pick already made for THIS round, which is being replaced.
  const roundNumberById = new Map(rounds.map((r) => [r.id, r.round_number]));
  const picks = await getPicksForEntry(entryId);
  const history = pickHistoryTeamIds(
    picks.filter((p) => p.round_id !== roundId),
    roundNumberById
  );
  const teams = await getTeams();

  // One shared rule set with the organiser's path (lib/pick-rules.ts). The
  // player never gets the after-deadline override.
  const verdict = validatePick({
    entryStatus: entry.status,
    round,
    fixtures,
    teams,
    history,
    teamId,
    allowAfterDeadline: false,
  });
  if (!verdict.ok) return { error: verdict.error };

  // One pick per (entry, round) is a DB constraint — upsert on it so changing a
  // pick before the deadline replaces rather than collides.
  //
  // Deliberately NOT wrapped in a transactional RPC. The interleave this would
  // guard against needs a pick landing mid-settlement, and settlement now
  // refuses to run on an open round while this route refuses to write to a
  // closed one — so the two can't overlap. Making settlement genuinely atomic
  // via a Postgres function is scheduled for the pre-season hardening pass,
  // and this upsert moves inside it at that point.
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
