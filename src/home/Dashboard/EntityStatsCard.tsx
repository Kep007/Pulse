import { capitalize, formatHoursMinutes, formatMonthIt } from "../../lib/format";
import type { BreakdownMetric, DayBucket, MonthBucket } from "../../lib/types";
import { BreakdownTooltip } from "./BreakdownTooltip";
import {
  monthDailyEntries,
  monthlyHistoryEntries,
  weekdayHistoryEntries,
  WEEKDAY_LABELS_IT,
} from "./timeAnalysis";
import type { EntityStats } from "./timeAnalysis";
import { TooltipTrigger } from "./TooltipTrigger";

type EntityStatsCardProps = {
  stats: EntityStats | null;
  dailyBuckets: DayBucket[];
  monthlyBuckets: MonthBucket[];
  metric: BreakdownMetric;
  filterId: number | null;
  emptyLabel: string;
};

// Every figure is all-time (see timeAnalysis.ts), not the recent window the
// heatmap/monthly cards show — this card answers "overall, how do I spend
// time on this one project/activity", not "this month". The total, best
// month, and best weekday tiles are themselves hoverable — each opens the
// breakdown behind that number (which months made up the total, which days
// made up the best month, every past occurrence of the best weekday).
export function EntityStatsCard({
  stats,
  dailyBuckets,
  monthlyBuckets,
  metric,
  filterId,
  emptyLabel,
}: EntityStatsCardProps) {
  if (!stats || stats.totalSeconds <= 0) {
    return <p className="dashboard-empty">{emptyLabel}</p>;
  }

  const monthlyHistory = monthlyHistoryEntries(monthlyBuckets, metric, filterId);
  const bestMonth = stats.bestMonth;
  const bestWeekday = stats.bestWeekday;
  const monthDetail = bestMonth ? monthDailyEntries(dailyBuckets, metric, filterId, bestMonth.month) : [];
  const weekdayHistory = bestWeekday
    ? weekdayHistoryEntries(dailyBuckets, metric, filterId, bestWeekday.weekday)
    : [];

  return (
    <div className="stat-tile-row">
      <div className="stat-tile">
        <span className="stat-tile-label">Media mensile</span>
        <TooltipTrigger
          className="stat-tile-value stat-tile-value-hoverable"
          ariaLabel={`Media mensile ${formatHoursMinutes(stats.avgSecondsPerMonth)}: vedi le ore di ogni mese`}
          renderTooltip={() => (
            <BreakdownTooltip
              title={`Media su ${stats.activeMonths} ${stats.activeMonths === 1 ? "mese" : "mesi"}`}
              totalSeconds={stats.totalSeconds}
              entries={monthlyHistory}
            />
          )}
        >
          {formatHoursMinutes(stats.avgSecondsPerMonth)}
        </TooltipTrigger>
      </div>

      {filterId === null ? (
        <div className="stat-tile">
          <span className="stat-tile-label">Questo mese</span>
          <span className="stat-tile-value">{formatHoursMinutes(stats.thisMonthSeconds)}</span>
        </div>
      ) : (
        <div className="stat-tile">
          <span className="stat-tile-label">Tempo totale</span>
          <span className="stat-tile-value">{formatHoursMinutes(stats.totalSeconds)}</span>
        </div>
      )}

      <div className="stat-tile">
        <span className="stat-tile-label">Mese più impegnativo</span>
        {bestMonth ? (
          <TooltipTrigger
            className="stat-tile-value stat-tile-value-hoverable"
            ariaLabel={`Mese più impegnativo ${formatMonthIt(bestMonth.month)}: vedi il dettaglio giornaliero`}
            renderTooltip={() => (
              <BreakdownTooltip
                title={formatMonthIt(bestMonth.month)}
                totalSeconds={bestMonth.seconds}
                entries={monthDetail}
              />
            )}
          >
            {capitalize(formatMonthIt(bestMonth.month))}
          </TooltipTrigger>
        ) : (
          <span className="stat-tile-value">—</span>
        )}
      </div>

      <div className="stat-tile">
        <span className="stat-tile-label">{filterId === null ? "Giorno più carico" : "Giorno più impegnativo"}</span>
        {bestWeekday ? (
          <TooltipTrigger
            className="stat-tile-value stat-tile-value-hoverable"
            ariaLabel={`Giorno più impegnativo ${WEEKDAY_LABELS_IT[bestWeekday.weekday]}: vedi lo storico completo`}
            renderTooltip={() => (
              <BreakdownTooltip
                title={WEEKDAY_LABELS_IT[bestWeekday.weekday]}
                totalSeconds={bestWeekday.seconds}
                entries={weekdayHistory}
              />
            )}
          >
            {WEEKDAY_LABELS_IT[bestWeekday.weekday]}
          </TooltipTrigger>
        ) : (
          <span className="stat-tile-value">—</span>
        )}
      </div>
    </div>
  );
}
