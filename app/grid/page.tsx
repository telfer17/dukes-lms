import Link from "next/link";
import { isAfterDeadline } from "@/lib/deadline";
import { supabaseServer } from "@/lib/supabase-server";
import PredictionsGrid, {
  type GridMatch,
  type GridParticipant,
  type GridPreds,
} from "@/components/PredictionsGrid";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "All picks · Glasgow Wellington World Cup 2026 Predictor",
};

type PredRow = {
  participant_id: string;
  match_id: number;
  home_pred: number;
  away_pred: number;
};

// Predictions exceed the 1000-row cap (≈57×72), so page through them.
async function allPredictions(): Promise<PredRow[]> {
  const rows: PredRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseServer
      .from("predictions")
      .select("participant_id, match_id, home_pred, away_pred")
      .order("id")
      .range(from, from + PAGE - 1)
      .returns<PredRow[]>();
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

export default async function GridPage() {
  // Don't reveal everyone's picks until entries lock — otherwise latecomers
  // could copy. (Server-side gate; does not touch the homepage deadline flip.)
  const revealed = isAfterDeadline();

  return (
    <main className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8">
      <Link href="/" className="text-sm text-blue-600 hover:underline">
        ← Back to home
      </Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">All picks</h1>
      <p className="mt-1 text-sm text-gray-500">
        Everyone&apos;s predicted scores for all 72 group games.
      </p>

      {!revealed ? (
        <p className="mt-8 rounded-md border border-gray-200 p-6 text-center text-gray-500">
          Everyone&apos;s picks are revealed once entries lock at the first
          kick-off. Check back then.
        </p>
      ) : (
        <GridContent />
      )}
    </main>
  );
}

async function GridContent() {
  const [participantsRes, matchesRes, predictions] = await Promise.all([
    supabaseServer
      .from("participants")
      .select("id, name")
      .returns<GridParticipant[]>(),
    supabaseServer
      .from("matches")
      .select("id, home, away, kickoff, home_score, away_score")
      .returns<GridMatch[]>(),
    allPredictions(),
  ]);
  if (participantsRes.error) throw new Error(participantsRes.error.message);
  if (matchesRes.error) throw new Error(matchesRes.error.message);

  const participants = (participantsRes.data ?? [])
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));

  const matches = (matchesRes.data ?? [])
    .slice()
    .sort(
      (a, b) =>
        new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime() ||
        a.id - b.id
    );

  const preds: GridPreds = {};
  for (const pr of predictions) {
    (preds[pr.participant_id] ??= {})[pr.match_id] = [
      pr.home_pred,
      pr.away_pred,
    ];
  }

  return (
    <div className="mt-6">
      <PredictionsGrid
        participants={participants}
        matches={matches}
        preds={preds}
      />
    </div>
  );
}
