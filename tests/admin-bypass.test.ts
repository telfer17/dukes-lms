// The critical guarantee of admin section 3: after the public deadline,
// the public predictions route refuses saves (403) while the admin route
// still accepts them (paper sheets that arrived on time get keyed in late).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEADLINE } from "@/lib/constants";

const upsert = vi.fn(async () => ({ error: null }));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: vi.fn(() => ({ upsert })),
  },
}));

vi.mock("@/lib/admin-auth", () => ({
  requireAdmin: vi.fn(async () => {}),
}));

import { POST as publicPost } from "@/app/api/predictions/route";
import { POST as adminPost } from "@/app/api/admin/predictions/route";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const predictions = [{ match_id: 1, home_pred: 2, away_pred: 1 }];

beforeEach(() => {
  vi.useFakeTimers();
  // One hour past the deadline.
  vi.setSystemTime(new Date(DEADLINE.getTime() + 60 * 60 * 1000));
  upsert.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("post-deadline behaviour", () => {
  it("public route returns 403 after the deadline", async () => {
    const res = await publicPost(
      jsonRequest({ participantId: "p1", predictions })
    );
    expect(res.status).toBe(403);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("admin route still saves after the deadline", async () => {
    const res = await adminPost(
      jsonRequest({ participant_id: "p1", predictions })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(upsert).toHaveBeenCalledWith(
      [{ participant_id: "p1", match_id: 1, home_pred: 2, away_pred: 1 }],
      { onConflict: "participant_id,match_id" }
    );
  });
});
