"use client";

import WinnersPodium from "@/components/WinnersPodium";

// The competition is over — the home screen is permanently the winners podium.
// The earlier date-driven states (countdown / "tournament underway" / final
// phase) and the ?preview=winners + NEXT_PUBLIC_SHOW_FINAL_RESULTS gates are
// superseded; the plain homepage shows the podium with no flag or query param.
// WinnersPodium still derives everything from live leaderboard data.
export default function HomeHero() {
  return <WinnersPodium />;
}
