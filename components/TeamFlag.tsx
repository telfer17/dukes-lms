import { flagCode } from "@/lib/flags";

/**
 * Decorative flag beside a team name (the name itself is always shown as
 * text, hence aria-hidden). Renders nothing for unknown teams — never a
 * broken icon.
 */
export default function TeamFlag({ team }: { team: string }) {
  const code = flagCode(team);
  if (!code) return null;
  return <span className={`fi fi-${code} mx-1`} aria-hidden="true" />;
}

// U+2060 WORD JOINER: suppresses the line-break opportunity between the
// name and its flag (so the flag never wraps onto a line by itself)
// without making the pair unbreakable the way whitespace-nowrap would —
// long names can still wrap, or break mid-word as a last resort.
const WJ = "⁠";

/**
 * Team name with its flag glued to the adjacent edge. flagSide matches
 * the existing placement: "right" for home teams, "left" for away teams.
 */
export function TeamLabel({
  team,
  flagSide,
}: {
  team: string;
  flagSide: "left" | "right";
}) {
  if (flagSide === "right") {
    return (
      <>
        {team + WJ}
        <TeamFlag team={team} />
      </>
    );
  }
  return (
    <>
      <TeamFlag team={team} />
      {WJ + team}
    </>
  );
}
