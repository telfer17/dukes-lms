"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { normaliseUkPhone } from "@/lib/phone";
import { supabaseServer } from "@/lib/supabase-server";

type CreateState = { error: string } | null;

export async function createEntrant(
  _prevState: CreateState,
  formData: FormData
): Promise<CreateState> {
  await requireAdmin();

  const name = String(formData.get("name") ?? "").trim();
  const clubContact = String(formData.get("club_contact") ?? "").trim();
  const phoneRaw = String(formData.get("phone") ?? "").trim();
  const paid = formData.get("paid") === "on";

  if (!name) return { error: "Name is required." };
  if (!clubContact) return { error: "Club contact is required." };

  // Phone is optional for paper entrants. Normalise when it's a clean UK
  // number (keeps find-entry lookups working); otherwise store as written.
  const phone =
    phoneRaw === "" ? null : (normaliseUkPhone(phoneRaw) ?? phoneRaw);

  const { data, error } = await supabaseServer
    .from("participants")
    .insert({ name, club_contact: clubContact, phone, paid })
    .select("id")
    .single();

  if (error) {
    console.error("createEntrant failed:", error);
    return { error: "Failed to add entrant." };
  }

  redirect(`/admin/entrants/${data.id}/predict`);
}
