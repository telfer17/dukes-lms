import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase-server";
import PredictionForm, {
  type Match,
  type Prediction,
} from "@/components/PredictionForm";

export const dynamic = "force-dynamic";

export default async function AdminPredictPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: participant, error: participantError } = await supabaseServer
    .from("participants")
    .select("id, name, paid, club_contact")
    .eq("id", id)
    .maybeSingle();

  if (participantError) {
    console.error("admin participant lookup failed:", participantError.message);
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

  return (
    <>
      <div className="mx-auto max-w-2xl px-4 pt-8">
        <Link
          href="/admin/entrants"
          className="text-sm text-blue-600 hover:underline"
        >
          ← Back to entrants
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">
          Entering predictions for {participant.name}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          via {participant.club_contact}
        </p>
      </div>
      <PredictionForm
        participant={participant}
        matches={(matches ?? []) as Match[]}
        existing={(existing ?? []) as Prediction[]}
        locked={false}
        endpoint="/api/admin/predictions"
        forceEditable
      />
    </>
  );
}
