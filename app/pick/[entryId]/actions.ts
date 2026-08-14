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
    // Always equal here — `round` was looked up BY this id — so it can only
    // pass. Passed anyway so both callers use the validator identically.
    submittedRoundId: roundId,
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
  // DELIBERATELY NOT one transaction with the validation above, and the same
  // disposition as the three earlier transaction findings on this file.
  //
  // The residual race is a pick landing between another connection reading the
  // state and writing it. Settlement is what would be damaged by that, and
  // settlement defends itself: lms_settle_round takes the advisory lock and
  // FINGERPRINTS the picks it planned against (db/settlement-fn.sql). A pick
  // that lands after the plan was computed fails that validation, so the
  // settle applies nothing and the organiser re-runs against fresh state —
  // the pick is kept, not lost. In the other direction a pick can never land
  // against a settled round: validatePick refuses a settled round here, and
  // settlement re-validates inside its own transaction regardless.
  //
  // So the failure mode is a re-run, not a corrupt round. Wrapping this in an
  // RPC remains the documented pattern (see the settlement functions) if a
  // reason to need true atomicity ever shows up.
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
