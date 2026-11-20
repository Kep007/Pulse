import { capitalize, formatDayMonthIt, formatDayMonthYearIt, formatMonthIt } from "../../lib/format";
import type { BreakdownEntry, BreakdownMetric, DayBucket, MonthBucket } from "../../lib/types";

export const WEEKDAY_LABELS_IT = [
  "Lunedì",
  "Martedì",
  "Mercoledì",
  "Giovedì",
  "Venerdì",
  "Sabato",
  "Domenica",
];

function entriesOf(
  bucket: { byProject: BreakdownEntry[]; byActivity: BreakdownEntry[] },
  metric: BreakdownMetric,
) {
  return metric === "project" ? bucket.byProject : bucket.byActivity;
}

// `filterId === null` means "Tutti" — every entity in the bucket summed into
// one synthetic entry — instead of one specific project/activity's own row.
function entryFor(
  bucket: { byProject: BreakdownEntry[]; byActivity: BreakdownEntry[] },
  metric: BreakdownMetric,
  filterId: number | null,
): BreakdownEntry | undefined {
  const entries = entriesOf(bucket, metric);
  if (filterId === null) {
    const seconds = entries.reduce((sum, entry) => sum + entry.seconds, 0);
    return seconds > 0 ? { id: -1, name: "Tutti", color: null, seconds } : undefined;
  }
  return entries.find((item) => item.id === filterId);
}

// All-time total per project/activity, summed across every fetched day —
// the source for both the percentage breakdown and the ranking card. Sorted
// descending so callers don't each need their own sort.
export function sumAllTimeTotals(dailyBuckets: DayBucket[], metric: BreakdownMetric): BreakdownEntry[] {
  const totals = new Map<number, BreakdownEntry>();
  for (const bucket of dailyBuckets) {
    for (const entry of entriesOf(bucket, metric)) {
      const existing = totals.get(entry.id);
      if (existing) {
        existing.seconds += entry.seconds;
      } else {
        totals.set(entry.id, { ...entry });
      }
    }
  }
  return Array.from(totals.values()).sort((a, b) => b.seconds - a.seconds);
}

// 0 = Monday, matching WEEKDAY_LABELS_IT and the rest of the app's
// Monday-first convention (see Heatmap.tsx).
function weekdayIndex(dateKey: string) {
  const jsDay = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return (jsDay + 6) % 7;
}

export type EntityStats = {
  totalSeconds: number;
  activeDays: number;
  avgSecondsPerActiveDay: number;
  /** Average of each month's own total, over the months with any time —
   *  a month with 5 working days and 10h counts as 10h. The running month
   *  only counts when it's the only one (it would drag the average down). */
  avgSecondsPerMonth: number;
  activeMonths: number;
  thisMonthSeconds: number;
  bestMonth: { month: string; seconds: number } | null;
  bestWeekday: { weekday: number; seconds: number } | null;
};

// Every figure here is computed over the *entire* fetched history, not the
// recent window the other cards show — deliberately: "the average of the
// last month" was explicitly not what was wanted, an all-time figure was.
export function computeEntityStats(
  dailyBuckets: DayBucket[],
  monthlyBuckets: MonthBucket[],
  metric: BreakdownMetric,
  filterId: number | null,
): EntityStats {
  let totalSeconds = 0;
  let activeDays = 0;
  const weekdayTotals = new Array(7).fill(0) as number[];

  for (const bucket of dailyBuckets) {
    const entry = entryFor(bucket, metric, filterId);
    if (entry && entry.seconds > 0) {
      totalSeconds += entry.seconds;
      activeDays += 1;
      weekdayTotals[weekdayIndex(bucket.date)] += entry.seconds;
    }
  }

  let bestMonth: EntityStats["bestMonth"] = null;
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const pastMonths: number[] = [];
  let thisMonthSeconds = 0;
  for (const bucket of monthlyBuckets) {
    const entry = entryFor(bucket, metric, filterId);
    if (!entry || entry.seconds <= 0) {
      continue;
    }
    if (bestMonth === null || entry.seconds > bestMonth.seconds) {
      bestMonth = { month: bucket.month, seconds: entry.seconds };
    }
    if (bucket.month === currentMonth) {
      thisMonthSeconds = entry.seconds;
    } else if (bucket.month < currentMonth) {
      pastMonths.push(entry.seconds);
    }
  }
  const averaged = pastMonths.length > 0 ? pastMonths : thisMonthSeconds > 0 ? [thisMonthSeconds] : [];
  const avgSecondsPerMonth =
    averaged.length > 0 ? averaged.reduce((sum, seconds) => sum + seconds, 0) / averaged.length : 0;

  let bestWeekday: EntityStats["bestWeekday"] = null;
  weekdayTotals.forEach((seconds, weekday) => {
    if (seconds > 0 && (bestWeekday === null || seconds > bestWeekday.seconds)) {
      bestWeekday = { weekday, seconds };
    }
  });

  return {
    totalSeconds,
    activeDays,
    avgSecondsPerActiveDay: activeDays > 0 ? totalSeconds / activeDays : 0,
    avgSecondsPerMonth,
    activeMonths: averaged.length,
    thisMonthSeconds,
    bestMonth,
    bestWeekday,
  };
}

// "Storico dei tempi" behind the total: one row per month with time on this
// entity, most recent first (monthlyBuckets comes back oldest-first from the
// backend). The row cap lives in the tooltip component, same as every other
// breakdown tooltip in the app.
export function monthlyHistoryEntries(
  monthlyBuckets: MonthBucket[],
  metric: BreakdownMetric,
  filterId: number | null,
): BreakdownEntry[] {
  const rows: BreakdownEntry[] = [];
  for (const bucket of monthlyBuckets) {
    const entry = entryFor(bucket, metric, filterId);
    if (entry && entry.seconds > 0) {
      rows.push({ id: rows.length, name: capitalize(formatMonthIt(bucket.month)), color: null, seconds: entry.seconds });
    }
  }
  return rows.reverse();
}

// Behind "Mese migliore": one row per day inside that specific month with
// time on this entity, in calendar order.
export function monthDailyEntries(
  dailyBuckets: DayBucket[],
  metric: BreakdownMetric,
  filterId: number | null,
  month: string,
): BreakdownEntry[] {
  const rows: BreakdownEntry[] = [];
  for (const bucket of dailyBuckets) {
    if (!bucket.date.startsWith(month)) {
      continue;
    }
    const entry = entryFor(bucket, metric, filterId);
    if (entry && entry.seconds > 0) {
      rows.push({ id: rows.length, name: formatDayMonthIt(bucket.date), color: null, seconds: entry.seconds });
    }
  }
  return rows;
}

// Behind "Giorno migliore": every past occurrence of that weekday with time
// on this entity (e.g. every Saturday ever), most recent first.
export function weekdayHistoryEntries(
  dailyBuckets: DayBucket[],
  metric: BreakdownMetric,
  filterId: number | null,
  weekday: number,
): BreakdownEntry[] {
  const rows: BreakdownEntry[] = [];
  for (const bucket of dailyBuckets) {
    if (weekdayIndex(bucket.date) !== weekday) {
      continue;
    }
    const entry = entryFor(bucket, metric, filterId);
    if (entry && entry.seconds > 0) {
      rows.push({ id: rows.length, name: formatDayMonthYearIt(bucket.date), color: null, seconds: entry.seconds });
    }
  }
  return rows.reverse();
}
