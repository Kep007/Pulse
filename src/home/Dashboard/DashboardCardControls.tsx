import type { ActivityTypeDto, BreakdownMetric, ProjectDto } from "../../lib/types";

type DashboardCardControlsProps = {
  metric: BreakdownMetric;
  onMetricChange: (metric: BreakdownMetric) => void;
  filterId: number | null;
  onFilterChange: (id: number | null) => void;
  projects: ProjectDto[];
  activityTypes: ActivityTypeDto[];
};

export function DashboardCardControls({
  metric,
  onMetricChange,
  filterId,
  onFilterChange,
  projects,
  activityTypes,
}: DashboardCardControlsProps) {
  const options = metric === "project" ? projects : activityTypes;

  function handleMetricChange(next: BreakdownMetric) {
    if (next !== metric) {
      onMetricChange(next);
      // A project id and an activity id aren't the same thing — carrying a
      // stale one across the switch would silently filter by the wrong
      // entity (or one that doesn't exist for the new metric at all).
      onFilterChange(null);
    }
  }

  return (
    <div className="card-controls">
      <div className="metric-switcher" role="tablist" aria-label="Ripartizione">
        <button
          type="button"
          role="tab"
          aria-selected={metric === "project"}
          className={metric === "project" ? "metric-tab active" : "metric-tab"}
          onClick={() => handleMetricChange("project")}
        >
          Progetti
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={metric === "activity"}
          className={metric === "activity" ? "metric-tab active" : "metric-tab"}
          onClick={() => handleMetricChange("activity")}
        >
          Attività
        </button>
      </div>
      <select
        className="card-filter-select"
        aria-label={metric === "project" ? "Filtra per progetto" : "Filtra per attività"}
        value={filterId ?? "all"}
        onChange={(event) =>
          onFilterChange(event.target.value === "all" ? null : Number(event.target.value))
        }
      >
        <option value="all">{metric === "project" ? "Tutti i progetti" : "Tutte le attività"}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </div>
  );
}
