import { requireAdmin } from "@/lib/admin-auth";
import { formatPence } from "@/lib/competition";
import { csvSafeText, toCsv } from "@/lib/csv";
import { getActiveCompetition, getEntries } from "@/lib/lms-db";

// YYYY-MM-DD in UK time, so a late-night export doesn't roll to the UTC date.
const dateStamp = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// Wrap the phone as an Excel/Sheets text formula so the leading 0 survives.
const phoneCell = (phone: string | null) => (phone ? `="${phone}"` : "");

// Secret-key only: this carries phone numbers and payment amounts, which are
// never exposed to the publishable key. Admin session required.
export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const competition = await getActiveCompetition();
    if (!competition) {
      return Response.json({ error: "No active competition." }, { status: 404 });
    }

    const entries = await getEntries(competition.id);
    entries.sort(
      (a, b) =>
        (a.participant?.club_contact ?? "").localeCompare(
          b.participant?.club_contact ?? ""
        ) || (a.participant?.name ?? "").localeCompare(b.participant?.name ?? "")
    );

    const csv = toCsv(
      [
        "name",
        "club_contact",
        "phone",
        "paid",
        "amount_paid",
        "amount_paid_pence",
        "is_newcomer",
        "status",
      ],
      entries.map((e) => [
        csvSafeText(e.participant?.name),
        csvSafeText(e.participant?.club_contact),
        phoneCell(e.participant?.phone ?? null),
        e.paid ? "yes" : "no",
        formatPence(e.amount_paid_pence),
        e.amount_paid_pence,
        e.is_newcomer ? "yes" : "no",
        e.status,
      ])
    );

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="dukes-lms-entries-${dateStamp.format(new Date())}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("export entries failed:", e);
    return Response.json({ error: "Export failed." }, { status: 500 });
  }
}
