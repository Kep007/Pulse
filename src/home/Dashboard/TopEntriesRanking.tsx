import { formatHoursMinutes } from "../../lib/format";
import type { BreakdownEntry, BreakdownMetric, MonthBucket } from "../../lib/types";
import { BreakdownTooltip } from "./BreakdownTooltip";
import { MONTH_LABELS_IT } from "./Heatmap";
import { intensityColor } from "./intensityColor";
import { TooltipTrigger } from "./TooltipTrigger";

const MAX_ROWS = 8;
// A tooltip can't list a whole history's months — the most recent ones are
// the ones being asked about ("what have I done for this client lately").
const MAX_TOOLTIP_MONTHS = 6;

type TopEntriesRankingProps = {
  // All-time totals, any order — this component sorts and caps them.
  entries: BreakdownEntry[];
  // All-time month buckets, used to build each bar's monthly-recap tooltip.
  monthlyBuckets: MonthBucket[];
  metric: BreakdownMetric;
  // The dashboard filter's entity — emphasized, and appended below the top
  // rows when it ranks too low to make the cut.
  highlightId?: number | null;
  emptyLabel: string;
};

// "2026-07" → "Luglio 2026".
function formatMonthLabel(month: string) {
  const [year, monthIndex] = month.split("-");
  const label = MONTH_LABELS_IT[Number(monthIndex) - 1];
  return label ? `${label} ${year}` : month;
}

// The most recent months this entry has time in, newest first, shaped as
// BreakdownEntry rows so BreakdownTooltip can render them unchanged.
function monthlyRecap(entryId: number, monthlyBuckets: MonthBucket[], metric: BreakdownMetric) {
  const recap: BreakdownEntry[] = [];
  for (let i = monthlyBuckets.length - 1; i >= 0 && recap.length < MAX_TOOLTIP_MONTHS; i--) {
    const bucket = monthlyBuckets[i];
    const breakdown = metric === "project" ? bucket.byProject : bucket.byActivity;
    const seconds = breakdown.find((item) => item.id === entryId)?.seconds ?? 0;
    if (seconds > 0) {
      recap.push({ id: i, name: formatMonthLabel(bucket.month), color: null, seconds });
    }
  }
  return recap;
}

// Magnitude comparison, not identity — per the dataviz skill's job table,
// color here is sequential (one hue, more-is-darker), not categorical.
// Length already shows the ranking; the name label carries identity.
export function TopEntriesRanking({
  entries,
  monthlyBuckets,
  metric,
  highlightId = null,
  emptyLabel,
}: TopEntriesRankingProps) {
  const ranked = [...entries].sort((a, b) => b.seconds - a.seconds);
  const sorted = ranked.slice(0, MAX_ROWS);
  const highlightRank = highlightId === null ? -1 : ranked.findIndex((entry) => entry.id === highlightId);
  if (highlightRank >= MAX_ROWS) {
    sorted.push(ranked[highlightRank]);
  }
  const max = sorted[0]?.seconds ?? 0;

  if (sorted.length === 0) {
    return <p className="dashboard-empty">{emptyLabel}</p>;
  }

  return (
    <ol className={highlightId === null ? "ranking-list" : "ranking-list has-highlight"}>
      {sorted.map((entry) => {
        const ratio = max > 0 ? entry.seconds / max : 0;
        const rank = ranked.indexOf(entry) + 1;
        return (
          <li
            className={entry.id === highlightId ? "ranking-row highlighted" : "ranking-row"}
            key={entry.id}
          >
            <span className="ranking-name">
              {rank > MAX_ROWS ? `${rank}. ` : ""}
              {entry.name}
            </span>
            <TooltipTrigger
              className="ranking-track"
              ariaLabel={`${entry.name}: ${formatHoursMinutes(entry.seconds)} totali, riepilogo degli ultimi mesi`}
              renderTooltip={() => (
                <BreakdownTooltip
                  title={entry.name}
                  totalSeconds={entry.seconds}
                  entries={monthlyRecap(entry.id, monthlyBuckets, metric)}
                />
              )}
            >
              <div
                className="ranking-bar"
                style={{ width: `${Math.max(4, ratio * 100)}%`, background: intensityColor(ratio) }}
              />
            </TooltipTrigger>
            <span className="ranking-value">{formatHoursMinutes(entry.seconds)}</span>
          </li>
        );
      })}
    </ol>
  );
}
