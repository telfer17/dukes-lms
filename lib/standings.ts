// Shared standings logic: competition ranking (used for leaderboard medals)
// and the final podium + prize split. Pure — no imports, unit-tested.

export type StandingRow = {
  name: string;
  points: number;
  exact_scores: number;
};

export type PodiumEntry = StandingRow & { place: number; prize: number };

// Gold / silver / bronze row tint for places 1–3. Black text stays readable on
// all three; shared by the leaderboard medals and the winners podium.
export const MEDAL_TINTS: Record<number, string> = {
  1: "bg-[#ffd100]", // gold
  2: "bg-[#d6d6d6]", // silver
  3: "bg-[#cb8c47]", // bronze
};

// Prize money per place slot (pot £265, agreed 60/30/10-ish split rounded).
const SLOT_PRIZE: Record<number, number> = { 1: 160, 2: 80, 3: 25 };

function slotPrize(slot: number): number {
  return SLOT_PRIZE[slot] ?? 0;
}

/**
 * Standard competition ranking ("1-2-2-4") over rows already sorted by points
 * desc then exact_scores desc. People with the SAME points AND the same
 * exact_scores share a place; the next place skips by the tie size.
 */
export function computePlaces(rows: StandingRow[]): number[] {
  const places: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    places[i] =
      i > 0 &&
      rows[i].points === rows[i - 1].points &&
      rows[i].exact_scores === rows[i - 1].exact_scores
        ? places[i - 1]
        : i + 1;
  }
  return places;
}

/**
 * The placed people (places 1–3, with a score), each with their prize.
 * Tied people share a place and split the COMBINED money of the place slots
 * they span, equally; the next place starts after the tied block. Examples:
 *   2 tie 1st → £120 each, next person is 3rd (£25)
 *   3 tie 1st → £88.33 each, no one else places
 *   2 tie 2nd → £52.50 each, 1st still £160
 *   2 tie 3rd → £12.50 each
 */
export function computePodium(rows: StandingRow[]): PodiumEntry[] {
  const places = computePlaces(rows);
  const out: PodiumEntry[] = [];
  let i = 0;
  while (i < rows.length) {
    const place = places[i];
    if (place > 3) break; // places only increase — nothing else can be top 3
    let j = i;
    while (j < rows.length && places[j] === place) j++;
    const count = j - i;
    // Only award places to people who have actually scored.
    if (rows[i].points > 0) {
      let combined = 0;
      for (let slot = place; slot < place + count; slot++) {
        combined += slotPrize(slot);
      }
      const each = combined / count;
      for (let k = i; k < j; k++) {
        out.push({ ...rows[k], place, prize: each });
      }
    }
    i = j;
  }
  return out;
}

/** Whole pounds show no decimals; fractional shows 2dp (e.g. £120, £52.50). */
export function formatPrize(amount: number): string {
  return Number.isInteger(amount) ? `£${amount}` : `£${amount.toFixed(2)}`;
}
