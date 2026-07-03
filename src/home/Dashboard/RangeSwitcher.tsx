import type { BreakdownMetric } from "../../lib/types";

type RangeSwitcherProps = {
  metric: BreakdownMetric;
  onChange: (metric: BreakdownMetric) => void;
};

export function RangeSwitcher({ metric, onChange }: RangeSwitcherProps) {
  return (
    <div className="metric-switcher" role="tablist" aria-label="Ripartizione">
      <button
        type="button"
        role="tab"
        aria-selected={metric === "project"}
        className={metric === "project" ? "metric-tab active" : "metric-tab"}
        onClick={() => onChange("project")}
      >
        Progetti
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={metric === "activity"}
        className={metric === "activity" ? "metric-tab active" : "metric-tab"}
        onClick={() => onChange("activity")}
      >
        Attività
      </button>
    </div>
  );
}
