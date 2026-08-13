// The same assertions as db/verify-fixtures.sql, run against the COMMITTED
// JSON. Pure — no network, no database. If someone regenerates the fixture
// data badly, CI catches it here rather than after it has been seeded.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import fixtureData from "@/data/fixtures-2026-27.json";
import { CANONICAL_TEAMS } from "@/lib/team-names";

const { fixtures, counts, source } = fixtureData;

const matchdays = [...new Set(fixtures.map((f) => f.matchday))].sort(
  (a, b) => a - b
);

// What the clock in London actually read at a given UTC instant.
const londonFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function londonLabel(iso: string): string {
  const p = Object.fromEntries(
    londonFormat
      .formatToParts(new Date(iso))
      .filter((x) => x.type !== "literal")
      .map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

describe("fixture data provenance", () => {
  it("records where it came from and when", () => {
    expect(source.url).toContain("openfootball");
    expect(source.season).toBe("2026-27");
    expect(source.fetched_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("agrees with its own header counts", () => {
    expect(counts.fixtures).toBe(fixtures.length);
    expect(counts.matchdays).toBe(matchdays.length);
    expect(counts.teams).toBe(CANONICAL_TEAMS.length);
  });
});

describe("generator and app agree on the club list", () => {
  // The generator is a plain .mjs script and cannot import the TS module, so
  // it keeps its own copy of the 20 names. Assert the two lists are identical
  // rather than relying on drift happening to show up in the fixture data.
  it("scripts/build-fixtures.mjs uses exactly CANONICAL_TEAMS", () => {
    const src = readFileSync("scripts/build-fixtures.mjs", "utf8");
    const block = src.match(/const CANONICAL = \[([\s\S]*?)\];/);
    expect(block, "CANONICAL block not found — has the script been restructured?").toBeTruthy();
    const names = [...block![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(names.sort()).toEqual([...CANONICAL_TEAMS].sort());
  });
});

describe("season shape", () => {
  it("has exactly 380 fixtures", () => {
    expect(fixtures).toHaveLength(380);
  });

  it("has exactly 38 matchdays, numbered 1..38", () => {
    expect(matchdays).toHaveLength(38);
    expect(matchdays).toEqual(Array.from({ length: 38 }, (_, i) => i + 1));
  });

  it("has exactly 10 fixtures in every matchday", () => {
    const wrong = matchdays
      .map((md) => ({ md, n: fixtures.filter((f) => f.matchday === md).length }))
      .filter((x) => x.n !== 10);
    expect(wrong).toEqual([]);
  });
});

describe("club coverage", () => {
  it("only ever names our 20 canonical clubs", () => {
    const named = new Set(fixtures.flatMap((f) => [f.home, f.away]));
    expect([...named].sort()).toEqual([...CANONICAL_TEAMS].sort());
  });

  it("fields every club EXACTLY once per matchday", () => {
    // The rule the schema deliberately left to seed-time validation: its two
    // unique constraints stop a club being home twice or away twice, but not
    // home in one fixture and away in another on the same matchday.
    const offences: string[] = [];
    for (const md of matchdays) {
      const inMd = fixtures.filter((f) => f.matchday === md);
      const seen = new Map<string, number>();
      for (const f of inMd) {
        seen.set(f.home, (seen.get(f.home) ?? 0) + 1);
        seen.set(f.away, (seen.get(f.away) ?? 0) + 1);
      }
      for (const team of CANONICAL_TEAMS) {
        const n = seen.get(team) ?? 0;
        if (n !== 1) offences.push(`md ${md}: ${team} x${n}`);
      }
    }
    expect(offences).toEqual([]);
  });

  it("gives every club 19 home and 19 away fixtures", () => {
    const wrong = CANONICAL_TEAMS.map((team) => ({
      team,
      home: fixtures.filter((f) => f.home === team).length,
      away: fixtures.filter((f) => f.away === team).length,
    })).filter((x) => x.home !== 19 || x.away !== 19);
    expect(wrong).toEqual([]);
  });

  it("never draws a club against itself", () => {
    expect(fixtures.filter((f) => f.home === f.away)).toEqual([]);
  });

  it("pairs every club with every other, home and away", () => {
    const pairs = new Set(fixtures.map((f) => `${f.home}|${f.away}`));
    expect(pairs.size).toBe(380);
    for (const home of CANONICAL_TEAMS) {
      for (const away of CANONICAL_TEAMS) {
        if (home === away) continue;
        expect(pairs.has(`${home}|${away}`)).toBe(true);
      }
    }
  });
});

describe("kickoff times", () => {
  it("stores every kickoff as a UTC instant", () => {
    for (const f of fixtures) {
      expect(f.kickoff).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(Number.isNaN(Date.parse(f.kickoff))).toBe(false);
    }
  });

  it("keeps every kickoff inside the season window", () => {
    const from = Date.parse("2026-08-01T00:00:00Z");
    const to = Date.parse("2027-06-30T23:59:00Z");
    const outside = fixtures.filter(
      (f) => Date.parse(f.kickoff) < from || Date.parse(f.kickoff) > to
    );
    expect(outside).toEqual([]);
  });

  it("runs matchdays in order, without overlap", () => {
    const span = matchdays.map((md) => {
      const times = fixtures
        .filter((f) => f.matchday === md)
        .map((f) => Date.parse(f.kickoff));
      return { md, starts: Math.min(...times), ends: Math.max(...times) };
    });
    const overlaps = span
      .slice(1)
      .filter((curr, i) => curr.starts <= span[i].ends)
      .map((x) => `md ${x.md}`);
    expect(overlaps).toEqual([]);
  });

  it("opens the season at 20:00 UK on Friday 21 August 2026", () => {
    const first = fixtures.reduce((a, b) =>
      Date.parse(a.kickoff) <= Date.parse(b.kickoff) ? a : b
    );
    expect(first.kickoff).toBe("2026-08-21T19:00:00.000Z"); // 20:00 BST
    expect(first.kickoff_uk).toBe("2026-08-21 20:00");
  });

  it("renders every kickoff back to exactly its stated UK wall clock", () => {
    // The real check: take the stored UTC instant, ask Europe/London what the
    // clock said at that moment, and require it to equal kickoff_uk exactly.
    // An hour wrong anywhere — including the October and March boundaries,
    // where a fixed offset would silently disagree — fails here.
    const mismatched = fixtures
      .map((f) => ({ f, actual: londonLabel(f.kickoff) }))
      .filter(({ f, actual }) => actual !== f.kickoff_uk)
      .map(({ f, actual }) => `${f.home} v ${f.away}: ${f.kickoff} -> ${actual}, labelled ${f.kickoff_uk}`);
    expect(mismatched).toEqual([]);
  });

  it("really does span BST, GMT and BST again", () => {
    // Guards against the season data being quietly replaced by something that
    // never crosses a boundary, which would make the check above vacuous.
    const offsets = new Set(
      fixtures.map(
        (f) =>
          (Date.parse(`${f.kickoff_uk.replace(" ", "T")}:00Z`) -
            Date.parse(f.kickoff)) /
          3_600_000
      )
    );
    expect([...offsets].sort()).toEqual([0, 1]);

    const monthOffset = (prefix: string) =>
      new Set(
        fixtures
          .filter((f) => f.kickoff_uk.startsWith(prefix))
          .map(
            (f) =>
              (Date.parse(`${f.kickoff_uk.replace(" ", "T")}:00Z`) -
                Date.parse(f.kickoff)) /
              3_600_000
          )
      );
    expect([...monthOffset("2026-08")]).toEqual([1]); // BST
    expect([...monthOffset("2026-12")]).toEqual([0]); // GMT
    expect([...monthOffset("2027-05")]).toEqual([1]); // BST again
    // October straddles the change, so it must contain both.
    expect([...monthOffset("2026-10")].sort()).toEqual([0, 1]);
  });
});

describe("seed pristineness", () => {
  it("carries no results — status and scores are the database's defaults", () => {
    for (const f of fixtures) {
      expect(Object.keys(f).sort()).toEqual(
        ["away", "home", "kickoff", "kickoff_uk", "matchday"].sort()
      );
    }
  });
});
