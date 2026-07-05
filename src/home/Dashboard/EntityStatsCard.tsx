import { formatHoursMinutes, formatMonthIt } from "../../lib/format";
import type { EntityStats } from "./timeAnalysis";
import { WEEKDAY_LABELS_IT } from "./timeAnalysis";

type EntityStatsCardProps = {
  stats: EntityStats | null;
  emptyLabel: string;
};

// Every figure is all-time (see timeAnalysis.ts), not the recent window the
// heatmap/monthly cards show — this card answers "overall, how do I spend
// time on this one project/activity", not "this month".
export function EntityStatsCard({ stats, emptyLabel }: EntityStatsCardProps) {
  if (!stats || stats.totalSeconds <= 0) {
    return <p className="dashboard-empty">{emptyLabel}</p>;
  }

  return (
    <div className="stat-tile-row">
      <div className="stat-tile">
        <span className="stat-tile-label">Tempo totale</span>
        <span className="stat-tile-value">{formatHoursMinutes(stats.totalSeconds)}</span>
      </div>
      <div className="stat-tile">
        <span className="stat-tile-label">Media al giorno attivo</span>
        <span className="stat-tile-value">{formatHoursMinutes(stats.avgSecondsPerActiveDay)}</span>
      </div>
      <div className="stat-tile">
        <span className="stat-tile-label">Mese migliore</span>
        <span className="stat-tile-value">
          {stats.bestMonth ? formatMonthIt(stats.bestMonth.month) : "—"}
        </span>
      </div>
      <div className="stat-tile">
        <span className="stat-tile-label">Giorno migliore</span>
        <span className="stat-tile-value">
          {stats.bestWeekday ? WEEKDAY_LABELS_IT[stats.bestWeekday.weekday] : "—"}
        </span>
      </div>
    </div>
  );
}
