"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, ActionState } from "@/lib/action-state";
import { requireAdmin } from "@/lib/admin-auth";
import {
  duplicateCandidateKey,
  findDuplicateEntrant,
  type ExistingEntrant,
} from "@/lib/admin-entrants";
import { expectedBuyInPence } from "@/lib/competition";
import {
  currentRound,
  getActiveCompetition,
  getEntry,
  getFixturesForMatchday,
  getPicksForEntry,
  getRounds,
  getTeams,
  pickHistoryTeamIds,
} from "@/lib/lms-db";
import { normaliseUkPhone } from "@/lib/phone";
import { partitionByNewcomer } from "@/lib/group-payment";
import { validatePick } from "@/lib/pick-rules";
import { supabaseServer } from "@/lib/supabase-server";

/**
 * Everyone already entered in the active competition, as the duplicate check
 * wants them. Small by nature — a pub competition, not a mailing list — so this
 * reads the whole set and compares in TypeScript rather than asking PostgREST
 * for a case-insensitive match across an embedded table.
 */
async function existingEntrants(
  competitionId: string
): Promise<ExistingEntrant[]> {
  const { data, error } = await supabaseServer
    .from("entries")
    .select("participant_id, participant:participants!inner (name, phone)")
    .eq("competition_id", competitionId);

  if (error) {
    console.error("duplicate-entrant lookup failed:", error);
    // A failed lookup must not silently turn the notice off — the caller
    // treats a throw as "could not check" rather than "no duplicates".
    throw new Error(error.message);
  }

  const rows = (data ?? []) as unknown as {
    participant_id: string;
    participant: { name: string; phone: string | null } | null;
  }[];

  return rows.map((row) => ({
    participantId: row.participant_id,
    name: row.participant?.name ?? "",
    phone: row.participant?.phone ?? null,
  }));
}

/**
 * Add an entry to the active competition.
 *
 * Reuses an existing participant when one is chosen, otherwise creates the
 * person first — the person and the entry are separate records (see
 * docs/LMS-SCHEMA.md). Multi-entry is allowed by design: the same person may
 * hold several entries, each paid for and surviving independently.
 *
 * That last part is why the duplicate check below is a NOTICE and not a block.
 * A second entry for the same person is a legitimate, paid-for thing
 * (docs/LMS-RULES.md); adding the same person twice by accident is not. The two
 * are indistinguishable from here, so the action asks once and does whatever it
 * is told. No schema change: nothing about a duplicate is illegal, so nothing
 * about it belongs in a constraint.
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

  // Phone is optional; normalise when it's a clean UK number so the duplicate
  // check below compares like with like, otherwise store as written.
  const phone = phoneRaw === "" ? null : (normaliseUkPhone(phoneRaw) ?? phoneRaw);

  // ---- soft duplicate notice ----
  //
  // Work out WHO this entry is for first. When an existing person was chosen,
  // their own name and number are what to compare — the name/phone fields are
  // hidden in that mode and arrive empty.
  let candidateName = name;
  let candidatePhone = phone;

  if (existingParticipantId) {
    const { data: person, error } = await supabaseServer
      .from("participants")
      .select("name, phone")
      .eq("id", existingParticipantId)
      .maybeSingle<{ name: string; phone: string | null }>();
    if (error) {
      console.error("createEntry participant lookup failed:", error);
      return { error: "Could not read that person." };
    }
    if (!person) return { error: "That person no longer exists." };
    candidateName = person.name;
    candidatePhone = person.phone;
  }

  const candidate = {
    participantId: existingParticipantId || null,
    name: candidateName,
    phone: candidatePhone,
  };

  // A confirmation only counts for the person it was given for. The form sends
  // back the token minted with the notice; if the organiser edited the fields
  // in between, it no longer matches what is being submitted and we ask again.
  // The client clears the notice on those edits too, but this is what makes it
  // safe — the client cannot be the thing enforcing it.
  const candidateKey = duplicateCandidateKey(candidate);
  const confirmed = formData.get("confirm_duplicate") === candidateKey;

  if (!confirmed) {
    let duplicate: ExistingEntrant | null = null;
    try {
      duplicate = findDuplicateEntrant(
        candidate,
        await existingEntrants(competition.id)
      );
    } catch {
      return {
        error:
          "Could not check for an existing entry — nothing was added. Try again.",
      };
    }

    if (duplicate) {
      return {
        notice: `${duplicate.name} already has an entry in this competition — add another?`,
        confirm: candidateKey,
      };
    }
  }

  let participantId = existingParticipantId;
  let createdParticipant = false;

  if (!participantId) {
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

/**
 * Enter or change a pick on behalf of an entrant — the ONLY way a pick is ever
 * written. Players have no pick-entry surface: every pick reaches the organiser
 * through a club contact and is typed in here.
 *
 * The rules still come from the shared validator (lib/pick-rules.ts), with one
 * relaxation: the organiser may write after the deadline while the round is
 * still unsettled. That is the real situation the competition runs in — "he
 * texted me at 19:00, the game kicked off at 20:00, I was driving" — and the
 * alternative is not fairness, it is the organiser editing the database by hand
 * with no validation at all. It stays bounded: a settled round is refused, the
 * write is logged as a normal human pick, and the UI makes the organiser
 * confirm an amber warning first.
 *
 * NEVER marks auto_assigned. That flag means "the deadline passed and the
 * engine chose alphabetically"; these picks are a person's actual choice, and
 * mislabelling them would make the board tell a story that never happened.
 */
export async function setPickForEntry(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireAdmin();

  const entryId = String(formData.get("entry_id") ?? "").trim();
  const submittedRoundId = String(formData.get("round_id") ?? "").trim();
  const rawTeamId = String(formData.get("team_id") ?? "").trim();

  if (!entryId) {
    return { error: "Something went wrong — please reload and try again." };
  }
  // Blank is checked BEFORE converting: Number("") is 0, and 0 is an integer,
  // so an empty select would sail past a NaN check and then fail deeper in
  // with "that team isn't playing this round" — a confusing answer to
  // "you didn't choose anyone".
  if (rawTeamId === "") return { error: "Pick a team first." };

  const teamId = Number(rawTeamId);
  if (!Number.isInteger(teamId)) {
    return { error: "Something went wrong — please reload and try again." };
  }

  const competition = await getActiveCompetition();
  if (!competition) return { error: "No active competition." };

  const entry = await getEntry(entryId);
  if (!entry) return { error: "We couldn't find that entry." };
  if (entry.competition_id !== competition.id) {
    return { error: "That entry isn't in the active competition." };
  }

  const rounds = await getRounds(competition.id);
  // The round to write is the SERVER's current one — the form never chooses it.
  // The form's round id is carried only to be COMPARED: if the page was
  // rendered against round 3 and round 3 has since been settled, this write
  // must not quietly land on round 4 instead. validatePick refuses the
  // mismatch and the organiser refreshes.
  const round = currentRound(rounds);
  if (!round) return { error: "No round is open — every round is settled." };

  const fixtures = await getFixturesForMatchday(round.matchday);
  const teams = await getTeams();
  const roundNumberById = new Map(rounds.map((r) => [r.id, r.round_number]));
  const picks = await getPicksForEntry(entryId);
  const history = pickHistoryTeamIds(
    picks.filter((p) => p.round_id !== round.id),
    roundNumberById
  );

  const verdict = validatePick({
    entryStatus: entry.status,
    round,
    submittedRoundId: submittedRoundId || undefined,
    fixtures,
    teams,
    history,
    teamId,
    allowAfterDeadline: true,
  });
  if (!verdict.ok) return { error: verdict.error };

  const { error } = await supabaseServer.from("picks").upsert(
    {
      competition_id: competition.id,
      entry_id: entryId,
      round_id: round.id,
      team_id: teamId,
      auto_assigned: false,
      outcome: "pending",
    },
    { onConflict: "entry_id,round_id" }
  );

  if (error) {
    console.error("setPickForEntry failed:", error);
    return { error: "Could not save that pick — please try again." };
  }

  revalidatePath("/admin/entrants");
  revalidatePath("/grid");
  revalidatePath("/board");

  const team = teams.find((t) => t.id === teamId);
  const who = entry.participant?.name ?? "entry";
  return {
    ok: `${who}: ${team?.name ?? "team"} saved${
      verdict.deadlinePassed ? " (after the deadline)" : ""
    }.`,
  };
}
