import { useEffect, useMemo, useState } from "react";
import { IconChevron } from "../../components/icons";
import { getActivityDetectionEnabled, getDailySummary, getMonthlySummary, listActivityTypes } from "../../lib/tauri";
import type { ActivityTypeDto, BreakdownMetric, DayBucket, MonthBucket } from "../../lib/types";
import { useProjects } from "../../lib/useProjects";
import { assignCategoricalColors } from "./categoricalPalette";
import { DailyTimeline, formatDayLabel, isToday } from "./DailyTimeline";
import { DashboardCardControls } from "./DashboardCardControls";
import { DashboardCardTitle } from "./DashboardCardTitle";
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
  const [activityEnabled, setActivityEnabled] = useState(false);

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
  const [timelineDate, setTimelineDate] = useState(() => new Date());

  function shiftTimelineDay(deltaDays: number) {
    setTimelineDate((current) => {
      const next = new Date(current);
      next.setDate(next.getDate() + deltaDays);
      return next;
    });
  }

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
    getActivityDetectionEnabled().then(setActivityEnabled);
  }, []);

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
    () => computeEntityStats(allTimeDailyBuckets, allTimeMonthlyBuckets, statsMetric, statsFilterId),
    [allTimeDailyBuckets, allTimeMonthlyBuckets, statsMetric, statsFilterId],
  );

  return (
    <div className="dashboard-view">
      <section className="dashboard-card">
        <div className="dashboard-card-header">
          <DashboardCardTitle
            title="Riepilogo"
            info="Statistiche calcolate su tutto lo storico registrato per il progetto o l'attività selezionata, non solo sul periodo mostrato negli altri grafici: media di tempo nei soli giorni in cui hai lavorato su questa voce, tempo totale, il mese e il giorno della settimana in cui vi hai dedicato più tempo in assoluto. Passa il mouse su tempo totale, mese e giorno migliore per vederne il dettaglio."
          />
          <DashboardCardControls
            metric={statsMetric}
            onMetricChange={setStatsMetric}
            filterId={statsFilterId}
            onFilterChange={setStatsFilterId}
            projects={projects}
            activityTypes={activityTypes}
            filterMode="all"
            activityEnabled={activityEnabled}
          />
        </div>
        <EntityStatsCard
          stats={entityStats}
          dailyBuckets={allTimeDailyBuckets}
          monthlyBuckets={allTimeMonthlyBuckets}
          metric={statsMetric}
          filterId={statsFilterId}
          emptyLabel={
            statsMetric === "project"
              ? "Nessun dato per questo progetto."
              : "Nessun dato per questa attività."
          }
        />
      </section>

      <section className="dashboard-card">
        <div className="dashboard-card-header">
          <DashboardCardTitle
            title="Timeline giornaliera"
            info="La sequenza dei progetti su cui hai lavorato nell'arco della giornata, nell'ordine e all'orario reale in cui sono avvenuti gli switch. Passa il mouse su un blocco per vedere l'orario, la durata di quella sessione e il totale accumulato quel giorno su quel progetto (anche se ci sei tornato più volte). Passa il mouse su una voce della legenda per vedere tutte le sessioni di quel progetto nella giornata."
          />
          <div className="timeline-day-nav">
            <button
              type="button"
              className="timeline-day-nav-button"
              onClick={() => shiftTimelineDay(-1)}
              aria-label="Giorno precedente"
            >
              <IconChevron size={14} className="timeline-chevron-left" />
            </button>
            <span className="timeline-day-label">{formatDayLabel(timelineDate)}</span>
            <button
              type="button"
              className="timeline-day-nav-button"
              onClick={() => shiftTimelineDay(1)}
              disabled={isToday(timelineDate)}
              aria-label="Giorno successivo"
            >
              <IconChevron size={14} className="timeline-chevron-right" />
            </button>
          </div>
        </div>
        <DailyTimeline date={timelineDate} projects={projects} />
      </section>

      <section className="dashboard-card">
        <div className="dashboard-card-header">
          <DashboardCardTitle
            title="Ripartizione del tempo"
            info="Percentuale di tempo dedicato a ciascun progetto (o attività) rispetto al totale, calcolata su tutto lo storico registrato. Oltre le prime 8 voci, il resto viene raggruppato in «Altro»."
          />
          <DashboardCardControls
            metric={breakdownMetric}
            onMetricChange={setBreakdownMetric}
            projects={projects}
            activityTypes={activityTypes}
            filterMode="none"
            activityEnabled={activityEnabled}
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
          <DashboardCardTitle
            title="Classifica"
            info="Progetti (o attività) ordinati per tempo totale dedicato, calcolato su tutto lo storico registrato — non solo sul periodo recente."
          />
          <DashboardCardControls
            metric={rankingMetric}
            onMetricChange={setRankingMetric}
            projects={projects}
            activityTypes={activityTypes}
            filterMode="none"
            activityEnabled={activityEnabled}
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
          <DashboardCardTitle
            title="Storico giornaliero"
            info="Un quadratino per ogni giorno, colorato in base a quanto tempo hai tracciato quel giorno — più scuro significa più tempo. Puoi filtrare per un singolo progetto o attività, oppure vedere il totale di tutti."
          />
          <DashboardCardControls
            metric={dailyMetric}
            onMetricChange={setDailyMetric}
            filterId={dailyFilterId}
            onFilterChange={setDailyFilterId}
            projects={projects}
            activityTypes={activityTypes}
            activityEnabled={activityEnabled}
          />
        </div>
        <Heatmap buckets={dailyBuckets} metric={dailyMetric} filterId={dailyFilterId} />
      </section>

      <section className="dashboard-card">
        <div className="dashboard-card-header">
          <DashboardCardTitle
            title="Storico mensile"
            info="Tempo totale tracciato in ciascuno degli ultimi 12 mesi. Il colore di ogni barra indica quanto quel mese si avvicina al mese con più tempo registrato nel periodo mostrato."
          />
          <DashboardCardControls
            metric={monthlyMetric}
            onMetricChange={setMonthlyMetric}
            filterId={monthlyFilterId}
            onFilterChange={setMonthlyFilterId}
            projects={projects}
            activityTypes={activityTypes}
            activityEnabled={activityEnabled}
          />
        </div>
        <MonthlySummary buckets={monthlyBuckets} metric={monthlyMetric} filterId={monthlyFilterId} />
      </section>
    </div>
  );
}
