import { normaliseUkPhone } from "@/lib/phone";
import { getActiveCompetition } from "@/lib/lms-db";
import { supabaseServer } from "@/lib/supabase-server";
import type { EntryStatus } from "@/lib/lms";

// "I've lost my link." Phone number in, that person's private pick links out.
//
// The whole lookup runs server-side on the secret key: `participants` and
// `entries` are revoked from the publishable key (see db/lms-schema.sql), so
// the browser could not do this itself even if it tried.
//
// Scoped to the ACTIVE competition on purpose. Entries from a finished
// competition are history — their pick pages are read-only and handing them
// back as "your entry" would send someone to the wrong round.
//
// This route never creates anything. Entry is organiser-mediated: an admin adds
// entrants against a competition, so there is deliberately no self-signup here.

export const dynamic = "force-dynamic";

type FoundEntry = {
  entryId: string;
  name: string;
  status: EntryStatus;
};

export async function POST(request: Request) {
  let body: { phone?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const phone =
    typeof body.phone === "string" ? normaliseUkPhone(body.phone) : null;

  if (!phone) {
    return Response.json(
      { error: "Enter a valid UK phone number (e.g. 07123 456789)." },
      { status: 400 }
    );
  }

  let competitionLabel: string;
  let competitionId: string;
  try {
    const competition = await getActiveCompetition();
    if (!competition) {
      // Nothing running — say so plainly rather than "not found", which reads
      // as "we don't have you" and sends people chasing the wrong problem.
      return Response.json({ entries: [], reason: "no_competition" });
    }
    competitionId = competition.id;
    competitionLabel = competition.label;
  } catch (e) {
    console.error("find-entry competition lookup failed:", e);
    return Response.json({ error: "Lookup failed." }, { status: 500 });
  }

  // Exact match on the normalised number — the same normalisation the admin
  // create path stores through, so the two cannot drift.
  const { data: people, error: peopleError } = await supabaseServer
    .from("participants")
    .select("id, name")
    .eq("phone", phone)
    .returns<{ id: string; name: string }[]>();

  if (peopleError) {
    console.error("find-entry participant lookup failed:", peopleError);
    return Response.json({ error: "Lookup failed." }, { status: 500 });
  }

  if (!people || people.length === 0) {
    return Response.json({ entries: [], reason: "no_entries" });
  }

  // Only entries belonging to THOSE people. Nobody else's entry, name or
  // status is ever read, let alone returned — and the phone is not echoed back.
  const { data: rows, error: entriesError } = await supabaseServer
    .from("entries")
    .select("id, participant_id, status, joined_at")
    .eq("competition_id", competitionId)
    .in(
      "participant_id",
      people.map((p) => p.id)
    )
    .order("joined_at")
    .returns<
      {
        id: string;
        participant_id: string;
        status: EntryStatus;
        joined_at: string;
      }[]
    >();

  if (entriesError) {
    console.error("find-entry entries lookup failed:", entriesError);
    return Response.json({ error: "Lookup failed." }, { status: 500 });
  }

  const nameById = new Map(people.map((p) => [p.id, p.name]));

  // Multiple entries are listed separately — they are independent runs with
  // their own picks and their own survival, so each gets its own link.
  const entries: FoundEntry[] = (rows ?? []).map((row) => ({
    entryId: row.id,
    name: nameById.get(row.participant_id) ?? "Your entry",
    status: row.status,
  }));

  if (entries.length === 0) {
    return Response.json({ entries: [], reason: "no_entries" });
  }

  return Response.json({ entries, competition: competitionLabel });
}
