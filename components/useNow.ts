"use client";

import { useSyncExternalStore } from "react";

// One shared 1-second clock, so every live time display in the app ticks
// together off a single interval rather than each component running its own.
let nowSnapshot = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  if (timer === null) {
    timer = setInterval(() => {
      nowSnapshot = Date.now();
      listeners.forEach((l) => l());
    }, 1_000);
  }
  return () => {
    listeners.delete(onStoreChange);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Current time in ms, or null during SSR/first paint (avoids hydration mismatch). */
export function useNow(): number | null {
  return useSyncExternalStore(
    subscribe,
    () => nowSnapshot,
    () => null
  );
}
