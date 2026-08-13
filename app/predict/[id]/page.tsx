import { notFound } from "next/navigation";
import { DEADLINE } from "@/lib/constants";
import { supabaseServer } from "@/lib/supabase-server";
import PredictionForm, {
  type Match,
  type Participant,
  type Prediction,
} from "@/components/PredictionForm";

// Data is per-participant and time-sensitive — always render at request time.
export const dynamic = "force-dynamic";

export default async function PredictPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: participant, error: participantError } = await supabaseServer
    .from("participants")
    .select("id, name, paid")
    .eq("id", id)
    .maybeSingle();

  if (participantError) {
    console.error("participants query failed:", participantError.message);
  }

  if (!participant) {
    notFound();
  }

  const [{ data: matches, error: matchesError }, { data: existing, error: existingError }] =
    await Promise.all([
      supabaseServer
        .from("matches")
        .select("id, grp, home, away, kickoff, home_score, away_score")
        .order("id"),
      supabaseServer
        .from("predictions")
        .select("match_id, home_pred, away_pred")
        .eq("participant_id", id),
    ]);

  if (matchesError || existingError) {
    throw new Error(matchesError?.message ?? existingError?.message);
  }

  // Reading the clock is intentionally request-time here (force-dynamic above).
  // eslint-disable-next-line react-hooks/purity
  const locked = Date.now() >= DEADLINE.getTime();

  // Running total from the single leaderboard scoring source, keyed by id
  // (names are not unique). Only relevant once entries lock; degrade quietly
  // if the participant_points view isn't present yet.
  let totalPoints: number | null = null;
  if (locked) {
    const { data: pointsRow, error: pointsError } = await supabaseServer
      .from("participant_points")
      .select("points")
      .eq("participant_id", id)
      .maybeSingle();
    if (pointsError) {
      console.error("participant_points lookup failed:", pointsError.message);
    } else {
      totalPoints = pointsRow?.points ?? null;
    }
  }

  return (
    <PredictionForm
      participant={participant as Participant}
      matches={(matches ?? []) as Match[]}
      existing={(existing ?? []) as Prediction[]}
      locked={locked}
      totalPoints={totalPoints}
    />
  );
}
