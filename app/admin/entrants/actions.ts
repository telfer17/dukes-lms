"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { expectedBuyInPence } from "@/lib/competition";
import { getActiveCompetition } from "@/lib/lms-db";
import { normaliseUkPhone } from "@/lib/phone";
import { supabaseServer } from "@/lib/supabase-server";

export type ActionState = { error: string } | { ok: string } | null;

/**
 * Add an entry to the active competition.
 *
 * Reuses an existing participant when one is chosen, otherwise creates the
 * person first — the person and the entry are separate records (see
 * docs/LMS-SCHEMA.md). Multi-entry is allowed by design: the same person may
 * hold several entries, each paid for and surviving independently.
 */
export async function createEntry(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireAdmin();

  const competition = await getActiveCompetition();
  if (!competition) {
    return { error: "No active competition — create one first." };
  }

  const existingParticipantId = String(
    formData.get("participant_id") ?? ""
  ).trim();
  const name = String(formData.get("name") ?? "").trim();
  const clubContact = String(formData.get("club_contact") ?? "").trim();
  const phoneRaw = String(formData.get("phone") ?? "").trim();
  const isNewcomer = formData.get("is_newcomer") === "on";
  const paid = formData.get("paid") === "on";
  const amountRaw = String(formData.get("amount_paid_pounds") ?? "").trim();

  if (!existingParticipantId && !name) {
    return { error: "Pick an existing person, or give a name." };
  }
  if (!existingParticipantId && !clubContact) {
    return { error: "Club contact is required." };
  }

  const expected = expectedBuyInPence(competition.rollover_count, isNewcomer);
  const amountPence =
    amountRaw === "" ? (paid ? expected : 0) : Math.round(Number(amountRaw) * 100);
  if (!Number.isInteger(amountPence) || amountPence < 0) {
    return { error: "Amount paid must be 0 or more." };
  }

  let participantId = existingParticipantId;

  if (!participantId) {
    // Phone is optional; normalise when it's a clean UK number so the
    // find-entry lookup keeps working, otherwise store as written.
    const phone =
      phoneRaw === "" ? null : (normaliseUkPhone(phoneRaw) ?? phoneRaw);

    const { data, error } = await supabaseServer
      .from("participants")
      .insert({ name, club_contact: clubContact, phone })
      .select("id")
      .single();

    if (error) {
      console.error("createEntry participant insert failed:", error);
      return { error: "Could not create the person." };
    }
    participantId = data.id;
  }

  const { error } = await supabaseServer.from("entries").insert({
    competition_id: competition.id,
    participant_id: participantId,
    paid,
    amount_paid_pence: amountPence,
    is_newcomer: isNewcomer,
    status: "active",
  });

  if (error) {
    console.error("createEntry entry insert failed:", error);
    return { error: "Could not create the entry." };
  }

  revalidatePath("/admin/entrants");
  return { ok: "Entry added." };
}

/** Toggle payment on one entry, recording what was actually paid. */
export async function setEntryPaid(
  entryId: string,
  paid: boolean,
  amountPence: number
): Promise<void> {
  await requireAdmin();

  if (!Number.isInteger(amountPence) || amountPence < 0) {
    throw new Error("Invalid amount.");
  }

  const { error } = await supabaseServer
    .from("entries")
    .update({ paid, amount_paid_pence: paid ? amountPence : 0 })
    .eq("id", entryId);

  if (error) {
    console.error("setEntryPaid failed:", error);
    throw new Error("Failed to update payment.");
  }
  revalidatePath("/admin/entrants");
}

/** Mark every entry in a club-contact group paid, at each one's expected amount. */
export async function markGroupPaid(clubContact: string): Promise<void> {
  await requireAdmin();

  const competition = await getActiveCompetition();
  if (!competition) throw new Error("No active competition.");

  const query = supabaseServer
    .from("entries")
    .select("id, is_newcomer, participant:participants!inner (club_contact)")
    .eq("competition_id", competition.id)
    .eq("paid", false);

  const { data, error } =
    clubContact === ""
      ? await query.is("participants.club_contact", null)
      : await query.eq("participants.club_contact", clubContact);

  if (error) {
    console.error("markGroupPaid lookup failed:", error);
    throw new Error("Failed to read the group.");
  }

  const rows = (data ?? []) as unknown as { id: string; is_newcomer: boolean }[];
  for (const row of rows) {
    const { error: updateError } = await supabaseServer
      .from("entries")
      .update({
        paid: true,
        amount_paid_pence: expectedBuyInPence(
          competition.rollover_count,
          row.is_newcomer
        ),
      })
      .eq("id", row.id);
    if (updateError) {
      console.error("markGroupPaid update failed:", updateError);
      throw new Error("Failed to mark the group paid.");
    }
  }

  revalidatePath("/admin/entrants");
}

/** Delete an entry. The person stays — they may hold other entries. */
export async function deleteEntry(entryId: string): Promise<void> {
  await requireAdmin();

  const { error } = await supabaseServer
    .from("entries")
    .delete()
    .eq("id", entryId);

  if (error) {
    console.error("deleteEntry failed:", error);
    throw new Error("Failed to delete the entry.");
  }
  revalidatePath("/admin/entrants");
}
