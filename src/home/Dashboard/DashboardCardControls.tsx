import type { ActivityTypeDto, BreakdownMetric, ProjectDto } from "../../lib/types";

// "all" — the usual switcher + "Tutti i progetti/Tutte le attività" + one
//   specific entity.
// "none" — switcher only, no dropdown (a ranking or breakdown across every
//   entity has nothing meaningful to filter down to one item).
type FilterMode = "all" | "none";

type DashboardCardControlsProps = {
  metric: BreakdownMetric;
  onMetricChange: (metric: BreakdownMetric) => void;
  filterId?: number | null;
  onFilterChange?: (id: number | null) => void;
  projects: ProjectDto[];
  activityTypes: ActivityTypeDto[];
  filterMode?: FilterMode;
  // Activities are parked (see the Settings toggle) — while off, there's no
  // activity data being collected, so the Progetti/Attività switcher itself
  // is hidden rather than offering a mode that would only ever show empty
  // charts. The caller's metric state is left alone (still "project"); it
  // just can never become "activity" via this control while hidden.
  activityEnabled?: boolean;
};

export function DashboardCardControls({
  metric,
  onMetricChange,
  filterId = null,
  onFilterChange,
  projects,
  activityTypes,
  filterMode = "all",
  activityEnabled = true,
}: DashboardCardControlsProps) {
  const options = metric === "project" ? projects : activityTypes;

  function handleMetricChange(next: BreakdownMetric) {
    if (next !== metric) {
      onMetricChange(next);
      // A project id and an activity id aren't the same thing — carrying a
      // stale one across the switch would silently filter by the wrong
      // entity (or one that doesn't exist for the new metric at all).
      onFilterChange?.(null);
    }
  }

  return (
    <div className="card-controls">
      {activityEnabled && (
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
      )}
      {filterMode !== "none" && (
        <select
          className="card-filter-select"
          aria-label={metric === "project" ? "Filtra per progetto" : "Filtra per attività"}
          value={filterId ?? "all"}
          onChange={(event) =>
            onFilterChange?.(event.target.value === "all" ? null : Number(event.target.value))
          }
        >
          {filterMode === "all" && (
            <option value="all">{metric === "project" ? "Tutti i progetti" : "Tutte le attività"}</option>
          )}
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
