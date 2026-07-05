import { useMemo } from "react";
import { formatHoursMinutes, formatMonthIt } from "../../lib/format";
import type { BreakdownMetric, MonthBucket } from "../../lib/types";
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

type MonthlySummaryProps = {
  buckets: MonthBucket[];
  metric: BreakdownMetric;
};

export function MonthlySummary({ buckets, metric }: MonthlySummaryProps) {
  const maxSeconds = useMemo(
    () => Math.max(1, ...buckets.map((bucket) => bucket.totalSeconds)),
    [buckets],
  );

  return (
    <div className="monthly-summary">
      {buckets.map((bucket) => {
        const entries = metric === "project" ? bucket.byProject : bucket.byActivity;
        const ratio = bucket.totalSeconds / maxSeconds;
        const heightPercent = bucket.totalSeconds > 0 ? Math.max(8, ratio * 100) : 0;

        return (
          <div className="monthly-bar-column" key={bucket.month}>
            <span className="monthly-bar-value">
              {bucket.totalSeconds > 0 ? formatHoursMinutes(bucket.totalSeconds) : ""}
            </span>
            <div className="monthly-bar-track">
              <TooltipTrigger
                className="monthly-bar"
                style={{ height: `${heightPercent}%`, background: intensityColor(ratio) }}
                ariaLabel={`${formatMonthIt(bucket.month)}: ${formatHoursMinutes(bucket.totalSeconds)}`}
                renderTooltip={() => (
                  <BreakdownTooltip
                    title={formatMonthIt(bucket.month)}
                    totalSeconds={bucket.totalSeconds}
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
