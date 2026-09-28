import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useState } from "react";
import { IconChevron } from "../../components/icons";
import {
  getActivityDetectionEnabled,
  getDailySummary,
  getFocusStats,
  getMonthlySummary,
  listActivityTypes,
} from "../../lib/tauri";
import type { FocusStats } from "../../lib/types";
import { FocusCard } from "./FocusCard";
import { ProjectComparison } from "./ProjectComparison";
import type { ActivityTypeDto, BreakdownMetric, DayBucket, MonthBucket } from "../../lib/types";
import { useProjects } from "../../lib/useProjects";
import { projectColorMap } from "../../lib/projectColors";
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
// Focus quality is about how you work *lately* — a year-old habit says
// little about today.
const FOCUS_DAYS = 90;
// Far enough back to cover any realistic history without a real "first ever
// entry" lookup — the daily/monthly summary commands only return buckets
// that actually have data, so this is just a safe lower bound, not a cost.
const ALL_TIME_FROM = "2000-01-01";

const FILTER_STORAGE_KEY = "pulse.dashboardFilter";

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function loadSavedFilter(): { metric: BreakdownMetric; filterId: number | null } {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTER_STORAGE_KEY) ?? "null");
    if (saved && (saved.metric === "project" || saved.metric === "activity")) {
      return {
        metric: saved.metric,
        filterId: typeof saved.filterId === "number" ? saved.filterId : null,
      };
    }
  } catch {
    // Fall through to the default.
  }
  return { metric: "project", filterId: null };
}

export function DashboardView() {
  const [allTimeDailyBuckets, setAllTimeDailyBuckets] = useState<DayBucket[]>([]);
  const [allTimeMonthlyBuckets, setAllTimeMonthlyBuckets] = useState<MonthBucket[]>([]);
  const [focusStats, setFocusStats] = useState<FocusStats | null>(null);
  const projects = useProjects();
  const [activityTypes, setActivityTypes] = useState<ActivityTypeDto[]>([]);
  const [activityEnabled, setActivityEnabled] = useState(false);

  // One filter for the whole dashboard, picked once at the top: every card
  // then answers "how is this project (or activity) doing", instead of each
  // card carrying its own dropdown that had to be set again card by card.
  const [metric, setMetric] = useState<BreakdownMetric>(() => loadSavedFilter().metric);
  const [filterId, setFilterId] = useState<number | null>(() => loadSavedFilter().filterId);
  const [timelineDate, setTimelineDate] = useState(() => new Date());

  useEffect(() => {
    try {
      localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({ metric, filterId }));
    } catch {
      // Storage unavailable: the filter just won't survive a reopen.
    }
  }, [metric, filterId]);

  // An archived project (or a stale saved id) must not leave every card
  // silently filtered to something the dropdown can no longer show.
  useEffect(() => {
    const options = metric === "project" ? projects : activityTypes;
    if (filterId !== null && options.length > 0 && !options.some((option) => option.id === filterId)) {
      setFilterId(null);
    }
  }, [metric, filterId, projects, activityTypes]);

  function shiftTimelineDay(deltaDays: number) {
    setTimelineDate((current) => {
      const next = new Date(current);
      next.setDate(next.getDate() + deltaDays);
      return next;
    });
  }

  useEffect(() => {
    let cancelled = false;
    listActivityTypes().then((value) => !cancelled && setActivityTypes(value));
    getActivityDetectionEnabled().then((value) => !cancelled && setActivityEnabled(value));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let debounceTimer: number | null = null;

    // Only the two all-time summaries are fetched: the heatmap's and the
    // monthly chart's shorter ranges are slices of them (see below), so
    // there's no reason to ask SQLite for the same rows twice.
    function loadAll() {
      const toIso = isoDate(new Date());
      getDailySummary(ALL_TIME_FROM, toIso).then((value) => !cancelled && setAllTimeDailyBuckets(value));
      getMonthlySummary(ALL_TIME_FROM, toIso).then(
        (value) => !cancelled && setAllTimeMonthlyBuckets(value),
      );
      getFocusStats(FOCUS_DAYS).then((value) => !cancelled && setFocusStats(value));
    }

    loadAll();

    // Live refresh while the window is open: tracked-state transitions
    // (project switch, pause, confirm...) re-run the summaries — coalesced,
    // since one user action often emits several state-changed events in a
    // row — plus a slow timer so the open segment's growing duration keeps
    // flowing into today's numbers. Both die with this window.
    const unlistenPromise = listen("state-changed", () => {
      if (debounceTimer !== null) {
        window.clearTimeout(debounceTimer);
      }
      debounceTimer = window.setTimeout(loadAll, 400);
    });
    const refreshTimer = window.setInterval(loadAll, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
      if (debounceTimer !== null) {
        window.clearTimeout(debounceTimer);
      }
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  // Matches Heatmap's own month-block range: the 1st of the month
  // (MONTHS_BACK - 1) months ago; the monthly chart shows the last
  // MONTHLY_MONTHS whole months. Both shift forward on their own as months
  // pass, since they're recomputed from today on every data refresh.
  const dailyBuckets = useMemo(() => {
    const from = new Date();
    from.setUTCDate(1);
    from.setUTCMonth(from.getUTCMonth() - (MONTHS_BACK - 1));
    const fromIso = isoDate(from);
    return allTimeDailyBuckets.filter((bucket) => bucket.date >= fromIso);
  }, [allTimeDailyBuckets]);
  const monthlyBuckets = useMemo(() => {
    const from = new Date();
    from.setUTCDate(1);
    from.setUTCMonth(from.getUTCMonth() - (MONTHLY_MONTHS - 1));
    const fromMonth = isoDate(from).slice(0, 7);
    return allTimeMonthlyBuckets.filter((bucket) => bucket.month >= fromMonth);
  }, [allTimeMonthlyBuckets]);

  // Color follows the entity (its catalog id), never its current rank in a
  // sorted-by-value list — otherwise the same project's slice would repaint
  // every time another project overtakes it. Projects use their stored color
  // (set/randomized in the Progetti tab) so every chart matches the swatch
  // shown there; activities keep the fixed categorical palette.
  const projectColors = useMemo(() => projectColorMap(projects), [projects]);
  const activityColors = useMemo(
    () => assignCategoricalColors(activityTypes.map((activityType) => activityType.id)),
    [activityTypes],
  );

  const allEntries = useMemo(
    () => sumAllTimeTotals(allTimeDailyBuckets, metric),
    [allTimeDailyBuckets, metric],
  );
  const colorById = metric === "project" ? projectColors : activityColors;
  // A breakdown of a single entity alone would always read 100% — with a
  // filter set it becomes "this one vs. everything else" instead.
  const breakdownEntries = useMemo(() => {
    if (filterId === null) {
      return allEntries;
    }
    const selected = allEntries.find((entry) => entry.id === filterId);
    if (!selected) {
      return [];
    }
    const restSeconds = allEntries.reduce(
      (sum, entry) => (entry.id === filterId ? sum : sum + entry.seconds),
      0,
    );
    return restSeconds > 0
      ? [selected, { id: -2, name: "Tutto il resto", color: null, seconds: restSeconds }]
      : [selected];
  }, [allEntries, filterId]);
  const entityStats = useMemo(
    () => computeEntityStats(allTimeDailyBuckets, allTimeMonthlyBuckets, metric, filterId),
    [allTimeDailyBuckets, allTimeMonthlyBuckets, metric, filterId],
  );
  const noDataLabel =
    metric === "project" ? "Nessun dato per questo progetto." : "Nessun dato per questa attività.";
  const nothingTrackedLabel =
    metric === "project" ? "Nessun progetto tracciato ancora." : "Nessuna attività tracciata ancora.";

  return (
    <div className="dashboard-view">
      <div className="dashboard-filter-sticky">
        <div className="dashboard-filter-bar">
          <span className="dashboard-filter-label">
            {metric === "project" ? "Mostra dati di" : "Mostra dati dell'attività"}
          </span>
          <DashboardCardControls
            metric={metric}
            onMetricChange={setMetric}
            filterId={filterId}
            onFilterChange={setFilterId}
            projects={projects}
            activityTypes={activityTypes}
            filterMode="all"
            activityEnabled={activityEnabled}
          />
        </div>
      </div>

      <section className="dashboard-card">
        <div className="dashboard-card-header">
          <DashboardCardTitle
            title="Riepilogo"
            info="Statistiche calcolate su tutto lo storico registrato per il progetto o l'attività selezionata in alto, non solo sul periodo mostrato negli altri grafici: media di tempo nei soli giorni in cui hai lavorato su questa voce, tempo totale, il mese e il giorno della settimana in cui vi hai dedicato più tempo in assoluto. Passa il mouse su tempo totale, mese e giorno più impegnativo per vederne il dettaglio."
          />
        </div>
        <EntityStatsCard
          stats={entityStats}
          dailyBuckets={allTimeDailyBuckets}
          monthlyBuckets={allTimeMonthlyBuckets}
          metric={metric}
          filterId={filterId}
          emptyLabel={noDataLabel}
        />
      </section>

      {metric === "project" && (
        <section className="dashboard-card">
          <div className="dashboard-card-header">
            <DashboardCardTitle
              title="Concentrazione"
              info={`Come lavori, sugli ultimi ${FOCUS_DAYS} giorni. Una sessione è tempo continuo sullo stesso progetto (una pausa di oltre 5 minuti o un cambio di progetto la chiude). Indice di concentrazione: quota di tempo passata in sessioni di almeno 25 minuti. Sessioni interrotte: quelle sotto i 10 minuti. Cambi di progetto: quante volte all'ora salti da un progetto a un altro senza una vera pausa in mezzo.`}
            />
          </div>
          <FocusCard stats={focusStats} projectId={filterId} />
        </section>
      )}

      {metric === "project" && (
        <section className="dashboard-card">
          <div className="dashboard-card-header">
            <DashboardCardTitle
              title="Confronto progetti"
              info="Quanto pesa ogni progetto sul tuo mese: la media delle ore nei mesi in cui ci hai lavorato, con tra parentesi il mese più leggero e il più pesante — un'indicazione, non una cifra fissa, perché dipende dalle richieste del cliente. Ultimi 3 mesi mostra la tendenza recente (↑ in crescita, ↓ in calo rispetto alla media). Il mese in corso non è conteggiato finché non è finito."
            />
          </div>
          <ProjectComparison
            projects={projects}
            monthlyBuckets={allTimeMonthlyBuckets}
            focus={focusStats}
            colorById={projectColors}
            highlightId={filterId}
          />
        </section>
      )}

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
        <DailyTimeline
          date={timelineDate}
          projects={projects}
          focusProjectId={metric === "project" ? filterId : null}
        />
      </section>

      <section className="dashboard-card">
        <div className="dashboard-card-header">
          <DashboardCardTitle
            title="Ripartizione del tempo"
            info="Percentuale di tempo dedicato a ciascun progetto (o attività) rispetto al totale, calcolata su tutto lo storico registrato. Con un filtro attivo mostra quanto pesa la voce selezionata rispetto a tutto il resto. Oltre le prime 8 voci, il resto viene raggruppato in «Altro»."
          />
        </div>
        <TimeBreakdownBar
          entries={breakdownEntries}
          colorById={colorById}
          emptyLabel={filterId === null ? nothingTrackedLabel : noDataLabel}
        />
      </section>

      <section className="dashboard-card">
        <div className="dashboard-card-header">
          <DashboardCardTitle
            title="Classifica"
            info="Progetti (o attività) ordinati per tempo totale dedicato, calcolato su tutto lo storico registrato — non solo sul periodo recente. Con un filtro attivo la voce selezionata viene evidenziata, anche se fuori dalle prime posizioni."
          />
        </div>
        <TopEntriesRanking
          entries={allEntries}
          monthlyBuckets={allTimeMonthlyBuckets}
          metric={metric}
          highlightId={filterId}
          emptyLabel={nothingTrackedLabel}
        />
      </section>

      <section className="dashboard-card">
        <div className="dashboard-card-header">
          <DashboardCardTitle
            title="Storico giornaliero"
            info="Un quadratino per ogni giorno, colorato in base a quanto tempo hai tracciato quel giorno — più scuro significa più tempo. Segue il filtro selezionato in alto."
          />
        </div>
        <Heatmap buckets={dailyBuckets} metric={metric} filterId={filterId} />
      </section>

      <section className="dashboard-card">
        <div className="dashboard-card-header">
          <DashboardCardTitle
            title="Storico mensile"
            info="Tempo totale tracciato in ciascuno degli ultimi 12 mesi, secondo il filtro selezionato in alto. Il colore di ogni barra indica quanto quel mese si avvicina al mese con più tempo registrato nel periodo mostrato."
          />
        </div>
        <MonthlySummary buckets={monthlyBuckets} metric={metric} filterId={filterId} />
      </section>
    </div>
  );
}
