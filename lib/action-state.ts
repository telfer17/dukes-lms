// Shared result shape for the admin/player server actions, so every form can
// render an ok/error line the same way. Null means "not submitted yet".
export type ActionState = { error: string } | { ok: string } | null;

/** Result of a small imperative action (checkbox, delete) — no form state. */
export type ActionResult = { ok: true } | { error: string };
