"use client";

import { useSyncExternalStore } from "react";
import { DEADLINE, FINAL_PHASE_START } from "@/lib/constants";

// One shared 1-second clock so the countdown display, the deadline flip, the
// hero and the navbar all tick together off the single DEADLINE source of
// truth — and switch live at kick-off without a redeploy.
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

/**
 * Whether the entry deadline (first kick-off) has passed. The snapshot is a
 * boolean, so consumers only re-render when it actually flips — not every tick.
 * Server snapshot is false so SSR/static HTML renders the pre-deadline view and
 * the client corrects itself after hydration.
 */
export function useAfterDeadline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => nowSnapshot >= DEADLINE.getTime(),
    () => false
  );
}

/**
 * Whether the closing stretch has started (home leads with live standings,
 * Exact column un-hidden). Same shared clock, so it flips live. False during SSR.
 */
export function useAfterFinalPhase(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => nowSnapshot >= FINAL_PHASE_START.getTime(),
    () => false
  );
}

/**
 * `?preview=final` forces the closing-stretch view on any device, regardless of
 * date. Read client-side (the URL doesn't change mid-session); false on the
 * server so SSR/hydration stay consistent.
 */
export function usePreviewFinal(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => new URLSearchParams(window.location.search).get("preview") === "final",
    () => false
  );
}

/** `?preview=winners` previews the final winners podium without deploying. */
export function usePreviewWinners(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () =>
      new URLSearchParams(window.location.search).get("preview") === "winners",
    () => false
  );
}
