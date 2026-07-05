import { useMemo } from "react";
import { formatHoursMinutes, formatMonthIt } from "../../lib/format";
import type { BreakdownEntry, BreakdownMetric, MonthBucket } from "../../lib/types";
import { BreakdownTooltip } from "./BreakdownTooltip";
import { BUCKET_COLORS } from "./Heatmap";
import { TooltipTrigger } from "./TooltipTrigger";

// Bar color scales with each month's share of the busiest month (not raw
// hours, since a "big" month varies a lot by user) — reusing the heatmap's
// ramp so both charts read as the same visual language.
function intensityColor(ratio: number) {
  if (ratio <= 0) {
    return BUCKET_COLORS[0];
  }
  if (ratio < 0.25) {
    return BUCKET_COLORS[1];
  }
  if (ratio < 0.5) {
    return BUCKET_COLORS[2];
  }
  if (ratio < 0.75) {
    return BUCKET_COLORS[3];
  }
  return BUCKET_COLORS[4];
}

// When a specific project/activity is selected (filterId), a bar should
// reflect only its share of the month instead of the month's grand total —
// same idea for the single-entry tooltip breakdown.
function filteredTotal(entries: BreakdownEntry[], filterId: number | null, fallback: number) {
  if (filterId === null) {
    return { totalSeconds: fallback, entries };
  }
  const match = entries.find((entry) => entry.id === filterId);
  return { totalSeconds: match?.seconds ?? 0, entries: match ? [match] : [] };
}

type MonthlySummaryProps = {
  buckets: MonthBucket[];
  metric: BreakdownMetric;
  filterId: number | null;
};

export function MonthlySummary({ buckets, metric, filterId }: MonthlySummaryProps) {
  const rows = useMemo(
    () =>
      buckets.map((bucket) => {
        const rawEntries = metric === "project" ? bucket.byProject : bucket.byActivity;
        const { totalSeconds, entries } = filteredTotal(rawEntries, filterId, bucket.totalSeconds);
        return { bucket, totalSeconds, entries };
      }),
    [buckets, metric, filterId],
  );

  const maxSeconds = useMemo(
    () => Math.max(1, ...rows.map((row) => row.totalSeconds)),
    [rows],
  );

  return (
    <div className="monthly-summary">
      {rows.map(({ bucket, totalSeconds, entries }) => {
        const ratio = totalSeconds / maxSeconds;
        const heightPercent = totalSeconds > 0 ? Math.max(8, ratio * 100) : 0;

        return (
          <div className="monthly-bar-column" key={bucket.month}>
            <span className="monthly-bar-value">
              {totalSeconds > 0 ? formatHoursMinutes(totalSeconds) : ""}
            </span>
            <div className="monthly-bar-track">
              <TooltipTrigger
                className="monthly-bar"
                style={{ height: `${heightPercent}%`, background: intensityColor(ratio) }}
                ariaLabel={`${formatMonthIt(bucket.month)}: ${formatHoursMinutes(totalSeconds)}`}
                renderTooltip={() => (
                  <BreakdownTooltip
                    title={formatMonthIt(bucket.month)}
                    totalSeconds={totalSeconds}
                    entries={entries}
                  />
                )}
              />
            </div>
            <span className="monthly-bar-label">{formatMonthIt(bucket.month).slice(0, 3)}</span>
          </div>
        );
      })}
    </div>
  );
}
