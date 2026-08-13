import { normaliseUkPhone } from "@/lib/phone";
import { supabaseServer } from "@/lib/supabase-server";

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

  const { data, error } = await supabaseServer
    .from("participants")
    .select("id, name")
    .eq("phone", phone);

  if (error) {
    console.error("find-entry lookup failed:", error);
    return Response.json({ error: "Lookup failed." }, { status: 500 });
  }

  return Response.json({ entries: data ?? [] });
}
