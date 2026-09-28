import type { FocusTotals, MonthBucket } from "../../lib/types";

export type FocusLevel = { label: string; tone: "high" | "mid" | "low" };

/** Share of tracked time spent in sessions of 25+ minutes (0–1). */
export function focusScore(totals: FocusTotals) {
  return totals.trackedSeconds > 0 ? totals.deepWorkSeconds / totals.trackedSeconds : 0;
}

export function focusLevel(score: number): FocusLevel {
  if (score >= 0.6) {
    return { label: "Alta", tone: "high" };
  }
  if (score >= 0.35) {
    return { label: "Media", tone: "mid" };
  }
  return { label: "Bassa", tone: "low" };
}

export function averageSessionSeconds(totals: FocusTotals) {
  return totals.sessions > 0 ? totals.trackedSeconds / totals.sessions : 0;
}

export function switchesPerHour(totals: FocusTotals) {
  return totals.trackedSeconds > 0 ? totals.switches / (totals.trackedSeconds / 3600) : 0;
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export type MonthlyLoad = {
  averageSeconds: number;
  minSeconds: number;
  maxSeconds: number;
  activeMonths: number;
  /** Average of the last 3 complete months (idle months count as 0). */
  recentSeconds: number | null;
};

/**
 * "How much of our month does this client take?" — an indicative range, not
 * a fixed figure: the average over the months actually worked on it, the
 * lightest and heaviest of those months, and the recent trend.
 */
export function monthlyLoad(
  buckets: MonthBucket[],
  projectId: number,
  now = new Date(),
): MonthlyLoad | null {
  const currentMonth = monthKey(now);
  const byMonth = new Map<string, number>();
  for (const bucket of buckets) {
    const seconds = bucket.byProject.find((entry) => entry.id === projectId)?.seconds ?? 0;
    if (seconds > 0) {
      byMonth.set(bucket.month, seconds);
    }
  }
  // The running month is still filling up — it would drag every figure
  // down, so it only counts when it's all there is.
  const complete = [...byMonth.entries()].filter(([month]) => month < currentMonth);
  const values = (complete.length > 0 ? complete : [...byMonth.entries()]).map(([, seconds]) => seconds);
  if (values.length === 0) {
    return null;
  }

  let recentTotal = 0;
  for (let back = 1; back <= 3; back += 1) {
    recentTotal += byMonth.get(monthKey(new Date(now.getFullYear(), now.getMonth() - back, 1))) ?? 0;
  }

  return {
    averageSeconds: values.reduce((sum, value) => sum + value, 0) / values.length,
    minSeconds: Math.min(...values),
    maxSeconds: Math.max(...values),
    activeMonths: values.length,
    recentSeconds: recentTotal > 0 ? recentTotal / 3 : null,
  };
}
