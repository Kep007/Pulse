import { formatHoursMinutes } from "../../lib/format";
import type { DayBucket, MonthBucket } from "../../lib/types";
import { computeEntityStats } from "./timeAnalysis";

// Only projects worked on recently: old or one-off projects would crowd
// the list without answering "what weighs on my days now".
const RECENT_DAYS = 90;

type ProjectWeightProps = {
  dailyBuckets: DayBucket[];
  monthlyBuckets: MonthBucket[];
  colorById: Map<number, string>;
};

// "Which project takes over my days": for each project, how long a day on
// it usually lasts (5 minutes vs 3 hours) and how much of a month it takes.
export function ProjectWeight({ dailyBuckets, monthlyBuckets, colorById }: ProjectWeightProps) {
  const since = new Date();
  since.setDate(since.getDate() - RECENT_DAYS);
  const sinceIso = since.toISOString().slice(0, 10);

  const recent = new Map<number, { name: string; seconds: number; days: number }>();
  for (const bucket of dailyBuckets) {
    if (bucket.date < sinceIso) {
      continue;
    }
    for (const entry of bucket.byProject) {
      if (entry.seconds <= 0) {
        continue;
      }
      const row = recent.get(entry.id) ?? { name: entry.name, seconds: 0, days: 0 };
      row.seconds += entry.seconds;
      row.days += 1;
      recent.set(entry.id, row);
    }
  }

  const rows = [...recent.entries()]
    .map(([id, row]) => ({
      id,
      name: row.name,
      days: row.days,
      perDay: row.seconds / row.days,
      perMonth: computeEntityStats(dailyBuckets, monthlyBuckets, "project", id).avgSecondsPerMonth,
    }))
    .filter((row) => row.perDay >= 60)
    .sort((a, b) => b.perDay - a.perDay);

  if (rows.length === 0) {
    return <p className="dashboard-empty">Nessun progetto negli ultimi {RECENT_DAYS} giorni.</p>;
  }
  const max = rows[0].perDay;

  return (
    <div className="weight-table" role="table">
      <div className="weight-row weight-head" role="row">
        <span role="columnheader">Progetto</span>
        <span role="columnheader">Ore al giorno, quando ci lavori</span>
        <span role="columnheader">Media al mese</span>
      </div>
      {rows.map((row) => (
        <div key={row.id} className="weight-row" role="row">
          <span className="weight-name" role="cell">
            <span className="breakdown-swatch" style={{ background: colorById.get(row.id) }} />
            {row.name}
          </span>
          <span className="weight-bar-cell" role="cell">
            <span className="weight-bar">
              <span style={{ width: `${Math.max(3, (row.perDay / max) * 100)}%`, background: colorById.get(row.id) }} />
            </span>
            <span className="weight-value" title={`${row.days} giorni negli ultimi ${RECENT_DAYS}`}>
              {formatHoursMinutes(row.perDay)}
            </span>
          </span>
          <span className="weight-value" role="cell">
            {formatHoursMinutes(row.perMonth)}
          </span>
        </div>
      ))}
    </div>
  );
}
