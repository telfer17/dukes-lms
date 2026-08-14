// Contrast is a requirement of the colour data, so it is tested like one.
//
// The picks grid paints a cell in a club's primary and writes the club's name
// on it in the secondary. If a pair is low-contrast the cell is unreadable — on
// a phone, in daylight, by someone checking whether they are still in. WCAG AA
// for normal text is 4.5:1 and every pair must clear it, including the neutral
// fallback.

import { describe, expect, it } from "vitest";
import {
  NEUTRAL_TEAM_COLORS,
  TEAM_COLORS,
  teamColors,
  type TeamColors,
} from "@/lib/team-colors";
import { CANONICAL_TEAMS } from "@/lib/team-names";

const HEX = /^#[0-9A-F]{6}$/;

/** WCAG 2.x relative luminance of an #RRGGBB colour. */
function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return (
    0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  );
}

/** WCAG contrast ratio, 1:1 (identical) to 21:1 (black on white). */
function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x
  );
  return (lighter + 0.05) / (darker + 0.05);
}

describe("the contrast maths itself", () => {
  // A ratio function that always returned a big number would make every
  // assertion below pass, so pin it against the two ends of the scale.
  it("agrees with the known extremes", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.48, 1);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#DB0007", "#FFFFFF")).toBeCloseTo(
      contrastRatio("#FFFFFF", "#DB0007"),
      10
    );
  });
});

describe("team colours", () => {
  it("covers exactly the canonical 20", () => {
    expect(Object.keys(TEAM_COLORS).sort()).toEqual([...CANONICAL_TEAMS].sort());
  });

  const pairs: [string, TeamColors][] = [
    ...Object.entries(TEAM_COLORS),
    ["(neutral fallback)", NEUTRAL_TEAM_COLORS],
  ];

  it.each(pairs)("%s uses well-formed hex", (_team, colors) => {
    expect(colors.primary).toMatch(HEX);
    expect(colors.secondary).toMatch(HEX);
  });

  it.each(pairs)("%s clears WCAG AA (4.5:1)", (_team, colors) => {
    expect(contrastRatio(colors.primary, colors.secondary)).toBeGreaterThanOrEqual(
      4.5
    );
  });
});

describe("teamColors()", () => {
  it("returns the club's pair", () => {
    expect(teamColors("Arsenal")).toEqual(TEAM_COLORS.Arsenal);
  });

  it("tolerates surrounding whitespace", () => {
    expect(teamColors("  Chelsea  ")).toEqual(TEAM_COLORS.Chelsea);
  });

  it("falls back to neutral rather than returning nothing", () => {
    for (const unknown of ["Leicester City", "", "   ", null, undefined]) {
      expect(teamColors(unknown)).toEqual(NEUTRAL_TEAM_COLORS);
    }
  });

  it("never returns a partial pair", () => {
    for (const name of [...CANONICAL_TEAMS, "Not A Club"]) {
      const c = teamColors(name);
      expect(c.primary).toMatch(HEX);
      expect(c.secondary).toMatch(HEX);
    }
  });
});
