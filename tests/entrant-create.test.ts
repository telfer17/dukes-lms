import { beforeEach, describe, expect, it, vi } from "vitest";

// createEntry's duplicate NOTICE is a soft stop, and a soft stop is only worth
// anything if it cannot be walked past by accident. These tests drive the real
// server action against an in-memory stand-in for Supabase — the fake answers
// only the handful of query shapes the action actually builds, so it stays
// small enough to read and specific enough to break if the action starts asking
// for something different.

const h = vi.hoisted(() => {
  type Participant = {
    id: string;
    name: string;
    phone: string | null;
    club_contact: string | null;
  };
  type Entry = { id: string; competition_id: string; participant_id: string };

  const store = {
    competition: {
      id: "c1",
      label: "Test competition",
      status: "active",
      rollover_count: 0,
      pot_carried_in_pence: 0,
      winner_participant_id: null,
      created_at: "",
    },
    participants: [] as Participant[],
    entries: [] as Entry[],
    nextId: 1,
  };

  const matches = (row: Record<string, unknown>, filters: [string, unknown][]) =>
    filters.every(([col, val]) => row[col] === val);

  type Query = {
    table: string;
    op: "select" | "insert" | "delete";
    payload: Record<string, unknown> | null;
    filters: [string, unknown][];
  };

  function exec(q: Query, mode: "maybeSingle" | "single" | "many") {
    if (q.op === "insert") {
      const payload = q.payload ?? {};
      if (q.table === "participants") {
        const row: Participant = {
          id: `p${store.nextId++}`,
          name: String(payload.name ?? ""),
          phone: (payload.phone as string | null) ?? null,
          club_contact: (payload.club_contact as string | null) ?? null,
        };
        store.participants.push(row);
        return { data: { id: row.id }, error: null };
      }
      store.entries.push({
        id: `e${store.nextId++}`,
        competition_id: String(payload.competition_id),
        participant_id: String(payload.participant_id),
      });
      return { data: null, error: null };
    }

    if (q.op === "delete") {
      store.participants = store.participants.filter(
        (p) => !matches(p as unknown as Record<string, unknown>, q.filters)
      );
      return { data: null, error: null };
    }

    let rows: Record<string, unknown>[];
    if (q.table === "participants") {
      rows = store.participants.filter((p) =>
        matches(p as unknown as Record<string, unknown>, q.filters)
      );
    } else {
      // The action reads entries with the participant embedded, so the fake
      // resolves that join rather than pretending the shape is flat.
      rows = store.entries
        .filter((e) => matches(e as unknown as Record<string, unknown>, q.filters))
        .map((e) => {
          const person = store.participants.find(
            (p) => p.id === e.participant_id
          );
          return {
            participant_id: e.participant_id,
            participant: person
              ? { name: person.name, phone: person.phone }
              : null,
          };
        });
    }

    if (mode === "maybeSingle") return { data: rows[0] ?? null, error: null };
    if (mode === "single") {
      return rows.length === 1
        ? { data: rows[0], error: null }
        : { data: null, error: { message: "expected exactly one row" } };
    }
    return { data: rows, error: null };
  }

  function from(table: string) {
    const q: Query = { table, op: "select", payload: null, filters: [] };
    const api = {
      select: () => api,
      insert: (payload: Record<string, unknown>) => {
        q.op = "insert";
        q.payload = payload;
        return api;
      },
      delete: () => {
        q.op = "delete";
        return api;
      },
      eq: (col: string, val: unknown) => {
        q.filters.push([col, val]);
        return api;
      },
      maybeSingle: () => Promise.resolve(exec(q, "maybeSingle")),
      single: () => Promise.resolve(exec(q, "single")),
      // Awaiting the builder itself runs the query, the way supabase-js does.
      then: (
        onOk: (v: unknown) => unknown,
        onErr?: (e: unknown) => unknown
      ) => Promise.resolve(exec(q, "many")).then(onOk, onErr),
    };
    return api;
  }

  return { store, supabaseServer: { from } };
});

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: async () => {} }));
vi.mock("@/lib/lms-db", () => ({
  getActiveCompetition: async () => h.store.competition,
}));
vi.mock("@/lib/supabase-server", () => ({ supabaseServer: h.supabaseServer }));

const { createEntry } = await import("@/app/admin/entrants/actions");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function add(fields: Record<string, string>) {
  return createEntry(null, form(fields));
}

function confirmToken(state: unknown): string {
  if (!state || typeof state !== "object" || !("confirm" in state)) {
    throw new Error(`expected a notice with a confirm token, got ${JSON.stringify(state)}`);
  }
  return (state as { confirm: string }).confirm;
}

beforeEach(() => {
  h.store.participants = [];
  h.store.entries = [];
  h.store.nextId = 1;
});

describe("createEntry duplicate notice", () => {
  it("adds a brand-new person without complaint", async () => {
    expect(await add({ name: "Ann Adams", club_contact: "Jo" })).toEqual({
      ok: "Entry added.",
    });
    expect(h.store.entries).toHaveLength(1);
  });

  it("notices a second entry for the same name, and does not create it yet", async () => {
    await add({ name: "Ann Adams", club_contact: "Jo" });

    const state = await add({ name: "ann adams", club_contact: "Jo" });
    expect(state).toMatchObject({
      notice: "Ann Adams already has an entry in this competition — add another?",
    });
    // Still one entry: a notice is a stop, even though it is a soft one.
    expect(h.store.entries).toHaveLength(1);
  });

  it("goes ahead once the confirmation matches the person confirmed", async () => {
    await add({ name: "Ann Adams", club_contact: "Jo" });
    const notice = await add({ name: "Ann Adams", club_contact: "Jo" });

    const state = await add({
      name: "Ann Adams",
      club_contact: "Jo",
      confirm_duplicate: confirmToken(notice),
    });
    expect(state).toEqual({ ok: "Entry added." });
    expect(h.store.entries).toHaveLength(2);
  });

  // The regression this whole mechanism exists for.
  it("RE-PROMPTS when the confirmation was given for a different person", async () => {
    await add({ name: "Ann Adams", club_contact: "Jo" });
    await add({ name: "Bea Brown", club_contact: "Jo" });
    expect(h.store.entries).toHaveLength(2);

    // Organiser is warned about a second entry for Ann and confirms it...
    const annNotice = await add({ name: "Ann Adams", club_contact: "Jo" });
    const annToken = confirmToken(annNotice);

    // ...but then edits the form to Bea — who also already has an entry — and
    // submits with Ann's confirmation still attached. Bea must be re-prompted,
    // not silently created on the strength of a "yes" about somebody else.
    const state = await add({
      name: "Bea Brown",
      club_contact: "Jo",
      confirm_duplicate: annToken,
    });

    expect(state).toMatchObject({
      notice: "Bea Brown already has an entry in this competition — add another?",
    });
    expect(h.store.entries).toHaveLength(2);

    // Confirming Bea specifically does go through.
    expect(
      await add({
        name: "Bea Brown",
        club_contact: "Jo",
        confirm_duplicate: confirmToken(state),
      })
    ).toEqual({ ok: "Entry added." });
    expect(h.store.entries).toHaveLength(3);
  });

  it("ignores a made-up or leftover confirmation value", async () => {
    await add({ name: "Ann Adams", club_contact: "Jo" });

    for (const token of ["on", "true", "1", '["","ann adams",""]x']) {
      const state = await add({
        name: "Ann Adams",
        club_contact: "Jo",
        confirm_duplicate: token,
      });
      expect(state).toMatchObject({ notice: expect.stringContaining("Ann Adams") });
    }
    expect(h.store.entries).toHaveLength(1);
  });

  it("notices a repeated phone number even under a different name", async () => {
    await add({ name: "Ann Adams", club_contact: "Jo", phone: "07123456789" });

    const state = await add({
      name: "A. Adams",
      club_contact: "Jo",
      phone: "+44 7123 456789",
    });
    expect(state).toMatchObject({ notice: expect.stringContaining("Ann Adams") });
    expect(h.store.entries).toHaveLength(1);
  });

  it("notices when an existing person is picked from the list", async () => {
    await add({ name: "Ann Adams", club_contact: "Jo" });
    const ann = h.store.participants[0];

    const state = await add({ participant_id: ann.id });
    expect(state).toMatchObject({ notice: expect.stringContaining("Ann Adams") });

    expect(
      await add({ participant_id: ann.id, confirm_duplicate: confirmToken(state) })
    ).toEqual({ ok: "Entry added." });
    expect(h.store.entries).toHaveLength(2);
  });

  it("does not accept a confirmation minted for a typed name as one for a picked person", async () => {
    await add({ name: "Ann Adams", club_contact: "Jo" });
    const ann = h.store.participants[0];

    // Same human, different route in — and therefore a different candidate, so
    // the token does not carry across.
    const typed = await add({ name: "Ann Adams", club_contact: "Jo" });
    const state = await add({
      participant_id: ann.id,
      confirm_duplicate: confirmToken(typed),
    });

    expect(state).toMatchObject({ notice: expect.stringContaining("Ann Adams") });
    expect(h.store.entries).toHaveLength(1);
  });
});
