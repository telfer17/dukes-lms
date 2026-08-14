// Club colours for the picks grid and the pick buttons. Pure data — no imports,
// no I/O.
//
//   primary   — the shirt colour, used as a cell/button BACKGROUND
//   secondary — a colour that is readable ON that primary, used for the text
//
// CONTRAST IS PART OF THE DATA, not a styling nicety. Every pair clears WCAG AA
// for normal text (4.5:1), checked for all 20 clubs plus the neutral fallback in
// tests/team-colors.test.ts. Where a club's official shade could not carry white
// text at that ratio the pairing was flipped or deepened rather than shipped
// unreadable — the notes below say which, so nobody "corrects" one back.
//
// Keyed by the canonical club names in lib/team-names.ts. Anything not in the
// list resolves to the neutral pair via teamColors(), so a renamed or unknown
// club renders greyed and legible instead of unstyled.

export type TeamColors = {
  /** Background: the club's shirt colour. */
  primary: string;
  /** Foreground: readable on `primary` at >= 4.5:1. */
  secondary: string;
};

/** Used for any name not in the table — never leaves a cell unstyled. */
export const NEUTRAL_TEAM_COLORS: TeamColors = {
  primary: "#E5E7EB",
  secondary: "#111827",
};

export const TEAM_COLORS: Record<string, TeamColors> = {
  Arsenal: { primary: "#DB0007", secondary: "#FFFFFF" },
  // Claret and sky blue, the club's own pairing, rather than claret/white.
  "Aston Villa": { primary: "#670E36", secondary: "#95BFE5" },
  Bournemouth: { primary: "#B50E13", secondary: "#FFFFFF" },
  Brentford: { primary: "#D20000", secondary: "#FFFFFF" },
  "Brighton & Hove Albion": { primary: "#0057B8", secondary: "#FFFFFF" },
  Chelsea: { primary: "#034694", secondary: "#FFFFFF" },
  // Sky blue is far too light to carry white text — navy on sky instead.
  "Coventry City": { primary: "#78BDEA", secondary: "#10284B" },
  "Crystal Palace": { primary: "#1B458F", secondary: "#FFFFFF" },
  Everton: { primary: "#003399", secondary: "#FFFFFF" },
  // A white shirt: white background, black text, rather than inventing a colour.
  Fulham: { primary: "#FFFFFF", secondary: "#000000" },
  // Amber with near-black, the tiger stripe. White on amber is unreadable.
  "Hull City": { primary: "#F1A32B", secondary: "#1A1A1A" },
  "Ipswich Town": { primary: "#1B449C", secondary: "#FFFFFF" },
  // White shirts: the blue is the text, not the ground.
  "Leeds United": { primary: "#FFFFFF", secondary: "#1D428A" },
  Liverpool: { primary: "#C8102E", secondary: "#FFFFFF" },
  // Sky blue with navy text — City's own away-kit pairing, and the only
  // readable one; white on sky blue is about 1.8:1.
  "Manchester City": { primary: "#6CABDD", secondary: "#00285E" },
  "Manchester United": { primary: "#C70101", secondary: "#FFFFFF" },
  "Newcastle United": { primary: "#241F20", secondary: "#FFFFFF" },
  "Nottingham Forest": { primary: "#C60C30", secondary: "#FFFFFF" },
  // Deepened a touch from the brightest red so white text clears 4.5:1.
  Sunderland: { primary: "#E4022D", secondary: "#FFFFFF" },
  // White shirts, navy text — the same call as Leeds.
  "Tottenham Hotspur": { primary: "#FFFFFF", secondary: "#132257" },
};

/** Colours for a club, or the neutral pair for anything unrecognised. */
export function teamColors(name: string | null | undefined): TeamColors {
  if (!name) return NEUTRAL_TEAM_COLORS;
  return TEAM_COLORS[name.trim()] ?? NEUTRAL_TEAM_COLORS;
}
