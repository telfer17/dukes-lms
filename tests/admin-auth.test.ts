import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidSession, sessionToken } from "@/lib/admin-auth";

const PASSWORD = "test-admin-password";

beforeEach(() => {
  vi.stubEnv("ADMIN_PASSWORD", PASSWORD);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sessionToken", () => {
  it("returns a 64-char hex string", async () => {
    expect(await sessionToken(PASSWORD)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same input", async () => {
    expect(await sessionToken(PASSWORD)).toBe(await sessionToken(PASSWORD));
  });

  it("differs for different inputs", async () => {
    expect(await sessionToken(PASSWORD)).not.toBe(
      await sessionToken("something-else")
    );
  });
});

describe("isValidSession", () => {
  it("accepts the correct token", async () => {
    expect(await isValidSession(await sessionToken(PASSWORD))).toBe(true);
  });

  it("rejects a wrong token", async () => {
    expect(await isValidSession(await sessionToken("wrong-password"))).toBe(
      false
    );
  });

  it("rejects undefined", async () => {
    expect(await isValidSession(undefined)).toBe(false);
  });
});
