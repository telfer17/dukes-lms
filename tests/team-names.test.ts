// What survives the removal of the auto-results cron: the canonical club list
// and the openfootball tag-strip that the fixture seeding depends on. The
// API-Football alias table and resolveTeamName/resolveTeamNames went with the
// feed that used them (recoverable from git history — search: results-feed).

import { describe, expect, it } from "vitest";
import { CANONICAL_TEAMS, stripClubTag } from "@/lib/team-names";

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
