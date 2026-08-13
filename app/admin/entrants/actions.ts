"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, ActionState } from "@/lib/action-state";
import { requireAdmin } from "@/lib/admin-auth";
import { expectedBuyInPence } from "@/lib/competition";
import { getActiveCompetition } from "@/lib/lms-db";
import { normaliseUkPhone } from "@/lib/phone";
import { partitionByNewcomer } from "@/lib/group-payment";
import { supabaseServer } from "@/lib/supabase-server";

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
  let createdParticipant = false;

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
    createdParticipant = true;
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
    // Undo the person we just created, or a retry silently makes a second one
    // and the picker fills up with duplicates nobody can tell apart.
    if (createdParticipant) {
      const { error: cleanupError } = await supabaseServer
        .from("participants")
        .delete()
        .eq("id", participantId);
      if (cleanupError) {
        console.error("createEntry rollback failed:", cleanupError);
      }
    }
    return { error: "Could not create the entry." };
  }

  revalidatePath("/admin/entrants");
  return { ok: "Entry added." };
}

/**
 * Toggle payment on one entry, recording what was actually paid.
 *
 * Returns a result rather than throwing: the caller is a checkbox in a
 * transition, and a thrown server-action error is swallowed into a generic
 * boundary message instead of reaching the row.
 */
export async function setEntryPaid(
  entryId: string,
  paid: boolean,
  amountPence: number
): Promise<ActionResult> {
  await requireAdmin();

  if (!Number.isInteger(amountPence) || amountPence < 0) {
    return { error: "Invalid amount." };
  }

  const { error } = await supabaseServer
    .from("entries")
    .update({ paid, amount_paid_pence: paid ? amountPence : 0 })
    .eq("id", entryId);

  if (error) {
    console.error("setEntryPaid failed:", error);
    return { error: "Failed to update payment." };
  }
  revalidatePath("/admin/entrants");
  return { ok: true };
}

/**
 * Mark every unpaid entry in a club-contact group paid, at each one's expected
 * amount. Newcomers and returning players owe different amounts, so this is two
 * bulk updates partitioned by the flag rather than a row-at-a-time loop.
 *
 * Not wrapped in a transaction: a partial failure is benign here — the filter
 * is "unpaid only", so re-running simply marks whatever was left. Genuine
 * atomicity arrives with the scheduled Postgres-function hardening pass.
 */
export async function markGroupPaid(
  clubContact: string
): Promise<ActionResult> {
  await requireAdmin();

  const competition = await getActiveCompetition();
  if (!competition) return { error: "No active competition." };

  // The embedded participants table is aliased `participant`, and PostgREST
  // accepts either the alias or the table name in the filter; the alias is used
  // here so the filter reads consistently with the select.
  const query = supabaseServer
    .from("entries")
    .select("id, is_newcomer, participant:participants!inner (club_contact)")
    .eq("competition_id", competition.id)
    .eq("paid", false);

  const { data, error } =
    clubContact === ""
      ? await query.is("participant.club_contact", null)
      : await query.eq("participant.club_contact", clubContact);

  if (error) {
    console.error("markGroupPaid lookup failed:", error);
    return { error: "Failed to read the group." };
  }

  const rows = (data ?? []) as unknown as {
    id: string;
    is_newcomer: boolean;
  }[];
  const { newcomerIds, returningIds } = partitionByNewcomer(rows);

  for (const [ids, isNewcomer] of [
    [newcomerIds, true],
    [returningIds, false],
  ] as [string[], boolean][]) {
    if (ids.length === 0) continue;
    const { error: updateError } = await supabaseServer
      .from("entries")
      .update({
        paid: true,
        amount_paid_pence: expectedBuyInPence(
          competition.rollover_count,
          isNewcomer
        ),
      })
      .in("id", ids);
    if (updateError) {
      console.error("markGroupPaid update failed:", updateError);
      return { error: "Failed to mark the group paid." };
    }
  }

  revalidatePath("/admin/entrants");
  return { ok: true };
}

/** Delete an entry. The person stays — they may hold other entries. */
export async function deleteEntry(entryId: string): Promise<ActionResult> {
  await requireAdmin();

  const { error } = await supabaseServer
    .from("entries")
    .delete()
    .eq("id", entryId);

  if (error) {
    console.error("deleteEntry failed:", error);
    return { error: "Failed to delete the entry." };
  }
  revalidatePath("/admin/entrants");
  return { ok: true };
}
