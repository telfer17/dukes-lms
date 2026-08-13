// Accidental duplicate-entry protection on the public participants route:
// same normalised phone + name + club_contact (case/space-insensitive)
// returns the existing id instead of inserting a second row.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEADLINE } from "@/lib/constants";

const lookupEq = vi.fn();
const insert = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: lookupEq })),
      insert: insert.mockReturnValue({
        select: vi.fn(() => ({
          single: vi.fn(async () => ({ data: { id: "new-id" }, error: null })),
        })),
      }),
    })),
  },
}));

import { POST } from "@/app/api/participants/route";

function request(body: unknown): Request {
  return new Request("http://localhost/api/participants", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const existingRow = {
  id: "existing-id",
  name: "John Smith",
  club_contact: "Dave Jones",
};

beforeEach(() => {
  vi.useFakeTimers();
  // One day before the deadline — the route is open.
  vi.setSystemTime(new Date(DEADLINE.getTime() - 24 * 60 * 60 * 1000));
  lookupEq.mockReset();
  insert.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("duplicate entry protection", () => {
  it("returns the existing id (no insert) for a matching re-submit", async () => {
    lookupEq.mockResolvedValue({ data: [existingRow], error: null });
    const res = await POST(
      request({
        name: "  john smith ",
        club_contact: "DAVE JONES",
        phone: "+44 7123 456789",
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "existing-id" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("inserts when the name differs (deliberate second entry)", async () => {
    lookupEq.mockResolvedValue({ data: [existingRow], error: null });
    const res = await POST(
      request({
        name: "John Smith (2)",
        club_contact: "Dave Jones",
        phone: "07123456789",
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "new-id" });
    expect(insert).toHaveBeenCalledOnce();
  });

  it("inserts when the phone has no existing entries", async () => {
    lookupEq.mockResolvedValue({ data: [], error: null });
    const res = await POST(
      request({
        name: "John Smith",
        club_contact: "Dave Jones",
        phone: "07123456789",
      })
    );
    expect(await res.json()).toEqual({ id: "new-id" });
    expect(insert).toHaveBeenCalledOnce();
  });

  it("returns 500 when the lookup query fails", async () => {
    lookupEq.mockResolvedValue({
      data: null,
      error: { message: "connection refused" },
    });
    const res = await POST(
      request({
        name: "John Smith",
        club_contact: "Dave Jones",
        phone: "07123456789",
      })
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to create entry." });
    expect(insert).not.toHaveBeenCalled();
  });

  it("inserts when only the club contact differs", async () => {
    lookupEq.mockResolvedValue({ data: [existingRow], error: null });
    const res = await POST(
      request({
        name: "John Smith",
        club_contact: "Someone Else",
        phone: "07123456789",
      })
    );
    expect(await res.json()).toEqual({ id: "new-id" });
    expect(insert).toHaveBeenCalledOnce();
  });
});
