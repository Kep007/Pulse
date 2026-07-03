import { useMemo } from "react";
import { formatDateIt, formatHoursMinutes } from "../../lib/format";
import type { BreakdownMetric, DayBucket } from "../../lib/types";
import { BreakdownTooltip } from "./BreakdownTooltip";

const WEEKS = 26;
const DAY_LABELS = ["L", "M", "M", "G", "V", "S", "D"];
const MONTH_LABELS_IT = [
  "gen",
  "feb",
  "mar",
  "apr",
  "mag",
  "giu",
  "lug",
  "ago",
  "set",
  "ott",
  "nov",
  "dic",
];

// Bucket 0 is the neutral "no data" gray (chart chrome gridline token), kept
// outside the ramp on purpose. Buckets 1-4 are a validated one-hue sequential
// ramp (reference palette steps 250/400/550/700 — see dataviz skill; the
// lightest step is pinned to 250 because the ordinal floor requires ≥2:1
// contrast against the chart surface, which step 150/100 fail).
const BUCKET_COLORS = ["#e1e0d9", "#86b6ef", "#3987e5", "#1c5cab", "#0d366b"];

function isoDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function bucketIndex(totalSeconds: number) {
  if (totalSeconds <= 0) {
    return 0;
  }
  const hours = totalSeconds / 3600;
  if (hours < 1) {
    return 1;
  }
  if (hours < 3) {
    return 2;
  }
  if (hours < 5) {
    return 3;
  }
  return 4;
}

function buildWeeks(today: Date) {
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const dayOfWeek = (todayUtc.getUTCDay() + 6) % 7;
  const currentWeekMonday = new Date(todayUtc);
  currentWeekMonday.setUTCDate(todayUtc.getUTCDate() - dayOfWeek);

  const firstMonday = new Date(currentWeekMonday);
  firstMonday.setUTCDate(currentWeekMonday.getUTCDate() - (WEEKS - 1) * 7);

  const weeks: Date[][] = [];
  for (let week = 0; week < WEEKS; week++) {
    const days: Date[] = [];
    for (let day = 0; day < 7; day++) {
      const date = new Date(firstMonday);
      date.setUTCDate(firstMonday.getUTCDate() + week * 7 + day);
      days.push(date);
    }
    weeks.push(days);
  }
  return { weeks, todayUtc };
}

type HeatmapProps = {
  buckets: DayBucket[];
  metric: BreakdownMetric;
};

export function Heatmap({ buckets, metric }: HeatmapProps) {
  const bucketByDate = useMemo(() => {
    const map = new Map<string, DayBucket>();
    for (const bucket of buckets) {
      map.set(bucket.date, bucket);
    }
    return map;
  }, [buckets]);

  const { weeks, todayUtc } = useMemo(() => buildWeeks(new Date()), []);

  const monthLabels = useMemo(
    () =>
      weeks.map((week, index) => {
        const firstDay = week[0];
        const previousWeek = weeks[index - 1];
        const isNewMonth = !previousWeek || previousWeek[0].getUTCMonth() !== firstDay.getUTCMonth();
        return isNewMonth ? MONTH_LABELS_IT[firstDay.getUTCMonth()] : "";
      }),
    [weeks],
  );

  return (
    <div className="heatmap">
      <div className="heatmap-months">
        {monthLabels.map((label, index) => (
          <span key={index} className="heatmap-month-label">
            {label}
          </span>
        ))}
      </div>
      <div className="heatmap-body">
        <div className="heatmap-day-labels">
          {DAY_LABELS.map((label, index) => (
            <span key={index}>{label}</span>
          ))}
        </div>
        <div className="heatmap-grid">
          {weeks.map((week, weekIndex) => (
            <div className="heatmap-week" key={weekIndex}>
              {week.map((date) => {
                const dateKey = isoDateKey(date);
                const isFuture = date.getTime() > todayUtc.getTime();
                const bucket = bucketByDate.get(dateKey);
                const totalSeconds = bucket?.totalSeconds ?? 0;
                const entries = metric === "project" ? bucket?.byProject ?? [] : bucket?.byActivity ?? [];

                if (isFuture) {
                  return <div className="heatmap-cell future" key={dateKey} aria-hidden="true" />;
                }

                return (
                  <button
                    type="button"
                    key={dateKey}
                    className="heatmap-cell"
                    style={{ background: BUCKET_COLORS[bucketIndex(totalSeconds)] }}
                    aria-label={`${formatDateIt(dateKey)}: ${formatHoursMinutes(totalSeconds)}`}
                  >
                    <BreakdownTooltip
                      title={formatDateIt(dateKey)}
                      totalSeconds={totalSeconds}
                      entries={entries}
                    />
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="heatmap-legend">
        <span>Meno</span>
        {BUCKET_COLORS.map((color, index) => (
          <span key={index} className="legend-swatch" style={{ background: color }} />
        ))}
        <span>Più</span>
      </div>
    </div>
  );
}
