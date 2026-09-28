import { formatHoursMinutes } from "../../lib/format";
import type { FocusStats, MonthBucket, ProjectDto } from "../../lib/types";
import { focusLevel, focusScore, monthlyLoad, type MonthlyLoad } from "./focusMetrics";

type ProjectComparisonProps = {
  projects: ProjectDto[];
  monthlyBuckets: MonthBucket[];
  focus: FocusStats | null;
  colorById: Map<number, string>;
  highlightId: number | null;
};

function wholeHours(seconds: number) {
  return `${Math.round(seconds / 3600)}h`;
}

function trendOf(load: MonthlyLoad) {
  if (load.recentSeconds === null) {
    return null;
  }
  if (load.recentSeconds > load.averageSeconds * 1.15) {
    return "up";
  }
  if (load.recentSeconds < load.averageSeconds * 0.85) {
    return "down";
  }
  return "flat";
}

// Answers the project manager's "how much of our month does this client
// take?" with a range, since the real figure moves with each month's
// requests — plus whether it's trending up and how focused that work is.
export function ProjectComparison({
  projects,
  monthlyBuckets,
  focus,
  colorById,
  highlightId,
}: ProjectComparisonProps) {
  const rows = projects
    .flatMap((project) => {
      const load = monthlyLoad(monthlyBuckets, project.id);
      if (!load) {
        return [];
      }
      const projectFocus = focus?.projects.find((entry) => entry.id === project.id)?.totals;
      return [{ project, load, projectFocus }];
    })
    .sort((a, b) => b.load.averageSeconds - a.load.averageSeconds);

  if (rows.length === 0) {
    return <p className="dashboard-empty">Nessun progetto tracciato ancora.</p>;
  }
  const maxAverage = rows[0].load.averageSeconds;

  return (
    <div className="comparison-table" role="table">
      <div className="comparison-row comparison-head" role="row">
        <span role="columnheader">Progetto</span>
        <span role="columnheader">Carico mensile</span>
        <span role="columnheader">Ultimi 3 mesi</span>
        <span role="columnheader">Concentrazione</span>
      </div>
      {rows.map(({ project, load, projectFocus }) => {
        const level =
          projectFocus && projectFocus.trackedSeconds > 0 ? focusLevel(focusScore(projectFocus)) : null;
        const trend = trendOf(load);
        return (
          <div
            key={project.id}
            role="row"
            className={[
              "comparison-row",
              highlightId !== null && project.id !== highlightId && "dimmed",
              project.id === highlightId && "highlighted",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <span className="comparison-name" role="cell">
              <span className="breakdown-swatch" style={{ background: colorById.get(project.id) }} />
              {project.name}
            </span>
            <span className="comparison-load" role="cell">
              <span className="comparison-load-bar">
                <span style={{ width: `${Math.max(4, (load.averageSeconds / maxAverage) * 100)}%` }} />
              </span>
              <span title={`Media su ${load.activeMonths} mesi di lavoro`}>
                {formatHoursMinutes(load.averageSeconds)}
                {load.activeMonths > 1 && (
                  <small>
                    {" "}
                    ({wholeHours(load.minSeconds)}–{wholeHours(load.maxSeconds)})
                  </small>
                )}
              </span>
            </span>
            <span role="cell" className={trend ? `comparison-trend-${trend}` : undefined}>
              {load.recentSeconds === null ? "—" : formatHoursMinutes(load.recentSeconds)}
              {trend === "up" ? " ↑" : trend === "down" ? " ↓" : ""}
            </span>
            <span role="cell">
              {level ? (
                <span className={`focus-badge focus-badge-${level.tone}`}>{level.label}</span>
              ) : (
                "—"
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
