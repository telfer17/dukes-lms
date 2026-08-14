// The public board's column list is a security boundary, not a preference.
//
// entries.id is the handle every write path in the app takes. It must never be
// fetched by anything that renders a public page, because a React `key` is
// serialised into the RSC payload: keying the board off the entry id publishes
// every entry's internal id in the page source of /board, readable by anyone
// who opens it. (Reproduced against a dev render before this guard existed,
// when that id was also the credential for the since-deleted /pick/[entryId].)
//
// This test pins the column list rather than the rendering, because the column
// list is the one place the id could re-enter: put `entry_id` back in the select
// and this fails.

import { describe, expect, it, vi } from "vitest";

// lib/public-read pulls in the browser Supabase client, which refuses to load
// without these. Stubbed before the import, the same way tests/admin-auth does.
vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");

const { PUBLIC_BOARD_COLUMNS } = await import("@/lib/public-read");

const columns = PUBLIC_BOARD_COLUMNS.split(",").map((c) => c.trim());

describe("public board columns", () => {
  it("never fetches the pick-link credential", () => {
    expect(columns).not.toContain("entry_id");
    expect(columns).not.toContain("id");
    // Substring check too: "entries.id", "e.id as entry_id" and friends would
    // all slip past an exact-match assertion.
    expect(PUBLIC_BOARD_COLUMNS).not.toMatch(/\bid\b/);
  });

  it("never fetches private participant fields", () => {
    for (const forbidden of [
      "phone",
      "amount_paid_pence",
      "paid",
      "club_contact",
    ]) {
      expect(PUBLIC_BOARD_COLUMNS).not.toContain(forbidden);
    }
  });

  it("still fetches what the board actually renders", () => {
    expect(columns).toEqual([
      "competition_id",
      "name",
      "status",
      "eliminated_round_number",
    ]);
  });
});
