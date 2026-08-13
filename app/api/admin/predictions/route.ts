import { requireAdmin } from "@/lib/admin-auth";
import { supabaseServer } from "@/lib/supabase-server";

type IncomingPrediction = {
  match_id: number;
  home_pred: number;
  away_pred: number;
};

// Intentional: admins transcribe paper sheets that arrived on time, so
// entry must work post-deadline. This route deliberately has NO deadline
// check — and it sits outside the proxy matcher, so requireAdmin() below
// is its only guard.
export async function POST(request: Request) {
  try {
    await requireAdmin();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    participant_id?: string;
    participantId?: string;
    predictions?: IncomingPrediction[];
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Accept participant_id (this route's contract) or participantId (what
  // the shared PredictionForm sends).
  const participantId = (body.participant_id ?? body.participantId)?.trim();
  const { predictions } = body;

  if (typeof participantId !== "string" || !participantId) {
    return Response.json({ error: "participant_id is required." }, { status: 400 });
  }
  if (!Array.isArray(predictions) || predictions.length === 0) {
    return Response.json({ error: "predictions must be a non-empty array." }, { status: 400 });
  }

  for (const p of predictions) {
    if (
      !Number.isInteger(p?.match_id) ||
      !Number.isInteger(p?.home_pred) ||
      !Number.isInteger(p?.away_pred) ||
      p.home_pred < 0 ||
      p.home_pred > 99 ||
      p.away_pred < 0 ||
      p.away_pred > 99
    ) {
      return Response.json(
        { error: "Each prediction needs an integer match_id and integer scores between 0 and 99." },
        { status: 400 }
      );
    }
  }

  const rows = predictions.map((p) => ({
    participant_id: participantId,
    match_id: p.match_id,
    home_pred: p.home_pred,
    away_pred: p.away_pred,
  }));

  const { error } = await supabaseServer
    .from("predictions")
    .upsert(rows, { onConflict: "participant_id,match_id" });

  if (error) {
    console.error("admin predictions upsert failed:", error);
    return Response.json({ error: "Failed to save predictions." }, { status: 500 });
  }

  return Response.json({ ok: true });
}
