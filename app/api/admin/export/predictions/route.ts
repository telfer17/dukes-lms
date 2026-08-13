import { requireAdmin } from "@/lib/admin-auth";
import { csvSafeText, toCsv } from "@/lib/csv";
import { supabaseServer } from "@/lib/supabase-server";

// YYYY-MM-DD in UK time, used for both the filename and each match_date.
const ukDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

type Participant = {
  id: string;
  name: string;
  club_contact: string | null;
  phone: string | null;
};

// Wrap the phone as an Excel/Sheets text formula so the leading 0 survives
// (a bare "07…" gets read as a number and the 0 is dropped on open).
const phoneCell = (phone: string | null) => (phone ? `="${phone}"` : "");

type Match = {
  id: number;
  home: string;
  away: string;
  kickoff: string;
};

type Prediction = {
  participant_id: string;
  match_id: number;
  home_pred: number;
  away_pred: number;
};

async function allPredictions(): Promise<Prediction[]> {
  const rows: Prediction[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseServer
      .from("predictions")
      .select("participant_id, match_id, home_pred, away_pred")
      .range(from, from + PAGE - 1)
      .returns<Prediction[]>();
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let participants: Participant[];
  let matches: Match[];
  let predictions: Prediction[];
  try {
    const [p, m, preds] = await Promise.all([
      supabaseServer
        .from("participants")
        .select("id, name, club_contact, phone")
        .returns<Participant[]>(),
      supabaseServer.from("matches").select("id, home, away, kickoff").returns<Match[]>(),
      allPredictions(),
    ]);
    if (p.error) throw new Error(p.error.message);
    if (m.error) throw new Error(m.error.message);
    participants = p.data ?? [];
    matches = m.data ?? [];
    predictions = preds;
  } catch (e) {
    console.error("export predictions failed:", e);
    return Response.json({ error: "Export failed." }, { status: 500 });
  }

  const participantById = new Map(participants.map((p) => [p.id, p]));
  const matchById = new Map(matches.map((m) => [m.id, m]));

  const rows = predictions
    .map((pred) => {
      const entrant = participantById.get(pred.participant_id);
      const match = matchById.get(pred.match_id);
      if (!entrant || !match) return null;
      return {
        name: entrant.name,
        kickoff: match.kickoff,
        cells: [
          csvSafeText(entrant.name),
          csvSafeText(entrant.club_contact),
          phoneCell(entrant.phone),
          ukDate.format(new Date(match.kickoff)),
          match.home,
          match.away,
          pred.home_pred,
          pred.away_pred,
        ],
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime()
    );

  const csv = toCsv(
    [
      "entrant_name",
      "club_contact",
      "phone",
      "match_date",
      "home_team",
      "away_team",
      "home_pred",
      "away_pred",
    ],
    rows.map((r) => r.cells)
  );

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="glasgow-wellington-predictions-${ukDate.format(new Date())}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
