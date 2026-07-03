import { useMemo } from "react";
import { formatHoursMinutes, formatMonthIt } from "../../lib/format";
import type { BreakdownMetric, MonthBucket } from "../../lib/types";
import { BreakdownTooltip } from "./BreakdownTooltip";

const BAR_COLOR = "#2a78d6";

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
        const heightPercent = Math.max(2, (bucket.totalSeconds / maxSeconds) * 100);

        return (
          <div className="monthly-bar-column" key={bucket.month}>
            <button
              type="button"
              className="monthly-bar"
              style={{ height: `${heightPercent}%`, background: BAR_COLOR }}
              aria-label={`${formatMonthIt(bucket.month)}: ${formatHoursMinutes(bucket.totalSeconds)}`}
            >
              <BreakdownTooltip
                title={formatMonthIt(bucket.month)}
                totalSeconds={bucket.totalSeconds}
                entries={entries}
              />
            </button>
            <span className="monthly-bar-label">{formatMonthIt(bucket.month).slice(0, 3)}</span>
          </div>
        );
      })}
    </div>
  );
}
