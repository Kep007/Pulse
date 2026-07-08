import { useEffect, useMemo, useState } from "react";
import { IconChevron } from "../../components/icons";
import { formatHoursMinutes } from "../../lib/format";
import { getDayDetail } from "../../lib/tauri";
import type { ProjectDto, SegmentDto } from "../../lib/types";
import { assignCategoricalColors, OTHER_COLOR } from "./categoricalPalette";
import { TooltipTrigger } from "./TooltipTrigger";

const DAY_MINUTES = 24 * 60;
const AXIS_HOURS = [0, 6, 12, 18, 24];

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function isToday(date: Date) {
  return isoDate(date) === isoDate(new Date());
}

function formatTimeOfDay(iso: string) {
  const date = new Date(iso);
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

function formatDayLabel(date: Date) {
  if (isToday(date)) {
    return "Oggi";
  }
  return date.toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" });
}

type Block = {
  key: number;
  segment: SegmentDto;
  startMinutes: number;
  endMinutes: number;
  color: string;
};

type DailyTimelineProps = {
  projects: ProjectDto[];
};

// A sequence of project sessions across one day, positioned by real
// time-of-day rather than ranked by value — the question this answers is
// "what was I on, and when", not "what got the most time" (that's already
// covered by Ripartizione/Classifica). Deliberately project-only (no
// activity switcher): a day is walked chronologically, and mixing two
// unrelated dimensions into one axis would just be two overlapping stories.
export function DailyTimeline({ projects }: DailyTimelineProps) {
  const [date, setDate] = useState(() => new Date());
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
  // switch back) — the tooltip's "totale in giornata" sums every one of them,
  // not just the hovered block's own duration.
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

  const legend = useMemo(() => {
    const seen = new Map<number, { name: string; color: string }>();
    for (const block of blocks) {
      const project = block.segment.project;
      if (project && !seen.has(project.id)) {
        seen.set(project.id, { name: project.name, color: block.color });
      }
    }
    return Array.from(seen.entries()).map(([id, entry]) => ({ id, ...entry }));
  }, [blocks]);

  function shiftDay(deltaDays: number) {
    setDate((current) => {
      const next = new Date(current);
      next.setDate(next.getDate() + deltaDays);
      return next;
    });
  }

  return (
    <>
      <div className="timeline-day-nav">
        <button
          type="button"
          className="timeline-day-nav-button"
          onClick={() => shiftDay(-1)}
          aria-label="Giorno precedente"
        >
          <IconChevron size={14} className="timeline-chevron-left" />
        </button>
        <span className="timeline-day-label">{formatDayLabel(date)}</span>
        <button
          type="button"
          className="timeline-day-nav-button"
          onClick={() => shiftDay(1)}
          disabled={isToday(date)}
          aria-label="Giorno successivo"
        >
          <IconChevron size={14} className="timeline-chevron-right" />
        </button>
      </div>
      {blocks.length === 0 ? (
        <p className="dashboard-empty">Nessun dato per questo giorno.</p>
      ) : (
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
                    left: `${(block.startMinutes / DAY_MINUTES) * 100}%`,
                    width: `${((block.endMinutes - block.startMinutes) / DAY_MINUTES) * 100}%`,
                    background: block.color,
                  }}
                  ariaLabel={`${projectName}: ${startLabel}–${endLabel}, ${formatHoursMinutes(block.segment.durationSeconds)}`}
                  renderTooltip={() => (
                    <div className="cell-tooltip" role="tooltip">
                      <strong>{projectName}</strong>
                      <span className="cell-tooltip-total">
                        {startLabel}–{endLabel} · {formatHoursMinutes(block.segment.durationSeconds)}
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
            {AXIS_HOURS.map((hour) => (
              <span key={hour}>{hour.toString().padStart(2, "0")}:00</span>
            ))}
          </div>
          {legend.length > 0 && (
            <ul className="breakdown-legend daily-timeline-legend">
              {legend.map((entry) => (
                <li key={entry.id}>
                  <span className="breakdown-swatch" style={{ background: entry.color }} />
                  <span className="breakdown-legend-name">{entry.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
