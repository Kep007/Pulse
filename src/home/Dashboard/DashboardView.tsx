import { useEffect, useState } from "react";
import { getDailySummary, getMonthlySummary } from "../../lib/tauri";
import type { BreakdownMetric, DayBucket, MonthBucket } from "../../lib/types";
import { Heatmap, MONTHS_BACK } from "./Heatmap";
import { MonthlySummary } from "./MonthlySummary";
import { RangeSwitcher } from "./RangeSwitcher";

const MONTHLY_MONTHS = 12;

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function DashboardView() {
  const [metric, setMetric] = useState<BreakdownMetric>("project");
  const [dailyBuckets, setDailyBuckets] = useState<DayBucket[]>([]);
  const [monthlyBuckets, setMonthlyBuckets] = useState<MonthBucket[]>([]);

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
  }, []);

  return (
    <div className="dashboard-view">
      <div className="dashboard-toolbar">
        <RangeSwitcher metric={metric} onChange={setMetric} />
      </div>

      <section className="dashboard-card">
        <h2>Attività giornaliera</h2>
        <Heatmap buckets={dailyBuckets} metric={metric} />
      </section>

      <section className="dashboard-card">
        <h2>Andamento mensile</h2>
        <MonthlySummary buckets={monthlyBuckets} metric={metric} />
      </section>
    </div>
  );
}
