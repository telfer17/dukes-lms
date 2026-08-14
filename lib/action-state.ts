// Shared result shape for the admin/player server actions, so every form can
// render an ok/error line the same way. Null means "not submitted yet".
//
// `notice` is a SOFT stop: the action declined to act this once and is asking
// for one more confirmation, not reporting a failure. It is deliberately not an
// `error` — rendering it red would read as "you can't do this", when the answer
// is very often "yes, go ahead" (a second entry for the same person is
// legitimate, see docs/LMS-RULES.md). A form that never returns one simply
// never renders one.
export type ActionState =
  | { error: string }
  | { ok: string }
  | { notice: string }
  | null;

/** Result of a small imperative action (checkbox, delete) — no form state. */
export type ActionResult = { ok: true } | { error: string };
