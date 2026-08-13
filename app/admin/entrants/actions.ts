"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { supabaseServer } from "@/lib/supabase-server";

export async function setPaid(id: string, paid: boolean): Promise<void> {
  await requireAdmin();
  const { error } = await supabaseServer
    .from("participants")
    .update({ paid })
    .eq("id", id);
  if (error) {
    console.error("setPaid failed:", error);
    throw new Error("Failed to update payment status.");
  }
  revalidatePath("/admin/entrants");
}

export async function markGroupPaid(clubContact: string): Promise<void> {
  await requireAdmin();
  // groupEntrants buckets NULL club_contact under "" — match that here.
  const query = supabaseServer.from("participants").update({ paid: true });
  const { error } =
    clubContact === ""
      ? await query.is("club_contact", null)
      : await query.eq("club_contact", clubContact);
  if (error) {
    console.error("markGroupPaid failed:", error);
    throw new Error("Failed to mark group paid.");
  }
  revalidatePath("/admin/entrants");
}

export async function deleteParticipant(id: string): Promise<void> {
  await requireAdmin();
  const { error } = await supabaseServer
    .from("participants")
    .delete()
    .eq("id", id);
  if (error) {
    console.error("deleteParticipant failed:", error);
    throw new Error("Failed to delete participant.");
  }
  revalidatePath("/admin/entrants");
}
