import Image from "next/image";
import Link from "next/link";
import PicksGrid from "@/components/PicksGrid";
import { buildGridRows, type GridRow } from "@/lib/grid-projection";
import {
  getEntries,
  getPicksForCompetition,
  getRounds,
  getTeams,
} from "@/lib/lms-db";
import { readPublicCompetition } from "@/lib/public-read";

// Live data, never cached.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Everyone's picks · Dukes — Last Man Standing",
  description:
    "Every entry's pick, week by week, for the Dukes Last Man Standing competition.",
};

/**
 * WHAT LEAVES THE SERVER.
 *
 * This page needs picks, which are secret-key-only (db/lms-schema.sql revokes
 * them from anon), so it reads with the server client and PROJECTS. The rows
 * handed to the client component carry a name, a status, an elimination round,
 * and per-round { team, outcome, auto } — and nothing else.
 *
 * Deliberately absent: entries.id (the handle every write path takes),
 * participant ids, phone numbers, payment amounts, team ids, round ids. They
 * are never put on the props, so they cannot appear in the RSC payload — the
 * lesson from the board's entry-id leak, where a value used only as a React key
 * still reached the browser. tests/grid-projection.test.ts pins the shape.
 *
 * Picks themselves are public the moment they are made: there is no
 * secrecy rule in docs/LMS-RULES.md, and this grid is the competition's
 * scoreboard. What stays private is who owes what and how to reach them.
 */

export default async function GridPage() {
  const { data: competition, error } = await readPublicCompetition();

  if (error) {
    console.error("grid: competition read failed:", error);
    return (
      <Shell>
        <p className="mt-3 text-gray-600">
          The picks grid can&apos;t be loaded right now. Try again in a minute.
        </p>
      </Shell>
    );
  }

  if (!competition) {
    return (
      <Shell>
        <p className="mt-3 text-gray-600">
          No competition running yet. Check back soon.
        </p>
      </Shell>
    );
  }

  let rows: GridRow[] = [];
  let roundLabels: string[] = [];

  try {
    const [rounds, entries, picks, teams] = await Promise.all([
      getRounds(competition.id),
      getEntries(competition.id),
      getPicksForCompetition(competition.id),
      getTeams(),
    ]);

    const projected = buildGridRows({
      rounds,
      entries,
      picks,
      teamNameById: new Map(teams.map((t) => [t.id, t.name])),
    });
    rows = projected.rows;
    roundLabels = projected.roundLabels;
  } catch (e) {
    console.error("grid: read failed:", e);
    return (
      <Shell label={competition.label}>
        <p className="mt-3 text-gray-600">
          The picks grid can&apos;t be loaded right now. Try again in a minute.
        </p>
      </Shell>
    );
  }

  return (
    <Shell label={competition.label}>
      {roundLabels.length === 0 || rows.length === 0 ? (
        <p className="mt-6 rounded-md border border-gray-200 p-6 text-center text-gray-500">
          {rows.length === 0
            ? "No entries yet."
            : "No picks yet — the first round hasn't started."}
        </p>
      ) : (
        <div className="mt-6">
          <PicksGrid rows={rows} roundLabels={roundLabels} />
        </div>
      )}

      <p className="mt-8 text-center text-sm text-gray-500">
        <Link href="/board" className="text-blue-600 hover:underline">
          ← The board
        </Link>
      </p>
    </Shell>
  );
}

function Shell({
  label,
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <div className="text-center">
        <Image
          src="/wellington.jpg"
          alt="Glasgow Wellington logo"
          width={64}
          height={64}
          priority
          className="mx-auto rounded-full"
        />
        <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
          Everyone&apos;s picks
        </h1>
        {label && <p className="mt-1 text-sm text-gray-500">{label}</p>}
      </div>
      {children}
    </main>
  );
}
