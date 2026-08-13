// Shared admin session helpers. Uses Web Crypto (crypto.subtle) only, so
// the same code runs in the proxy (route protection) and in node (server
// actions, tests).

export const ADMIN_COOKIE = "gw_admin";

/** Hex SHA-256 of the password — the value stored in the session cookie. */
export async function sessionToken(password: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(password)
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Constant-time string comparison: examines every character regardless of
 * where the first mismatch is, so timing doesn't leak prefix matches.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Whether a gw_admin cookie value is a valid session for ADMIN_PASSWORD. */
export async function isValidSession(
  cookieValue: string | undefined
): Promise<boolean> {
  const password = process.env.ADMIN_PASSWORD;
  if (!cookieValue || !password) return false;
  return constantTimeEqual(cookieValue, await sessionToken(password));
}

/**
 * Defense-in-depth guard for admin server actions: throws unless the
 * request carries a valid gw_admin session cookie. next/headers is imported
 * lazily so this module stays loadable from the proxy and from node tests.
 */
export async function requireAdmin(): Promise<void> {
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  if (!(await isValidSession(cookieStore.get(ADMIN_COOKIE)?.value))) {
    throw new Error("Unauthorized");
  }
}
