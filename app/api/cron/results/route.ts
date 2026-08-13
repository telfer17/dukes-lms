import { constantTimeEqual } from "@/lib/admin-auth";
import {
  DEFAULT_GRACE_MS,
  FEED_STATUS_FILTER,
  matchFeedToFixtures,
  parseFeedPayload,
  type DueFixture,
  type FeedMatch,
} from "@/lib/results-feed";
import { getActiveCompetition } from "@/lib/lms-db";
import { resolveTeamName, type CanonicalTeam } from "@/lib/team-names";
import { supabaseServer } from "@/lib/supabase-server";

// Auto-fill Premier League results for fixtures that have already kicked off.
//
// FILLS RESULTS ONLY. Settlement stays manual: an organiser reviews the
// results in /admin/results and presses Settle. This route never touches
// entries, picks or rounds, and never calls the settlement engine.
//
// Runs daily from vercel.json, and can be triggered by hand with the same
// secret after a matchday.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const API_HOST = "https://v3.football.api-sports.io";
const LEAGUE_ID = 39; // Premier League
const SEASON = 2026; // 2026/27

type Report = {
  ok: boolean;
  checked: number;
  updated: { fixtureId: number; score: string; result: string }[];
  skipped: {
    alreadyResulted: number;
    changedUnderneath: number;
    roundSettled: { fixtureId: number; round: number }[];
    notReportedYet: number;
    abandoned: { fixtureId: number; statusShort: string }[];
  };
  unmapped: string[];
  errors: string[];
};

function unauthorized() {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * Header only, compared in constant time.
 *
 * Deliberately NOT accepted as a query parameter: URLs end up in access logs,
 * proxy logs, browser history and Referer headers, so a ?secret= is a secret
 * you have published. Vercel Cron sends `Authorization: Bearer $CRON_SECRET`,
 * and x-cron-secret is there for hand-invocation.
 */
function isAuthorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const supplied = bearer || request.headers.get("x-cron-secret") || "";

  return supplied.length > 0 && constantTimeEqual(supplied, secret);
}

export async function GET(request: Request) {
  if (!isAuthorised(request)) return unauthorized();

  const report: Report = {
    ok: true,
    checked: 0,
    updated: [],
    skipped: {
      alreadyResulted: 0,
      changedUnderneath: 0,
      roundSettled: [],
      notReportedYet: 0,
      abandoned: [],
    },
    unmapped: [],
    errors: [],
  };

  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) {
    report.ok = false;
    report.errors.push("API_FOOTBALL_KEY is not set.");
    return Response.json(report, { status: 500 });
  }

  // ---- 1. our fixtures that should have finished ----
  const now = Date.now();
  let candidates: {
    id: number;
    matchday: number;
    kickoff: string;
    status: string;
    result: string | null;
    home_team_id: number;
    away_team_id: number;
  }[];
  let teamNameById: Map<number, string>;

  try {
    const [fixturesRes, teamsRes] = await Promise.all([
      supabaseServer
        .from("fixtures")
        .select("id, matchday, kickoff, status, result, home_team_id, away_team_id")
        .eq("status", "scheduled")
        .lte("kickoff", new Date(now - DEFAULT_GRACE_MS).toISOString())
        .order("kickoff"),
      supabaseServer.from("teams").select("id, name"),
    ]);
    if (fixturesRes.error) throw new Error(fixturesRes.error.message);
    if (teamsRes.error) throw new Error(teamsRes.error.message);
    candidates = fixturesRes.data ?? [];
    teamNameById = new Map(
      (teamsRes.data ?? []).map((t: { id: number; name: string }) => [t.id, t.name])
    );
  } catch (e) {
    report.ok = false;
    report.errors.push(
      `Could not read fixtures: ${e instanceof Error ? e.message : "unknown error"}`
    );
    return Response.json(report, { status: 500 });
  }

  // Never overwrite something already entered — manual entry always wins.
  const pristine = candidates.filter((f) => f.result === null);
  report.skipped.alreadyResulted = candidates.length - pristine.length;
  report.checked = pristine.length;

  if (pristine.length === 0) {
    return Response.json(report, { status: report.ok ? 200 : 207 });
  }

  // ---- 2. respect the settled-round guard ----
  //
  // A settled round's results were already applied to players, so we do not
  // add to one for the competition currently running.
  //
  // Scoped to the ACTIVE competition on purpose. rounds_unique_matchday is
  // unique (competition_id, matchday), so the same matchday legitimately
  // recurs across competitions — an unscoped lookup would let a long-finished
  // competition's settled rounds block result-filling on those matchdays for
  // the rest of the season.
  //
  // And deliberately NOT bailing out when no competition is active: fixtures
  // are season-wide reference data by design (docs/LMS-SCHEMA.md), and filling
  // results in the gap after a rollover, or before the first competition
  // starts, is exactly what lets the next one settle cleanly. With nothing
  // active the guard is simply empty and every due fixture is writable.
  const matchdays = [...new Set(pristine.map((f) => f.matchday))];
  const settledMatchdays = new Map<number, number>();
  try {
    const active = await getActiveCompetition();
    if (active) {
      const { data, error } = await supabaseServer
        .from("rounds")
        .select("matchday, round_number")
        .eq("competition_id", active.id)
        .in("matchday", matchdays)
        .eq("status", "settled");
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as { matchday: number; round_number: number }[]) {
        settledMatchdays.set(row.matchday, row.round_number);
      }
    }
  } catch (e) {
    report.ok = false;
    report.errors.push(
      `Could not read rounds: ${e instanceof Error ? e.message : "unknown error"}`
    );
    return Response.json(report, { status: 500 });
  }

  const writable: DueFixture[] = [];
  for (const f of pristine) {
    const settledRound = settledMatchdays.get(f.matchday);
    if (settledRound !== undefined) {
      report.skipped.roundSettled.push({ fixtureId: f.id, round: settledRound });
      continue;
    }
    const home = resolveTeamName(teamNameById.get(f.home_team_id) ?? "");
    const away = resolveTeamName(teamNameById.get(f.away_team_id) ?? "");
    if (!home || !away) {
      // Our own teams table disagreeing with the canonical list is a config
      // problem, not a feed problem — surface it rather than skipping quietly.
      report.ok = false;
      report.errors.push(
        `Fixture ${f.id} references a club not in the canonical list — check teams.name.`
      );
      continue;
    }
    writable.push({
      id: f.id,
      matchday: f.matchday,
      kickoff: f.kickoff,
      home: home as CanonicalTeam,
      away: away as CanonicalTeam,
    });
  }

  if (writable.length === 0) {
    // May carry a config error from the loop above — a monitor watching the
    // status code must not read that as a clean run.
    return Response.json(report, { status: report.ok ? 200 : 207 });
  }

  // ---- 3. one feed call for the whole season ----
  let feed: FeedMatch[];
  try {
    const response = await fetch(
      `${API_HOST}/fixtures?league=${LEAGUE_ID}&season=${SEASON}&status=${FEED_STATUS_FILTER}`,
      {
        headers: { "x-apisports-key": apiKey },
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      }
    );

    if (!response.ok) {
      report.ok = false;
      // Status only — never echo the body, which can carry the key back.
      report.errors.push(`Results feed returned HTTP ${response.status}.`);
      return Response.json(report, { status: 502 });
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      report.ok = false;
      report.errors.push("Results feed returned a body that is not JSON.");
      return Response.json(report, { status: 502 });
    }

    // API-Football answers 200 with an `errors` payload for a bad key or a
    // quota breach, so an HTTP 200 is not on its own a success.
    const apiErrors = (body as { errors?: unknown })?.errors;
    const hasApiError = Array.isArray(apiErrors)
      ? apiErrors.length > 0
      : apiErrors && typeof apiErrors === "object"
        ? Object.keys(apiErrors).length > 0
        : false;
    if (hasApiError) {
      report.ok = false;
      report.errors.push(
        "Results feed rejected the request (check API_FOOTBALL_KEY and quota)."
      );
      return Response.json(report, { status: 502 });
    }

    // Strict shape check before anything is matched or written. An empty
    // response array is a legitimate no-op, not a failure.
    const parsed = parseFeedPayload(body);
    if (!parsed.ok) {
      report.ok = false;
      report.errors.push(parsed.error);
      return Response.json(report, { status: 502 });
    }
    feed = parsed.feed;
  } catch (e) {
    report.ok = false;
    report.errors.push(
      e instanceof Error && e.name === "TimeoutError"
        ? "Results feed timed out."
        : "Results feed is unreachable."
    );
    return Response.json(report, { status: 502 });
  }

  // ---- 4. decide, then write ----
  const outcome = matchFeedToFixtures(writable, feed);
  report.unmapped = outcome.unmapped;
  report.skipped.notReportedYet = outcome.notReported.length;
  report.skipped.abandoned = outcome.abandoned;

  for (const update of outcome.updates) {
    // No transaction or shared settlement lock here, deliberately. The write
    // re-asserts BOTH preconditions it read — still scheduled AND still
    // unresulted — so a decision made against stale state simply lands as a
    // no-op; the settled-round guard above and settlement's own refusal to
    // re-run a settled round contain what is left. A genuine shared lock
    // belongs with the settlement-RPC hardening item, whose design must take
    // this guard with it (see app/admin/results/actions.ts).
    //
    // Manual entry always wins, so the write re-asserts both halves of what we
    // read: still unresulted AND still scheduled. `result is null` alone is not
    // enough — an admin who marks a game postponed leaves result null, and
    // without the status check we would flip it back to played and hand a
    // result to a pick the rules say should have SURVIVED.
    const { error, count } = await supabaseServer
      .from("fixtures")
      .update(
        {
          home_score: update.home_score,
          away_score: update.away_score,
          status: "played",
          result: update.result,
        },
        { count: "exact" }
      )
      .eq("id", update.fixtureId)
      .eq("status", "scheduled")
      .is("result", null);

    if (error) {
      report.ok = false;
      report.errors.push(`Fixture ${update.fixtureId}: ${error.message}`);
      continue;
    }
    if (count === 0) {
      // Someone changed it underneath us — entered a result, or marked it
      // postponed. Either way theirs stands.
      report.skipped.changedUnderneath += 1;
      continue;
    }
    report.updated.push({
      fixtureId: update.fixtureId,
      score: `${update.home_score}-${update.away_score}`,
      result: update.result,
    });
  }

  if (outcome.unmapped.length > 0 && outcome.notReported.length > 0) {
    // Names we could not resolve, AND fixtures of ours the feed never
    // accounted for — very likely the same problem. Fail loudly.
    report.ok = false;
    report.errors.push(
      `Unrecognised club names in the feed: ${outcome.unmapped.join(", ")}. No guess was made — add them to API_FOOTBALL_ALIASES if they are ours.`
    );
  }

  return Response.json(report, { status: report.ok ? 200 : 207 });
}

// Same handler for POST, so the job can be triggered by hand with curl.
export const POST = GET;
