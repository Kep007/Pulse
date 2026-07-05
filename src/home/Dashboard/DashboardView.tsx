import { useEffect, useMemo, useState } from "react";
import { getDailySummary, getMonthlySummary, listActivityTypes } from "../../lib/tauri";
import type { ActivityTypeDto, BreakdownMetric, DayBucket, MonthBucket } from "../../lib/types";
import { useProjects } from "../../lib/useProjects";
import { assignCategoricalColors } from "./categoricalPalette";
import { DashboardCardControls } from "./DashboardCardControls";
import { EntityStatsCard } from "./EntityStatsCard";
import { Heatmap, MONTHS_BACK } from "./Heatmap";
import { MonthlySummary } from "./MonthlySummary";
import { computeEntityStats, sumAllTimeTotals } from "./timeAnalysis";
import { TimeBreakdownBar } from "./TimeBreakdownBar";
import { TopEntriesRanking } from "./TopEntriesRanking";

const MONTHLY_MONTHS = 12;
// Far enough back to cover any realistic history without a real "first ever
// entry" lookup — the daily/monthly summary commands only return buckets
// that actually have data, so this is just a safe lower bound, not a cost.
const ALL_TIME_FROM = "2000-01-01";

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function DashboardView() {
  const [dailyBuckets, setDailyBuckets] = useState<DayBucket[]>([]);
  const [monthlyBuckets, setMonthlyBuckets] = useState<MonthBucket[]>([]);
  const [allTimeDailyBuckets, setAllTimeDailyBuckets] = useState<DayBucket[]>([]);
  const [allTimeMonthlyBuckets, setAllTimeMonthlyBuckets] = useState<MonthBucket[]>([]);
  const projects = useProjects();
  const [activityTypes, setActivityTypes] = useState<ActivityTypeDto[]>([]);

  // Each card owns its own metric + filter — they're independent views, so
  // e.g. the daily heatmap can be filtered to one project while the monthly
  // chart still shows every activity.
  const [dailyMetric, setDailyMetric] = useState<BreakdownMetric>("project");
  const [dailyFilterId, setDailyFilterId] = useState<number | null>(null);
  const [monthlyMetric, setMonthlyMetric] = useState<BreakdownMetric>("project");
  const [monthlyFilterId, setMonthlyFilterId] = useState<number | null>(null);
  const [breakdownMetric, setBreakdownMetric] = useState<BreakdownMetric>("project");
  const [rankingMetric, setRankingMetric] = useState<BreakdownMetric>("project");
  const [statsMetric, setStatsMetric] = useState<BreakdownMetric>("project");
  const [statsFilterId, setStatsFilterId] = useState<number | null>(null);

  useEffect(() => {
    const to = new Date();
    // Matches Heatmap's own month-block range: the 1st of the month
    // (MONTHS_BACK - 1) months ago, so fetched data covers exactly what's
    // rendered (that range shifts forward on its own as months pass).
    const from = new Date(to);
    from.setUTCDate(1);
    from.setUTCMonth(from.getUTCMonth() - (MONTHS_BACK - 1));
    getDailySummary(isoDate(from), isoDate(to)).then(setDailyBuckets);

    const monthlyFrom = new Date(to);
    monthlyFrom.setUTCMonth(monthlyFrom.getUTCMonth() - (MONTHLY_MONTHS - 1));
    getMonthlySummary(isoDate(monthlyFrom), isoDate(to)).then(setMonthlyBuckets);

    const toIso = isoDate(to);
    getDailySummary(ALL_TIME_FROM, toIso).then(setAllTimeDailyBuckets);
    getMonthlySummary(ALL_TIME_FROM, toIso).then(setAllTimeMonthlyBuckets);

    listActivityTypes().then(setActivityTypes);
  }, []);

  // The dynamic per-entity card has no "all" option — once the catalog for
  // the current metric loads, default it to the first entity instead of
  // showing an empty card until the user picks one themselves.
  useEffect(() => {
    if (statsFilterId !== null) {
      return;
    }
    const options = statsMetric === "project" ? projects : activityTypes;
    if (options.length > 0) {
      setStatsFilterId(options[0].id);
    }
  }, [statsMetric, statsFilterId, projects, activityTypes]);

  // Color follows the entity (its catalog id), never its current rank in a
  // sorted-by-value list — otherwise the same project's slice would repaint
  // every time another project overtakes it.
  const projectColors = useMemo(
    () => assignCategoricalColors(projects.map((project) => project.id)),
    [projects],
  );
  const activityColors = useMemo(
    () => assignCategoricalColors(activityTypes.map((activityType) => activityType.id)),
    [activityTypes],
  );

  const breakdownEntries = useMemo(
    () => sumAllTimeTotals(allTimeDailyBuckets, breakdownMetric),
    [allTimeDailyBuckets, breakdownMetric],
  );
  const rankingEntries = useMemo(
    () => sumAllTimeTotals(allTimeDailyBuckets, rankingMetric),
    [allTimeDailyBuckets, rankingMetric],
  );
  const entityStats = useMemo(
    () =>
      statsFilterId === null
        ? null
        : computeEntityStats(allTimeDailyBuckets, allTimeMonthlyBuckets, statsMetric, statsFilterId),
    [allTimeDailyBuckets, allTimeMonthlyBuckets, statsMetric, statsFilterId],
  );

  return (
    <div className="dashboard-view">
      <section className="dashboard-card">
        <div className="dashboard-card-header">
          <h2>Riepilogo</h2>
          <DashboardCardControls
            metric={statsMetric}
            onMetricChange={setStatsMetric}
            filterId={statsFilterId}
            onFilterChange={setStatsFilterId}
            projects={projects}
            activityTypes={activityTypes}
            filterMode="required"
          />
        </div>
        <EntityStatsCard
          stats={entityStats}
          emptyLabel={
            statsMetric === "project"
              ? "Nessun dato per questo progetto."
              : "Nessun dato per questa attività."
          }
        />
      </section>

      <section className="dashboard-card">
        <div className="dashboard-card-header">
          <h2>Ripartizione del tempo</h2>
          <DashboardCardControls
            metric={breakdownMetric}
            onMetricChange={setBreakdownMetric}
            projects={projects}
            activityTypes={activityTypes}
            filterMode="none"
          />
        </div>
        <TimeBreakdownBar
          entries={breakdownEntries}
          colorById={breakdownMetric === "project" ? projectColors : activityColors}
          emptyLabel={
            breakdownMetric === "project" ? "Nessun progetto tracciato ancora." : "Nessuna attività tracciata ancora."
          }
        />
      </section>

      <section className="dashboard-card">
        <div className="dashboard-card-header">
          <h2>Classifica</h2>
          <DashboardCardControls
            metric={rankingMetric}
            onMetricChange={setRankingMetric}
            projects={projects}
            activityTypes={activityTypes}
            filterMode="none"
          />
        </div>
        <TopEntriesRanking
          entries={rankingEntries}
          emptyLabel={
            rankingMetric === "project" ? "Nessun progetto tracciato ancora." : "Nessuna attività tracciata ancora."
          }
        />
      </section>

      <section className="dashboard-card">
        <div className="dashboard-card-header">
          <h2>Storico giornaliero</h2>
          <DashboardCardControls
            metric={dailyMetric}
            onMetricChange={setDailyMetric}
            filterId={dailyFilterId}
            onFilterChange={setDailyFilterId}
            projects={projects}
            activityTypes={activityTypes}
          />
        </div>
        <Heatmap buckets={dailyBuckets} metric={dailyMetric} filterId={dailyFilterId} />
      </section>

      <section className="dashboard-card">
        <div className="dashboard-card-header">
          <h2>Storico mensile</h2>
          <DashboardCardControls
            metric={monthlyMetric}
            onMetricChange={setMonthlyMetric}
            filterId={monthlyFilterId}
            onFilterChange={setMonthlyFilterId}
            projects={projects}
            activityTypes={activityTypes}
          />
        </div>
        <MonthlySummary buckets={monthlyBuckets} metric={monthlyMetric} filterId={monthlyFilterId} />
      </section>
    </div>
  );
}
