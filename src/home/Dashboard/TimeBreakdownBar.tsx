import { formatHoursMinutes } from "../../lib/format";
import type { BreakdownEntry } from "../../lib/types";
import { BreakdownTooltip } from "./BreakdownTooltip";
import { OTHER_COLOR } from "./categoricalPalette";
import { TooltipTrigger } from "./TooltipTrigger";

const MAX_SLOTS = 8;

type Segment = { id: number; name: string; seconds: number; color: string };

type TimeBreakdownBarProps = {
  // All-time totals, any order — this component sorts, caps, and folds the
  // tail into "Altro" itself.
  entries: BreakdownEntry[];
  colorById: Map<number, string>;
  emptyLabel: string;
};

// Part-to-whole, so per the dataviz skill this is a horizontal stacked bar
// (not a pie/donut — the skill's form table doesn't offer one), with a
// legend since color here does identity work across ≥2 series.
export function TimeBreakdownBar({ entries, colorById, emptyLabel }: TimeBreakdownBarProps) {
  const total = entries.reduce((sum, entry) => sum + entry.seconds, 0);

  if (total <= 0) {
    return <p className="dashboard-empty">{emptyLabel}</p>;
  }

  const sorted = [...entries].sort((a, b) => b.seconds - a.seconds);
  const visible = sorted.slice(0, MAX_SLOTS);
  const rest = sorted.slice(MAX_SLOTS);
  const restSeconds = rest.reduce((sum, entry) => sum + entry.seconds, 0);

  const segments: Segment[] = visible.map((entry) => ({
    id: entry.id,
    name: entry.name,
    seconds: entry.seconds,
    color: colorById.get(entry.id) ?? OTHER_COLOR,
  }));
  if (restSeconds > 0) {
    segments.push({ id: -1, name: "Altro", seconds: restSeconds, color: OTHER_COLOR });
  }

  return (
    <div className="breakdown">
      <div className="breakdown-bar">
        {segments.map((segment) => (
          <TooltipTrigger
            key={segment.id}
            className="breakdown-segment"
            style={{ flex: `${segment.seconds} 0 0%`, background: segment.color }}
            ariaLabel={`${segment.name}: ${formatHoursMinutes(segment.seconds)}`}
            renderTooltip={() => (
              <BreakdownTooltip
                title={segment.name}
                totalSeconds={segment.seconds}
                entries={[{ id: segment.id, name: segment.name, color: segment.color, seconds: segment.seconds }]}
              />
            )}
          />
        ))}
      </div>
      {/* Column-major: reading top-to-bottom down the first column, then the
          second, follows the biggest-to-smallest order — the default
          row-major grid made the ranking zigzag left/right across rows,
          which read as unordered. */}
      <ul
        className="breakdown-legend"
        style={{
          gridAutoFlow: "column",
          gridTemplateRows: `repeat(${Math.ceil(segments.length / 2)}, auto)`,
        }}
      >
        {segments.map((segment) => (
          <li key={segment.id}>
            <span className="breakdown-swatch" style={{ background: segment.color }} />
            <span className="breakdown-legend-name">{segment.name}</span>
            <span className="breakdown-legend-value">
              {formatHoursMinutes(segment.seconds)} · {Math.round((segment.seconds / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
