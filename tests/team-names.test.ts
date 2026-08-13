import { describe, expect, it } from "vitest";
import {
  API_FOOTBALL_ALIASES,
  CANONICAL_TEAMS,
  resolveTeamName,
  resolveTeamNames,
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
});

describe("resolveTeamName", () => {
  it("resolves every openfootball source name we will actually see", () => {
    const source = [
      "Arsenal FC", "Aston Villa FC", "AFC Bournemouth", "Brentford FC",
      "Brighton & Hove Albion FC", "Chelsea FC", "Coventry City FC",
      "Crystal Palace FC", "Everton FC", "Fulham FC", "Hull City AFC",
      "Ipswich Town FC", "Leeds United FC", "Liverpool FC",
      "Manchester City FC", "Manchester United FC", "Newcastle United FC",
      "Nottingham Forest FC", "Sunderland AFC", "Tottenham Hotspur FC",
    ];
    const resolved = source.map(resolveTeamName);
    expect(resolved.filter((r) => r === null)).toEqual([]);
    expect([...new Set(resolved)].sort()).toEqual([...CANONICAL_TEAMS].sort());
  });

  it("resolves API-Football short forms", () => {
    expect(resolveTeamName("Newcastle")).toBe("Newcastle United");
    expect(resolveTeamName("Tottenham")).toBe("Tottenham Hotspur");
    expect(resolveTeamName("Brighton")).toBe("Brighton & Hove Albion");
    expect(resolveTeamName("Man Utd")).toBe("Manchester United");
    expect(resolveTeamName("Leeds")).toBe("Leeds United");
  });

  it("passes a canonical name straight through", () => {
    for (const team of CANONICAL_TEAMS) {
      expect(resolveTeamName(team)).toBe(team);
    }
  });

  it("tolerates surrounding whitespace", () => {
    expect(resolveTeamName("  Arsenal FC  ")).toBe("Arsenal");
  });

  it("returns null for a club we do not have — never a near-miss", () => {
    // These are real Premier League clubs in other seasons. Mapping them onto
    // one of ours would post a result against the wrong team, so they must
    // come back unmapped and stop the run.
    for (const outsider of [
      "Wolverhampton Wanderers", "Wolves", "Leicester City", "Leicester",
      "Southampton", "West Ham United", "Burnley", "Sheffield United",
    ]) {
      expect(resolveTeamName(outsider)).toBeNull();
    }
  });

  it("does not resolve inherited object keys as aliases", () => {
    // A plain object literal would answer for "constructor" and friends.
    for (const key of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
      expect(resolveTeamName(key)).toBeNull();
      expect(API_FOOTBALL_ALIASES[key]).toBeUndefined();
    }
  });

  it("returns null for junk", () => {
    expect(resolveTeamName("")).toBeNull();
    expect(resolveTeamName("Not A Club")).toBeNull();
    expect(resolveTeamName("FC")).toBeNull();
  });

  it("never aliases a name onto a club outside the canonical 20", () => {
    for (const [alias, target] of Object.entries(API_FOOTBALL_ALIASES)) {
      expect(CANONICAL_TEAMS).toContain(target);
      expect(alias).not.toBe(target); // an alias that equals its target is dead weight
    }
  });
});

describe("resolveTeamNames", () => {
  it("separates what mapped from what did not", () => {
    const { resolved, unmapped } = resolveTeamNames([
      "Arsenal FC", "Wolves", "Newcastle", "Leicester City",
    ]);
    expect(resolved.get("Arsenal FC")).toBe("Arsenal");
    expect(resolved.get("Newcastle")).toBe("Newcastle United");
    expect(unmapped).toEqual(["Leicester City", "Wolves"]);
  });

  it("reports each unknown name once, sorted", () => {
    const { unmapped } = resolveTeamNames(["Zzz", "Aaa", "Zzz"]);
    expect(unmapped).toEqual(["Aaa", "Zzz"]);
  });

  it("returns no unmapped names for a clean batch", () => {
    const { unmapped } = resolveTeamNames([...CANONICAL_TEAMS]);
    expect(unmapped).toEqual([]);
  });
});
