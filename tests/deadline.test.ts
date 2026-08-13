import { describe, expect, it } from "vitest";
import { DEADLINE } from "@/lib/constants";
import { isAfterDeadline } from "@/lib/deadline";

describe("isAfterDeadline", () => {
  it("is false just before the deadline", () => {
    expect(isAfterDeadline(new Date(DEADLINE.getTime() - 1))).toBe(false);
  });

  it("is true exactly at the deadline", () => {
    expect(isAfterDeadline(new Date(DEADLINE.getTime()))).toBe(true);
  });

  it("is true just after the deadline", () => {
    expect(isAfterDeadline(new Date(DEADLINE.getTime() + 1))).toBe(true);
  });
});
