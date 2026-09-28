import { formatHoursMinutes } from "../../lib/format";
import type { FocusStats } from "../../lib/types";
import { averageSessionSeconds, focusLevel, focusScore, switchesPerHour } from "./focusMetrics";

type FocusCardProps = {
  stats: FocusStats | null;
  /** Dashboard project filter; null = every project. */
  projectId: number | null;
};

export function FocusCard({ stats, projectId }: FocusCardProps) {
  if (!stats) {
    return <p className="dashboard-empty">Caricamento…</p>;
  }
  const totals =
    projectId === null
      ? stats.overall
      : (stats.projects.find((project) => project.id === projectId)?.totals ?? null);
  if (!totals || totals.trackedSeconds <= 0) {
    return <p className="dashboard-empty">Nessun dato negli ultimi {stats.days} giorni.</p>;
  }

  const score = focusScore(totals);
  const level = focusLevel(score);
  const shortShare = totals.sessions > 0 ? totals.shortSessions / totals.sessions : 0;

  return (
    <div className="stat-tile-row">
      <div className="stat-tile">
        <span className="stat-tile-label">Indice di concentrazione</span>
        <span className="stat-tile-value">
          {Math.round(score * 100)}%
          <span className={`focus-badge focus-badge-${level.tone}`}>{level.label}</span>
        </span>
      </div>
      <div className="stat-tile">
        <span className="stat-tile-label">Sessione media</span>
        <span className="stat-tile-value">{formatHoursMinutes(averageSessionSeconds(totals))}</span>
      </div>
      <div className="stat-tile">
        <span className="stat-tile-label">Sessioni interrotte</span>
        <span className="stat-tile-value">{Math.round(shortShare * 100)}%</span>
      </div>
      <div className="stat-tile">
        <span className="stat-tile-label">
          {projectId === null ? "Cambi di progetto" : "Lo lasci per altro"}
        </span>
        <span className="stat-tile-value">
          {switchesPerHour(totals).toLocaleString("it-IT", { maximumFractionDigits: 1 })} / ora
        </span>
      </div>
    </div>
  );
}
