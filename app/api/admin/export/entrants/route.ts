import { requireAdmin } from "@/lib/admin-auth";
import { csvSafeText, toCsv } from "@/lib/csv";
import { supabaseServer } from "@/lib/supabase-server";

// YYYY-MM-DD in UK time, so a late-night export doesn't roll to the UTC date.
const dateStamp = new Intl.DateTimeFormat("en-CA", {
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

export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let participants: Participant[];
  try {
    const res = await supabaseServer
      .from("participants")
      .select("id, name, club_contact, phone")
      .returns<Participant[]>();
    if (res.error) throw new Error(res.error.message);
    participants = res.data ?? [];
  } catch (e) {
    console.error("export entrants failed:", e);
    return Response.json({ error: "Export failed." }, { status: 500 });
  }

  participants.sort(
    (a, b) =>
      (a.club_contact ?? "").localeCompare(b.club_contact ?? "") ||
      a.name.localeCompare(b.name)
  );

  const csv = toCsv(
    ["name", "club_contact", "phone"],
    participants.map((p) => [
      csvSafeText(p.name),
      csvSafeText(p.club_contact),
      phoneCell(p.phone),
    ])
  );

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="dukes-lms-entrants-${dateStamp.format(new Date())}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
