import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useState } from "react";
import { formatHoursMinutes } from "../../lib/format";
import { getDayDetail } from "../../lib/tauri";
import type { ProjectDto, SegmentDto } from "../../lib/types";
import { projectColorMap } from "../../lib/projectColors";
import { OTHER_COLOR } from "./categoricalPalette";
import { TimeEntryEditor, type TimeEntryDraft } from "./TimeEntryEditor";
import { TooltipTrigger } from "./TooltipTrigger";

const DAY_MINUTES = 24 * 60;

// Blocks shorter than this are visual noise — hair-thin slivers that split
// an otherwise continuous session in two (typically accidental glances at
// the wrong window, recorded before the backend learned to absorb them; the
// customer's history still contains plenty). They're dropped from the track
// but their seconds still count in every total, which is computed from the
// raw segments. The still-open live segment is always kept, however young:
// hiding what the widget says is being tracked right now would read as a bug.
const MICRO_BLOCK_SECONDS = 60;

// Two same-project blocks separated by no more than this render as one
// continuous bar — the gap is either a hidden micro-block or a sub-minute
// tracking hiccup, and a hairline crack in the middle of a real session is
// exactly the artifact this component is trying to stop showing.
const MERGE_GAP_MINUTES = 1;

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

// Not 1:1 with SegmentDto: a block can be several same-project segments
// merged into one continuous bar (see MERGE_GAP_MINUTES), so it carries its
// own start/end/duration instead of a single segment reference.
type Block = {
  key: number;
  /** Every segment folded into this block — what an edit replaces. */
  ids: number[];
  projectId: number | null;
  projectName: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  startMinutes: number;
  endMinutes: number;
  color: string;
};

// Sessions synced from another PC come with negative ids and are read-only
// here — they belong to that PC's history.
function isEditable(block: Block) {
  return block.endedAt !== null && block.ids.every((id) => id > 0);
}

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
  // The dashboard's project filter: other projects' blocks stay visible for
  // context (when did I switch away) but fade back.
  focusProjectId?: number | null;
};

// A sequence of project sessions across one day, positioned by real
// time-of-day rather than ranked by value — the question this answers is
// "what was I on, and when", not "what got the most time" (that's already
// covered by Ripartizione/Classifica). Deliberately project-only (no
// activity switcher): a day is walked chronologically, and mixing two
// unrelated dimensions into one axis would just be two overlapping stories.
// Day navigation lives in the caller's card header, not here — this
// component just renders whatever `date` it's given.
export function DailyTimeline({ date, projects, focusProjectId = null }: DailyTimelineProps) {
  const [segments, setSegments] = useState<SegmentDto[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState<TimeEntryDraft | null>(null);

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
  }, [date, reloadKey]);

  // A manual edit (here or anywhere else) changes this day's segments.
  useEffect(() => {
    const unlistenPromise = listen("history-changed", () => setReloadKey((key) => key + 1));
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  function openNewEntry() {
    let startMinutes = 9 * 60;
    if (isToday(date)) {
      const now = new Date();
      const endMinutes = Math.floor((now.getHours() * 60 + now.getMinutes()) / 5) * 5;
      startMinutes = Math.max(0, endMinutes - 60);
      setEditing({
        ids: [],
        projectId: null,
        start: formatMinutesOfDay(startMinutes),
        end: formatMinutesOfDay(Math.max(endMinutes, startMinutes + 5)),
      });
      return;
    }
    setEditing({ ids: [], projectId: null, start: "09:00", end: "10:00" });
  }

  const editor = editing && (
    <TimeEntryEditor date={date} draft={editing} projects={projects} onClose={() => setEditing(null)} />
  );
  const addButton = (
    <div className="daily-timeline-footer">
      <button type="button" className="timeline-add-button" onClick={openNewEntry}>
        + Aggiungi sessione
      </button>
    </div>
  );

  // Same stored-color-first resolution as every other chart and the Progetti
  // tab's swatches (see projectColorMap) — the timeline recolors live when
  // the user randomizes colors, via the catalog-changed refetch upstream.
  const projectColors = useMemo(() => projectColorMap(projects), [projects]);

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
    const raw = segments
      .filter((segment) => segment.durationSeconds > 0)
      .map((segment, index): Block => {
        const start = new Date(segment.startedAt);
        const startMinutes = start.getHours() * 60 + start.getMinutes() + start.getSeconds() / 60;
        // Wall-clock span when the segment is closed: compacted history
        // (db::compact_history) folds back-to-back segments into one row
        // whose duration is their sum, so start + duration would end the
        // block a few seconds early.
        const spanSeconds = segment.endedAt
          ? Math.max(
              segment.durationSeconds,
              (new Date(segment.endedAt).getTime() - start.getTime()) / 1000,
            )
          : segment.durationSeconds;
        const endMinutes = Math.min(startMinutes + spanSeconds / 60, DAY_MINUTES);
        const color = segment.project
          ? projectColors.get(segment.project.id) ?? OTHER_COLOR
          : OTHER_COLOR;
        return {
          key: index,
          ids: [segment.id],
          projectId: segment.project?.id ?? null,
          projectName: segment.project?.name ?? "Nessun progetto",
          startedAt: segment.startedAt,
          endedAt: segment.endedAt,
          durationSeconds: segment.durationSeconds,
          startMinutes,
          endMinutes,
          color,
        };
      });

    const visible = raw.filter(
      (block) => block.durationSeconds >= MICRO_BLOCK_SECONDS || block.endedAt === null,
    );
    // A day made up entirely of micro-blocks (tracking started moments ago,
    // or a historical day totalling under a minute) still deserves a track
    // over "Nessun dato" next to a non-zero daily total.
    const kept = visible.length > 0 ? visible : raw;

    const merged: Block[] = [];
    for (const block of kept) {
      const previous = merged[merged.length - 1];
      if (
        previous &&
        previous.projectId === block.projectId &&
        block.startMinutes - previous.endMinutes <= MERGE_GAP_MINUTES
      ) {
        previous.endMinutes = Math.max(previous.endMinutes, block.endMinutes);
        previous.durationSeconds += block.durationSeconds;
        previous.endedAt = block.endedAt;
        previous.ids.push(...block.ids);
        continue;
      }
      merged.push({ ...block, ids: [...block.ids] });
    }
    return merged;
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
      if (block.projectId === null) {
        continue;
      }
      if (!seen.has(block.projectId)) {
        seen.set(block.projectId, {
          id: block.projectId,
          name: block.projectName,
          color: block.color,
          totalSeconds: dailyTotalsByProject.get(block.projectId) ?? 0,
          ranges: [],
        });
      }
      seen.get(block.projectId)!.ranges.push({
        startLabel: formatTimeOfDay(block.startedAt),
        endLabel: block.endedAt ? formatTimeOfDay(block.endedAt) : "ora",
        durationSeconds: block.durationSeconds,
      });
    }
    return Array.from(seen.values());
  }, [blocks, dailyTotalsByProject]);

  if (!range) {
    return (
      <>
        <p className="dashboard-empty">Nessun dato per questo giorno.</p>
        {addButton}
        {editor}
      </>
    );
  }

  const span = range.end - range.start;

  return (
    <div className="daily-timeline">
      <div className="daily-timeline-track">
        {blocks.map((block) => {
          const startLabel = formatTimeOfDay(block.startedAt);
          const endLabel = block.endedAt ? formatTimeOfDay(block.endedAt) : "ora";
          const dailyTotal =
            block.projectId !== null
              ? dailyTotalsByProject.get(block.projectId) ?? 0
              : block.durationSeconds;

          return (
            <TooltipTrigger
              key={block.key}
              className={[
                "daily-timeline-block",
                isEditable(block) && "editable",
                focusProjectId !== null && block.projectId !== focusProjectId && "dimmed",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={
                !isEditable(block)
                  ? undefined
                  : () =>
                      setEditing({
                        ids: block.ids,
                        projectId: block.projectId,
                        start: formatTimeOfDay(block.startedAt),
                        end: formatTimeOfDay(block.endedAt!),
                      })
              }
              style={{
                left: `${((block.startMinutes - range.start) / span) * 100}%`,
                width: `${((block.endMinutes - block.startMinutes) / span) * 100}%`,
                background: block.color,
              }}
              ariaLabel={`${block.projectName}: ${startLabel} – ${endLabel}, ${formatHoursMinutes(block.durationSeconds)}`}
              renderTooltip={() => (
                <div className="cell-tooltip" role="tooltip">
                  <strong>{block.projectName}</strong>
                  <span className="cell-tooltip-total">
                    {startLabel} – {endLabel} · {formatHoursMinutes(block.durationSeconds)}
                  </span>
                  <p className="cell-tooltip-empty">
                    Totale in giornata: {formatHoursMinutes(dailyTotal)}
                  </p>
                  <p className="cell-tooltip-empty">
                    {block.endedAt === null
                      ? "Sessione in corso"
                      : isEditable(block)
                        ? "Clicca per modificare"
                        : "Registrata sull'altro PC"}
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
            <li
              key={entry.id}
              className={focusProjectId !== null && entry.id !== focusProjectId ? "dimmed" : undefined}
            >
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
      {addButton}
      {editor}
    </div>
  );
}
