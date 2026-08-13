import { describe, expect, it } from "vitest";
import { flagCode } from "@/lib/flags";

// Independent copy of the 48 team names as stored in the matches table —
// if the map and these ever drift, this fails loudly.
const ALL_TEAMS = [
  "Mexico", "South Africa", "South Korea", "Czech Republic",
  "Canada", "Bosnia & Herzegovina", "Qatar", "Switzerland",
  "Brazil", "Morocco", "Scotland", "Haiti",
  "USA", "Paraguay", "Australia", "Turkey",
  "Germany", "Curaçao", "Ivory Coast", "Ecuador",
  "Netherlands", "Japan", "Sweden", "Tunisia",
  "Belgium", "Egypt", "Iran", "New Zealand",
  "Spain", "Cape Verde", "Saudi Arabia", "Uruguay",
  "France", "Senegal", "Iraq", "Norway",
  "Argentina", "Algeria", "Austria", "Jordan",
  "Portugal", "DR Congo", "Colombia", "Uzbekistan",
  "England", "Croatia", "Panama", "Ghana",
];

describe("flagCode", () => {
  it("covers all 48 teams", () => {
    expect(ALL_TEAMS).toHaveLength(48);
    for (const team of ALL_TEAMS) {
      expect(flagCode(team), `missing flag for ${team}`).not.toBeNull();
    }
  });

  it("maps the home nations to subdivision codes", () => {
    expect(flagCode("Scotland")).toBe("gb-sct");
    expect(flagCode("England")).toBe("gb-eng");
  });

  it("returns null for unknown teams", () => {
    expect(flagCode("Narnia")).toBeNull();
  });
});
