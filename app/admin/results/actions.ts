"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { validateResult } from "@/lib/admin-results";
import { supabaseServer } from "@/lib/supabase-server";

export async function setResult(
  matchId: number,
  homeRaw: string,
  awayRaw: string
): Promise<void> {
  await requireAdmin();

  if (!Number.isInteger(matchId)) {
    throw new Error("Invalid match id.");
  }
  const result = validateResult(homeRaw, awayRaw);
  if (!result.ok) {
    throw new Error(result.error);
  }

  // Only the matches row changes — the leaderboard view recomputes itself.
  const { error } = await supabaseServer
    .from("matches")
    .update({ home_score: result.home, away_score: result.away })
    .eq("id", matchId);

  if (error) {
    console.error("setResult failed:", error);
    throw new Error("Failed to save result.");
  }

  revalidatePath("/admin/results");
}
