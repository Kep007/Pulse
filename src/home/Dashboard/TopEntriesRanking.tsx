import { formatHoursMinutes } from "../../lib/format";
import type { BreakdownEntry } from "../../lib/types";
import { intensityColor } from "./intensityColor";

const MAX_ROWS = 8;

type TopEntriesRankingProps = {
  // All-time totals, any order — this component sorts and caps them.
  entries: BreakdownEntry[];
  emptyLabel: string;
};

// Magnitude comparison, not identity — per the dataviz skill's job table,
// color here is sequential (one hue, more-is-darker), not categorical.
// Length already shows the ranking; the name label carries identity.
export function TopEntriesRanking({ entries, emptyLabel }: TopEntriesRankingProps) {
  const sorted = [...entries].sort((a, b) => b.seconds - a.seconds).slice(0, MAX_ROWS);
  const max = sorted[0]?.seconds ?? 0;

  if (sorted.length === 0) {
    return <p className="dashboard-empty">{emptyLabel}</p>;
  }

  return (
    <ol className="ranking-list">
      {sorted.map((entry) => {
        const ratio = max > 0 ? entry.seconds / max : 0;
        return (
          <li className="ranking-row" key={entry.id}>
            <span className="ranking-name">{entry.name}</span>
            <div className="ranking-track">
              <div
                className="ranking-bar"
                style={{ width: `${Math.max(4, ratio * 100)}%`, background: intensityColor(ratio) }}
              />
            </div>
            <span className="ranking-value">{formatHoursMinutes(entry.seconds)}</span>
          </li>
        );
      })}
    </ol>
  );
}
