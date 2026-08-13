import { DEADLINE } from "@/lib/constants";

/** True once the public entry deadline (first kick-off) has passed. */
export function isAfterDeadline(now: Date = new Date()): boolean {
  return now.getTime() >= DEADLINE.getTime();
}
