import { useEffect, useMemo, useState } from "react";
import { formatHoursMinutes } from "../../lib/format";
import { getDayDetail } from "../../lib/tauri";
import type { ProjectDto, SegmentDto } from "../../lib/types";
import { assignCategoricalColors, OTHER_COLOR } from "./categoricalPalette";
import { TooltipTrigger } from "./TooltipTrigger";

const DAY_MINUTES = 24 * 60;

export function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function isToday(date: Date) {
  return isoDate(date) === isoDate(new Date());
}

export function formatDayLabel(date: Date) {
  if (isToday(date)) {
    return "Oggi";
  }
  return date.toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" });
}

function formatTimeOfDay(iso: string) {
  const date = new Date(iso);
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

function formatMinutesOfDay(totalMinutes: number) {
  const rounded = Math.round(totalMinutes);
  const hours = Math.floor(rounded / 60).toString().padStart(2, "0");
  const minutes = (rounded % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

type Block = {
  key: number;
  segment: SegmentDto;
  startMinutes: number;
  endMinutes: number;
  color: string;
};

type LegendEntry = {
  id: number;
  name: string;
  color: string;
  totalSeconds: number;
  ranges: { startLabel: string; endLabel: string; durationSeconds: number }[];
};

type DailyTimelineProps = {
  date: Date;
  projects: ProjectDto[];
};

// A sequence of project sessions across one day, positioned by real
// time-of-day rather than ranked by value — the question this answers is
// "what was I on, and when", not "what got the most time" (that's already
// covered by Ripartizione/Classifica). Deliberately project-only (no
// activity switcher): a day is walked chronologically, and mixing two
// unrelated dimensions into one axis would just be two overlapping stories.
// Day navigation lives in the caller's card header, not here — this
// component just renders whatever `date` it's given.
export function DailyTimeline({ date, projects }: DailyTimelineProps) {
  const [segments, setSegments] = useState<SegmentDto[]>([]);

  useEffect(() => {
    let cancelled = false;
    getDayDetail(isoDate(date)).then((result) => {
      if (!cancelled) {
        setSegments(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [date]);

  const projectColors = useMemo(
    () => assignCategoricalColors(projects.map((project) => project.id)),
    [projects],
  );

  // Same project can appear in several blocks across the day (switch away,
  // switch back) — both tooltips' "totale in giornata" sum every one of
  // them, not just a single block's own duration.
  const dailyTotalsByProject = useMemo(() => {
    const totals = new Map<number, number>();
    for (const segment of segments) {
      if (!segment.project) {
        continue;
      }
      totals.set(
        segment.project.id,
        (totals.get(segment.project.id) ?? 0) + segment.durationSeconds,
      );
    }
    return totals;
  }, [segments]);

  const blocks = useMemo<Block[]>(() => {
    return segments
      .filter((segment) => segment.durationSeconds > 0)
      .map((segment, index) => {
        const start = new Date(segment.startedAt);
        const startMinutes = start.getHours() * 60 + start.getMinutes() + start.getSeconds() / 60;
        const endMinutes = Math.min(startMinutes + segment.durationSeconds / 60, DAY_MINUTES);
        const color = segment.project
          ? projectColors.get(segment.project.id) ?? OTHER_COLOR
          : OTHER_COLOR;
        return { key: index, segment, startMinutes, endMinutes, color };
      });
  }, [segments, projectColors]);

  // A fixed 00:00-24:00 axis squeezed a few real hours of work into a sliver
  // in the middle of an otherwise empty bar. Scoping the axis to the actual
  // first-start/last-end of the day both starts it exactly where the day's
  // first recorded time was (as asked) and makes every block wide enough to
  // read.
  const range = useMemo(() => {
    if (blocks.length === 0) {
      return null;
    }
    let start = Infinity;
    let end = -Infinity;
    for (const block of blocks) {
      start = Math.min(start, block.startMinutes);
      end = Math.max(end, block.endMinutes);
    }
    return { start, end: Math.max(end, start + 1) };
  }, [blocks]);

  const axisTicks = useMemo(() => {
    if (!range) {
      return [];
    }
    const span = range.end - range.start;
    return [0, 0.25, 0.5, 0.75, 1].map((fraction) => range.start + fraction * span);
  }, [range]);

  const legend = useMemo<LegendEntry[]>(() => {
    const seen = new Map<number, LegendEntry>();
    for (const block of blocks) {
      const project = block.segment.project;
      if (!project) {
        continue;
      }
      if (!seen.has(project.id)) {
        seen.set(project.id, {
          id: project.id,
          name: project.name,
          color: block.color,
          totalSeconds: dailyTotalsByProject.get(project.id) ?? 0,
          ranges: [],
        });
      }
      seen.get(project.id)!.ranges.push({
        startLabel: formatTimeOfDay(block.segment.startedAt),
        endLabel: block.segment.endedAt ? formatTimeOfDay(block.segment.endedAt) : "ora",
        durationSeconds: block.segment.durationSeconds,
      });
    }
    return Array.from(seen.values());
  }, [blocks, dailyTotalsByProject]);

  if (!range) {
    return <p className="dashboard-empty">Nessun dato per questo giorno.</p>;
  }

  const span = range.end - range.start;

  return (
    <div className="daily-timeline">
      <div className="daily-timeline-track">
        {blocks.map((block) => {
          const projectName = block.segment.project?.name ?? "Nessun progetto";
          const startLabel = formatTimeOfDay(block.segment.startedAt);
          const endLabel = block.segment.endedAt ? formatTimeOfDay(block.segment.endedAt) : "ora";
          const dailyTotal = block.segment.project
            ? dailyTotalsByProject.get(block.segment.project.id) ?? 0
            : block.segment.durationSeconds;

          return (
            <TooltipTrigger
              key={block.key}
              className="daily-timeline-block"
              style={{
                left: `${((block.startMinutes - range.start) / span) * 100}%`,
                width: `${((block.endMinutes - block.startMinutes) / span) * 100}%`,
                background: block.color,
              }}
              ariaLabel={`${projectName}: ${startLabel} – ${endLabel}, ${formatHoursMinutes(block.segment.durationSeconds)}`}
              renderTooltip={() => (
                <div className="cell-tooltip" role="tooltip">
                  <strong>{projectName}</strong>
                  <span className="cell-tooltip-total">
                    {startLabel} – {endLabel} · {formatHoursMinutes(block.segment.durationSeconds)}
                  </span>
                  <p className="cell-tooltip-empty">
                    Totale in giornata: {formatHoursMinutes(dailyTotal)}
                  </p>
                </div>
              )}
            />
          );
        })}
      </div>
      <div className="daily-timeline-axis">
        {axisTicks.map((minutes, index) => (
          <span key={index}>{formatMinutesOfDay(minutes)}</span>
        ))}
      </div>
      {legend.length > 0 && (
        <ul
          className="breakdown-legend daily-timeline-legend"
          style={{ gridTemplateColumns: `repeat(${Math.min(legend.length, 5)}, 1fr)` }}
        >
          {legend.map((entry) => (
            <li key={entry.id}>
              <TooltipTrigger
                className="daily-timeline-legend-trigger"
                ariaLabel={`${entry.name}: dettaglio sessioni della giornata`}
                renderTooltip={() => (
                  <div className="cell-tooltip" role="tooltip">
                    <strong>{entry.name}</strong>
                    <ul>
                      {entry.ranges.map((sessionRange, index) => (
                        <li key={index}>
                          <span>
                            {sessionRange.startLabel} – {sessionRange.endLabel}
                          </span>
                          <span>{formatHoursMinutes(sessionRange.durationSeconds)}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="cell-tooltip-empty">
                      Totale in giornata: {formatHoursMinutes(entry.totalSeconds)}
                    </p>
                  </div>
                )}
              >
                <span className="breakdown-swatch" style={{ background: entry.color }} />
                <span className="breakdown-legend-name">{entry.name}</span>
              </TooltipTrigger>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
