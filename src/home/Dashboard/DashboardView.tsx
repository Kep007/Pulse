import { useEffect, useState } from "react";
import { getDailySummary, getMonthlySummary } from "../../lib/tauri";
import { useTrackingState } from "../../lib/TrackingContext";
import type { BreakdownMetric, DayBucket, MonthBucket } from "../../lib/types";
import { Heatmap } from "./Heatmap";
import { MonthlySummary } from "./MonthlySummary";
import { RangeSwitcher } from "./RangeSwitcher";

const HEATMAP_WEEKS = 26;
const MONTHLY_MONTHS = 12;

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function DashboardView() {
  const state = useTrackingState();
  const [metric, setMetric] = useState<BreakdownMetric>("project");
  const [dailyBuckets, setDailyBuckets] = useState<DayBucket[]>([]);
  const [monthlyBuckets, setMonthlyBuckets] = useState<MonthBucket[]>([]);

  useEffect(() => {
    const to = new Date();
    const from = new Date(to);
    from.setUTCDate(from.getUTCDate() - HEATMAP_WEEKS * 7);
    getDailySummary(isoDate(from), isoDate(to)).then(setDailyBuckets);

    const monthlyFrom = new Date(to);
    monthlyFrom.setUTCMonth(monthlyFrom.getUTCMonth() - (MONTHLY_MONTHS - 1));
    getMonthlySummary(isoDate(monthlyFrom), isoDate(to)).then(setMonthlyBuckets);
  }, []);

  return (
    <div className="dashboard-view">
      <section className="now-card">
        <span className="label">
          {state?.isPaused ? "In pausa" : state?.source === "manual" ? "Manuale" : "Automatico"}
        </span>
        <strong>{state?.project?.name ?? "Nessun progetto rilevato"}</strong>
        <span className="now-activity">{state?.activityType?.name ?? "Nessuna attività"}</span>
      </section>

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
