import { useEffect, useState } from "react";
import { getDailySummary, getMonthlySummary, listActivityTypes, listProjects } from "../../lib/tauri";
import type {
  ActivityTypeDto,
  BreakdownMetric,
  DayBucket,
  MonthBucket,
  ProjectDto,
} from "../../lib/types";
import { DashboardCardControls } from "./DashboardCardControls";
import { Heatmap, MONTHS_BACK } from "./Heatmap";
import { MonthlySummary } from "./MonthlySummary";

const MONTHLY_MONTHS = 12;

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function DashboardView() {
  const [dailyBuckets, setDailyBuckets] = useState<DayBucket[]>([]);
  const [monthlyBuckets, setMonthlyBuckets] = useState<MonthBucket[]>([]);
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [activityTypes, setActivityTypes] = useState<ActivityTypeDto[]>([]);

  // Each card owns its own metric + filter — they're independent views, so
  // e.g. the daily heatmap can be filtered to one project while the monthly
  // chart still shows every activity.
  const [dailyMetric, setDailyMetric] = useState<BreakdownMetric>("project");
  const [dailyFilterId, setDailyFilterId] = useState<number | null>(null);
  const [monthlyMetric, setMonthlyMetric] = useState<BreakdownMetric>("project");
  const [monthlyFilterId, setMonthlyFilterId] = useState<number | null>(null);

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

    listProjects().then(setProjects);
    listActivityTypes().then(setActivityTypes);
  }, []);

  return (
    <div className="dashboard-view">
      <section className="dashboard-card">
        <div className="dashboard-card-header">
          <h2>Attività giornaliera</h2>
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
          <h2>Andamento mensile</h2>
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
