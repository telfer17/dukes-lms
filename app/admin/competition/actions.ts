"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { requireAdmin } from "@/lib/admin-auth";
import { supabaseServer } from "@/lib/supabase-server";
import {
  getActiveCompetition,
  getMatchdayDeadlines,
  getPicksForCompetition,
  getRounds,
} from "@/lib/lms-db";

/**
 * Create a competition. Only one may be active at a time (enforced by the
 * partial unique index); we check first so the admin gets a sentence rather
 * than a constraint violation.
 */
export async function createCompetition(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireAdmin();

  const label = String(formData.get("label") ?? "").trim();
  const rolloverCount = Number(formData.get("rollover_count") ?? 0);
  const potCarriedPounds = Number(formData.get("pot_carried_in_pounds") ?? 0);

  if (!label) return { error: "Give the competition a label." };
  if (!Number.isInteger(rolloverCount) || rolloverCount < 0) {
    return { error: "Rollover count must be a whole number, 0 or more." };
  }
  if (!Number.isFinite(potCarriedPounds) || potCarriedPounds < 0) {
    return { error: "Pot carried in must be 0 or more." };
  }

  const existing = await getActiveCompetition();
  if (existing) {
    return {
      error: `"${existing.label}" is still active. Settle or roll it over before starting another.`,
    };
  }

  const { error } = await supabaseServer.from("competitions").insert({
    label,
    status: "active",
    rollover_count: rolloverCount,
    pot_carried_in_pence: Math.round(potCarriedPounds * 100),
  });

  if (error) {
    console.error("createCompetition failed:", error);
    return { error: "Could not create the competition." };
  }

  revalidatePath("/admin/competition");
  return { ok: `Created "${label}".` };
}

/**
 * Build rounds for the active competition from the fixture list: round 1 maps
 * to the given starting matchday, and one round follows per matchday that has
 * fixtures, up to matchday 38. Each deadline is that matchday's first kickoff.
 *
 * Round number and matchday are deliberately separate — a competition starting
 * after a mid-season rollover has round 1 = matchday 6. See docs/LMS-SCHEMA.md.
 */
export async function generateRounds(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireAdmin();

  const startMatchday = Number(formData.get("start_matchday") ?? 1);
  if (!Number.isInteger(startMatchday) || startMatchday < 1 || startMatchday > 38) {
    return { error: "Starting matchday must be between 1 and 38." };
  }

  const competition = await getActiveCompetition();
  if (!competition) return { error: "No active competition." };

  const existing = await getRounds(competition.id);
  if (existing.length > 0) {
    return {
      error: `"${competition.label}" already has ${existing.length} rounds. Delete them before regenerating.`,
    };
  }

  const deadlines = await getMatchdayDeadlines();
  const matchdays = [...deadlines.keys()]
    .filter((md) => md >= startMatchday)
    .sort((a, b) => a - b);

  if (matchdays.length === 0) {
    return {
      error:
        "No fixtures loaded from that matchday onwards — load fixtures first.",
    };
  }

  const rows = matchdays.map((matchday, i) => ({
    competition_id: competition.id,
    round_number: i + 1,
    matchday,
    deadline: deadlines.get(matchday)!,
    status: "pending" as const,
  }));

  const { error } = await supabaseServer.from("rounds").insert(rows);
  if (error) {
    console.error("generateRounds failed:", error);
    return { error: "Could not generate rounds." };
  }

  revalidatePath("/admin/competition");
  return {
    ok: `Created ${rows.length} rounds — round 1 is matchday ${matchdays[0]}.`,
  };
}

/** Remove all rounds for the active competition (only before any are settled). */
export async function deleteRounds(): Promise<ActionState> {
  await requireAdmin();

  const competition = await getActiveCompetition();
  if (!competition) return { error: "No active competition." };

  const rounds = await getRounds(competition.id);
  if (rounds.some((r) => r.status === "settled")) {
    return { error: "Some rounds are already settled — refusing to delete." };
  }

  // picks cascade-delete with their round, so wiping rounds would silently
  // destroy everyone's picks. Refuse rather than take that decision for them.
  //
  // Check-then-delete is not atomic, but the race needs a pick landing in the
  // same instant an organiser clears the rounds on this single-admin screen.
  // Folded into the pre-season hardening pass if it ever matters.
  const picks = await getPicksForCompetition(competition.id);
  if (picks.length > 0) {
    return {
      error: `${picks.length} pick(s) have already been made in this competition — deleting the rounds would delete them too. Refusing.`,
    };
  }

  const { error } = await supabaseServer
    .from("rounds")
    .delete()
    .eq("competition_id", competition.id);
  if (error) {
    console.error("deleteRounds failed:", error);
    return { error: "Could not delete the rounds." };
  }

  revalidatePath("/admin/competition");
  return { ok: "Rounds cleared." };
}
