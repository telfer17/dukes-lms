"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { requireAdmin } from "@/lib/admin-auth";
import {
  currentRound,
  getActiveCompetition,
  getEntry,
  getFixturesForMatchday,
  getPicksForEntry,
  getRounds,
  getTeams,
  pickHistoryTeamIds,
} from "@/lib/lms-db";
import { validatePick } from "@/lib/pick-rules";
import { supabaseServer } from "@/lib/supabase-server";

/**
 * Enter or change a pick ON BEHALF OF an entrant — the paper-entrant flow.
 * Some players never open their link; they text the organiser a team and it
 * gets typed in here.
 *
 * Same rules as the player's own path, through the same validator
 * (lib/pick-rules.ts), with ONE difference: the organiser may write after the
 * deadline while the round is still unsettled. That is the real situation the
 * competition runs in — "he texted me at 19:00, the game kicked off at 20:00,
 * I was driving" — and the alternative is not fairness, it is the organiser
 * editing the database by hand with no validation at all. It stays bounded:
 * a settled round is refused for everyone, the write is logged as a normal
 * human pick, and the UI makes the organiser confirm an amber warning first.
 *
 * NEVER marks auto_assigned. That flag means "the deadline passed and the
 * engine chose alphabetically"; these picks are a person's actual choice, and
 * mislabelling them would make the board tell a story that never happened.
 */
export async function setPickForEntry(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireAdmin();

  const entryId = String(formData.get("entry_id") ?? "").trim();
  const submittedRoundId = String(formData.get("round_id") ?? "").trim();
  const rawTeamId = String(formData.get("team_id") ?? "").trim();

  if (!entryId) {
    return { error: "Something went wrong — please reload and try again." };
  }
  // Blank is checked BEFORE converting: Number("") is 0, and 0 is an integer,
  // so an empty select would sail past a NaN check and then fail deeper in
  // with "that team isn't playing this round" — a confusing answer to
  // "you didn't choose anyone".
  if (rawTeamId === "") return { error: "Pick a team first." };

  const teamId = Number(rawTeamId);
  if (!Number.isInteger(teamId)) {
    return { error: "Something went wrong — please reload and try again." };
  }

  const competition = await getActiveCompetition();
  if (!competition) return { error: "No active competition." };

  const entry = await getEntry(entryId);
  if (!entry) return { error: "We couldn't find that entry." };
  if (entry.competition_id !== competition.id) {
    return { error: "That entry isn't in the active competition." };
  }

  const rounds = await getRounds(competition.id);
  // The round to write is the SERVER's current one — the form never chooses it.
  // The form's round id is carried only to be COMPARED: if the page was
  // rendered against round 3 and round 3 has since been settled, this write
  // must not quietly land on round 4 instead. validatePick refuses the
  // mismatch and the organiser refreshes.
  const round = currentRound(rounds);
  if (!round) return { error: "No round is open — every round is settled." };

  const fixtures = await getFixturesForMatchday(round.matchday);
  const teams = await getTeams();
  const roundNumberById = new Map(rounds.map((r) => [r.id, r.round_number]));
  const picks = await getPicksForEntry(entryId);
  const history = pickHistoryTeamIds(
    picks.filter((p) => p.round_id !== round.id),
    roundNumberById
  );

  const verdict = validatePick({
    entryStatus: entry.status,
    round,
    submittedRoundId: submittedRoundId || undefined,
    fixtures,
    teams,
    history,
    teamId,
    allowAfterDeadline: true,
  });
  if (!verdict.ok) return { error: verdict.error };

  const { error } = await supabaseServer.from("picks").upsert(
    {
      competition_id: competition.id,
      entry_id: entryId,
      round_id: round.id,
      team_id: teamId,
      auto_assigned: false,
      outcome: "pending",
    },
    { onConflict: "entry_id,round_id" }
  );

  if (error) {
    console.error("setPickForEntry failed:", error);
    return { error: "Could not save that pick — please try again." };
  }

  revalidatePath("/admin/picks");
  revalidatePath(`/pick/${entryId}`);
  revalidatePath("/grid");
  revalidatePath("/board");

  const team = teams.find((t) => t.id === teamId);
  const who = entry.participant?.name ?? "entry";
  return {
    ok: `${who}: ${team?.name ?? "team"} saved${
      verdict.deadlinePassed ? " (after the deadline)" : ""
    }.`,
  };
}
