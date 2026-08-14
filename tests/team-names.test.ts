// What survives the removal of the auto-results cron: the canonical club list
// and the openfootball tag-strip that the fixture seeding depends on. The
// API-Football alias table and resolveTeamName/resolveTeamNames went with the
// feed that used them (recoverable from git history — search: results-feed).

import { describe, expect, it } from "vitest";
import {
  CANONICAL_TEAMS,
  TEAM_DISPLAY_NAMES,
  displayTeamName,
  stripClubTag,
} from "@/lib/team-names";

describe("stripClubTag", () => {
  it("strips a trailing FC", () => {
    expect(stripClubTag("Arsenal FC")).toBe("Arsenal");
    expect(stripClubTag("Brighton & Hove Albion FC")).toBe("Brighton & Hove Albion");
  });

  it("strips a trailing AFC", () => {
    expect(stripClubTag("Hull City AFC")).toBe("Hull City");
    expect(stripClubTag("Sunderland AFC")).toBe("Sunderland");
  });

  it("strips a leading AFC", () => {
    expect(stripClubTag("AFC Bournemouth")).toBe("Bournemouth");
  });

  it("leaves an already-clean name alone", () => {
    expect(stripClubTag("Aston Villa")).toBe("Aston Villa");
  });

  it("does not eat a name that merely contains those letters", () => {
    expect(stripClubTag("Fulham")).toBe("Fulham");
    expect(stripClubTag("AFCA Amsterdam")).toBe("AFCA Amsterdam");
  });

  it("tolerates surrounding whitespace", () => {
    expect(stripClubTag("  Arsenal FC  ")).toBe("Arsenal");
  });
});

describe("the openfootball source names", () => {
  // The fixture generator applies exactly this transformation to the names in
  // the source file. If stripping every one of them does not land precisely on
  // the canonical 20, seeding would either miss a club or invent one.
  it("strip to exactly the canonical 20", () => {
    const source = [
      "Arsenal FC", "Aston Villa FC", "AFC Bournemouth", "Brentford FC",
      "Brighton & Hove Albion FC", "Chelsea FC", "Coventry City FC",
      "Crystal Palace FC", "Everton FC", "Fulham FC", "Hull City AFC",
      "Ipswich Town FC", "Leeds United FC", "Liverpool FC",
      "Manchester City FC", "Manchester United FC", "Newcastle United FC",
      "Nottingham Forest FC", "Sunderland AFC", "Tottenham Hotspur FC",
    ];
    expect(source.map(stripClubTag).sort()).toEqual([...CANONICAL_TEAMS].sort());
  });

  it("does not turn a club from another season into one of ours", () => {
    // Real Premier League clubs in other seasons. Stripping must leave them
    // recognisably outside the canonical list, never near-missed onto a club we
    // do have — that would attach fixtures to the wrong team.
    for (const outsider of [
      "Wolverhampton Wanderers FC", "Leicester City FC", "Southampton FC",
      "West Ham United FC", "Burnley FC", "Sheffield United FC",
    ]) {
      expect(CANONICAL_TEAMS).not.toContain(stripClubTag(outsider));
    }
  });
});

describe("display names", () => {
  it("covers exactly the canonical 20", () => {
    // A club renamed in one table and not the other must fail here rather than
    // render as a blank grid cell.
    expect(Object.keys(TEAM_DISPLAY_NAMES).sort()).toEqual(
      [...CANONICAL_TEAMS].sort()
    );
  });

  it("resolves every canonical name to something non-empty", () => {
    for (const team of CANONICAL_TEAMS) {
      const shown = displayTeamName(team);
      expect(shown).toBeTruthy();
      expect(shown.length).toBeLessThanOrEqual(team.length);
    }
  });

  it("shortens the ones that do not fit", () => {
    expect(displayTeamName("Manchester United")).toBe("Man Utd");
    expect(displayTeamName("Manchester City")).toBe("Man City");
    expect(displayTeamName("Brighton & Hove Albion")).toBe("Brighton");
    expect(displayTeamName("Nottingham Forest")).toBe("Nott'm Forest");
    expect(displayTeamName("Tottenham Hotspur")).toBe("Spurs");
  });

  it("leaves the already-short ones alone", () => {
    for (const team of ["Arsenal", "Chelsea", "Everton", "Fulham", "Liverpool"]) {
      expect(displayTeamName(team)).toBe(team);
    }
  });

  it("never confuses the two Manchester clubs", () => {
    expect(displayTeamName("Manchester City")).not.toBe(
      displayTeamName("Manchester United")
    );
  });

  it("returns distinct labels for every club", () => {
    const shown = CANONICAL_TEAMS.map(displayTeamName);
    expect(new Set(shown).size).toBe(CANONICAL_TEAMS.length);
  });

  it("passes an unknown name straight through rather than blanking it", () => {
    expect(displayTeamName("Leicester City")).toBe("Leicester City");
    expect(displayTeamName("  Chelsea  ")).toBe("Chelsea");
    expect(displayTeamName("")).toBe("");
    expect(displayTeamName(null)).toBe("");
    expect(displayTeamName(undefined)).toBe("");
  });
});
