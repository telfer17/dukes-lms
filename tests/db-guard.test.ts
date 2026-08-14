import { afterEach, describe, expect, it } from "vitest";
import { assertSafeDatabaseUrl } from "./db/harness";

// The integration suite truncates every table it can reach. This guard is the
// only thing standing between a mistyped LMS_TEST_DATABASE_URL and a live
// competition, so it is tested like the safety device it is — and tested HERE,
// in the ordinary suite, so it runs on every machine including the ones with no
// database at all.

const originalAllowRemote = process.env.LMS_TEST_ALLOW_REMOTE;

afterEach(() => {
  if (originalAllowRemote === undefined) delete process.env.LMS_TEST_ALLOW_REMOTE;
  else process.env.LMS_TEST_ALLOW_REMOTE = originalAllowRemote;
});

describe("assertSafeDatabaseUrl", () => {
  it("allows a local scratch cluster", () => {
    delete process.env.LMS_TEST_ALLOW_REMOTE;
    for (const url of [
      "postgres://postgres@127.0.0.1:55432/lms_test",
      "postgres://postgres@localhost:5432/lms_test",
      "postgresql://user:pw@localhost:5432/db?sslmode=disable",
      "postgres://postgres@mymac.local:5432/lms_test",
    ]) {
      expect(() => assertSafeDatabaseUrl(url)).not.toThrow();
    }
  });

  it("REFUSES a Supabase database, and says so by name", () => {
    delete process.env.LMS_TEST_ALLOW_REMOTE;
    expect(() =>
      assertSafeDatabaseUrl("postgres://u:p@db.abcdefgh.supabase.co:5432/postgres")
    ).toThrow(/Supabase/);
    expect(() =>
      assertSafeDatabaseUrl("postgres://u:p@aws-0-eu-west-2.pooler.supabase.com:6543/postgres")
    ).toThrow(/Refusing to run/);
  });

  it("REFUSES any other non-local host", () => {
    delete process.env.LMS_TEST_ALLOW_REMOTE;
    for (const url of [
      "postgres://u:p@db.example.com:5432/postgres",
      "postgres://u:p@10.0.0.7:5432/postgres",
      "postgres://u:p@192.168.1.20:5432/postgres",
    ]) {
      expect(() => assertSafeDatabaseUrl(url)).toThrow(/TRUNCATE/);
    }
  });

  it("explains itself when the URL is not a URL at all", () => {
    delete process.env.LMS_TEST_ALLOW_REMOTE;
    expect(() => assertSafeDatabaseUrl("not a url")).toThrow(
      /not a valid connection URL/
    );
    expect(() => assertSafeDatabaseUrl("")).toThrow(/not a valid connection URL/);
  });

  it("gets out of the way when the escape hatch is set explicitly", () => {
    process.env.LMS_TEST_ALLOW_REMOTE = "1";
    expect(() =>
      assertSafeDatabaseUrl("postgres://u:p@db.abcdefgh.supabase.co:5432/postgres")
    ).not.toThrow();
  });

  it("is not fooled by a near-miss value in the escape hatch", () => {
    // Only an explicit "1" counts — not "true", not "yes", not an empty string
    // someone left behind in a shell profile.
    for (const value of ["true", "yes", "0", ""]) {
      process.env.LMS_TEST_ALLOW_REMOTE = value;
      expect(() =>
        assertSafeDatabaseUrl("postgres://u:p@db.abcdefgh.supabase.co:5432/postgres")
      ).toThrow(/Refusing to run/);
    }
  });
});
