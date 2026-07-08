import { formatHoursMinutes } from "../../lib/format";
import type { BreakdownEntry } from "../../lib/types";

type BreakdownTooltipProps = {
  title: string;
  totalSeconds: number;
  entries: BreakdownEntry[];
};

export function BreakdownTooltip({ title, totalSeconds, entries }: BreakdownTooltipProps) {
  return (
    <div className="cell-tooltip" role="tooltip">
      <strong>{title}</strong>
      <span className="cell-tooltip-total">{formatHoursMinutes(totalSeconds)}</span>
      {entries.length > 0 ? (
        <ul>
          {entries.slice(0, 6).map((entry) => (
            <li key={entry.id}>
              <span title={entry.name}>{entry.name}</span>
              <span>{formatHoursMinutes(entry.seconds)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="cell-tooltip-empty">Nessun dato</p>
      )}
    </div>
  );
}
