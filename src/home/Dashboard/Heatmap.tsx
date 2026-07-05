import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent, UIEvent } from "react";
import { formatDateIt, formatHoursMinutes } from "../../lib/format";
import type { BreakdownEntry, BreakdownMetric, DayBucket } from "../../lib/types";
import { BreakdownTooltip } from "./BreakdownTooltip";
import { TooltipTrigger } from "./TooltipTrigger";

// When a specific project/activity is selected (filterId), the cell should
// reflect only its share of the day instead of the day's grand total —
// same idea for the single-entry tooltip breakdown.
function filteredTotal(entries: BreakdownEntry[], filterId: number | null, fallback: number) {
  if (filterId === null) {
    return { totalSeconds: fallback, entries };
  }
  const match = entries.find((entry) => entry.id === filterId);
  return { totalSeconds: match?.seconds ?? 0, entries: match ? [match] : [] };
}

// How many calendar months to show, ending at (and including) the current
// one — never further ahead. Since this is recomputed from the real
// "today" on every load, the window shifts forward on its own: open the
// dashboard on August 1st and August is simply there as the new last month,
// no future months rendered ahead of time.
export const MONTHS_BACK = 10;
const CELL_SIZE = 20;
const CELL_GAP = 4;
const MONTH_GAP = 30;
const DAY_LABELS = ["L", "M", "M", "G", "V", "S", "D"];
export const MONTH_LABELS_IT = [
  "Gennaio",
  "Febbraio",
  "Marzo",
  "Aprile",
  "Maggio",
  "Giugno",
  "Luglio",
  "Agosto",
  "Settembre",
  "Ottobre",
  "Novembre",
  "Dicembre",
];

// Bucket 0 is the neutral "no data" gray (chart chrome gridline token), kept
// outside the ramp on purpose. Buckets 1-4 are a validated one-hue sequential
// ramp (reference palette steps 250/400/550/700 — see dataviz skill; the
// lightest step is pinned to 250 because the ordinal floor requires ≥2:1
// contrast against the chart surface, which step 150/100 fail).
// Exported so MonthlySummary can reuse the same ramp for a consistent read
// across both charts.
export const BUCKET_COLORS = ["#e1e0d9", "#86b6ef", "#3987e5", "#1c5cab", "#0d366b"];

function isoDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function bucketIndex(totalSeconds: number) {
  if (totalSeconds <= 0) {
    return 0;
  }
  const hours = totalSeconds / 3600;
  if (hours < 1) {
    return 1;
  }
  if (hours < 3) {
    return 2;
  }
  if (hours < 5) {
    return 3;
  }
  return 4;
}

type MonthCell = { date: Date | null; blank: boolean };

type MonthBlock = {
  year: number;
  month: number;
  columns: MonthCell[][];
};

// Builds one calendar month as its own self-contained grid: column 0 starts
// with blank filler cells up to day 1's real weekday (so e.g. a month
// starting on a Wednesday leaves Mon/Tue of its first column empty), and the
// last column is blank-padded after the month's last day. This is what
// makes month width vary (4, 5, sometimes 6 columns) matching the actual
// calendar, instead of a continuous rolling set of Monday-aligned weeks that
// don't respect month boundaries (which was the "4x7 vs 5x7 that don't line
// up with the real calendar" bug).
function buildMonthBlock(year: number, month: number): MonthBlock {
  const firstWeekday = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7; // 0 = Monday
  const numDays = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const numColumns = Math.ceil((firstWeekday + numDays) / 7);

  const columns: MonthCell[][] = [];
  for (let col = 0; col < numColumns; col++) {
    const rows: MonthCell[] = [];
    for (let row = 0; row < 7; row++) {
      const dayIndex = col * 7 + row - firstWeekday;
      if (dayIndex < 0 || dayIndex >= numDays) {
        rows.push({ date: null, blank: true });
      } else {
        rows.push({ date: new Date(Date.UTC(year, month, dayIndex + 1)), blank: false });
      }
    }
    columns.push(rows);
  }
  return { year, month, columns };
}

function buildMonthBlocks(today: Date) {
  const blocks: MonthBlock[] = [];
  for (let i = MONTHS_BACK - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
    blocks.push(buildMonthBlock(d.getUTCFullYear(), d.getUTCMonth()));
  }
  return blocks;
}

function blockWidth(block: MonthBlock) {
  return block.columns.length * CELL_SIZE + (block.columns.length - 1) * CELL_GAP;
}

type HeatmapGridProps = {
  blocks: MonthBlock[];
  bucketByDate: Map<string, DayBucket>;
  metric: BreakdownMetric;
  filterId: number | null;
};

// Split out and memoized: this is the expensive part (~400 cells across
// MONTHS_BACK months). The parent re-renders on every scroll tick (to move
// the year corner and the scrollbar thumb) and on drag start/end — without
// memoizing this out, each of those re-renders was reconciling the entire
// grid too, which is what made the pan and the release freeze/stutter.
const HeatmapGrid = memo(function HeatmapGrid({
  blocks,
  bucketByDate,
  metric,
  filterId,
}: HeatmapGridProps) {
  return (
    <>
      <div className="heatmap-months">
        {blocks.map((block, index) => (
          <span
            key={index}
            className="heatmap-month-label"
            style={{ flex: `0 0 ${blockWidth(block)}px`, marginLeft: index > 0 ? MONTH_GAP : 0 }}
          >
            {MONTH_LABELS_IT[block.month]}
          </span>
        ))}
      </div>
      <div className="heatmap-grid">
        {blocks.map((block, blockIndex) =>
          block.columns.map((column, columnIndex) => (
            <div
              className="heatmap-week"
              style={columnIndex === 0 && blockIndex > 0 ? { marginLeft: MONTH_GAP } : undefined}
              key={`${blockIndex}-${columnIndex}`}
            >
              {column.map((cell, rowIndex) => {
                // Only true calendar padding (before day 1 / after the
                // month's last day) is hidden — a not-yet-happened day
                // within the current month still renders as a normal
                // "no data" cell, so the month reads as whole instead of
                // cutting off at today.
                if (cell.blank) {
                  return <div className="heatmap-cell future" key={rowIndex} aria-hidden="true" />;
                }

                const dateKey = isoDateKey(cell.date as Date);
                const bucket = bucketByDate.get(dateKey);
                const rawEntries = metric === "project" ? bucket?.byProject ?? [] : bucket?.byActivity ?? [];
                const { totalSeconds, entries } = filteredTotal(
                  rawEntries,
                  filterId,
                  bucket?.totalSeconds ?? 0,
                );

                return (
                  <TooltipTrigger
                    key={dateKey}
                    className="heatmap-cell"
                    style={{ background: BUCKET_COLORS[bucketIndex(totalSeconds)] }}
                    ariaLabel={`${formatDateIt(dateKey)}: ${formatHoursMinutes(totalSeconds)}`}
                    renderTooltip={() => (
                      <BreakdownTooltip
                        title={formatDateIt(dateKey)}
                        totalSeconds={totalSeconds}
                        entries={entries}
                      />
                    )}
                  />
                );
              })}
            </div>
          )),
        )}
      </div>
    </>
  );
});

type HeatmapProps = {
  buckets: DayBucket[];
  metric: BreakdownMetric;
  filterId: number | null;
};

export function Heatmap({ buckets, metric, filterId }: HeatmapProps) {
  const bucketByDate = useMemo(() => {
    const map = new Map<string, DayBucket>();
    for (const bucket of buckets) {
      map.set(bucket.date, bucket);
    }
    return map;
  }, [buckets]);

  const blocks = useMemo(() => buildMonthBlocks(new Date()), []);

  // Left-edge offset (px) of each month block, used to work out which one
  // sits under the frozen day/year column as the grid is scrolled — that
  // block's year is what the corner should display.
  const blockOffsets = useMemo(() => {
    let cumulative = 0;
    return blocks.map((block, index) => {
      if (index > 0) {
        cumulative += CELL_GAP + MONTH_GAP;
      }
      const offset = cumulative;
      cumulative += blockWidth(block);
      return { year: block.year, offset };
    });
  }, [blocks]);

  const [visibleYear, setVisibleYear] = useState(() => blocks[blocks.length - 1].year);

  function syncVisibleYear(scrollLeft: number) {
    let year = blockOffsets[0]?.year;
    for (const block of blockOffsets) {
      if (block.offset > scrollLeft + 1) {
        break;
      }
      year = block.year;
    }
    setVisibleYear((previous) => (previous === year ? previous : year));
  }

  const scrollRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startScrollLeft: number } | null>(
    null,
  );

  // Tracks pointer velocity (px/ms) over the last move, so a fast flick can
  // hand off to a short momentum glide on release instead of either stopping
  // dead (feels stuttery) or drifting indefinitely (hard to control).
  const velocityRef = useRef(0);
  const lastMoveRef = useRef<{ x: number; t: number } | null>(null);
  const momentumRef = useRef<number | null>(null);

  function stopMomentum() {
    if (momentumRef.current !== null) {
      cancelAnimationFrame(momentumRef.current);
      momentumRef.current = null;
    }
  }

  // Toggling this via classList (not React state) is deliberate: the
  // heaviest component in this tree, HeatmapGrid, is memoized precisely so
  // that state changes in this parent don't re-render it — routing "is a
  // drag in progress" through setState would have forced a re-render (and
  // thus a reconciliation pass over ~400 cells) on every drag start/end,
  // which is what was freezing the release.
  function setDragging(active: boolean) {
    scrollRef.current?.classList.toggle("dragging", active);
  }

  // Reflects scrollLeft/scrollWidth onto the minimal scrollbar thumb below
  // the grid, writing to the DOM directly (not React state) for the same
  // reason — this runs on every scroll/drag/momentum tick.
  function updateThumb() {
    const el = scrollRef.current;
    const thumb = thumbRef.current;
    if (!el || !thumb) {
      return;
    }
    const maxScroll = el.scrollWidth - el.clientWidth;
    if (maxScroll <= 0) {
      thumb.style.width = "100%";
      thumb.style.left = "0%";
      return;
    }
    const thumbPercent = (el.clientWidth / el.scrollWidth) * 100;
    const leftPercent = (el.scrollLeft / maxScroll) * (100 - thumbPercent);
    thumb.style.width = `${thumbPercent}%`;
    thumb.style.left = `${leftPercent}%`;
  }

  function startMomentum() {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    // Drag moves scrollLeft opposite to pointer travel (see
    // handlePointerMove), so the glide continues in that same direction.
    let scrollVelocity = -velocityRef.current;
    const FRICTION = 0.94;
    const MIN_VELOCITY = 0.02;
    if (Math.abs(scrollVelocity) < MIN_VELOCITY) {
      return;
    }
    function step() {
      const target = scrollRef.current;
      if (!target || Math.abs(scrollVelocity) < MIN_VELOCITY) {
        momentumRef.current = null;
        return;
      }
      const before = target.scrollLeft;
      target.scrollLeft = before + scrollVelocity * 16;
      updateThumb();
      if (target.scrollLeft === before) {
        // Hit the start or end of the scrollable range.
        momentumRef.current = null;
        return;
      }
      scrollVelocity *= FRICTION;
      momentumRef.current = requestAnimationFrame(step);
    }
    momentumRef.current = requestAnimationFrame(step);
  }

  // Most recent activity is the useful part — land the view there instead of
  // on the oldest (leftmost) month.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollLeft = el.scrollWidth;
      syncVisibleYear(el.scrollLeft);
      updateThumb();
    }
    return stopMomentum;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks]);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    // Re-grabbing mid-glide should stop it dead, not blend into a new drag.
    stopMomentum();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: el.scrollLeft,
    };
    lastMoveRef.current = { x: event.clientX, t: performance.now() };
    velocityRef.current = 0;
    setDragging(true);
    el.setPointerCapture(event.pointerId);
    // Stops WebView2 from also treating this as the start of its own native
    // momentum-panning gesture (see touch-action: none on .heatmap-scroll) —
    // without both, the view kept drifting after a fast flick-release
    // instead of stopping where the manual scrollLeft assignment left it.
    event.preventDefault();
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const el = scrollRef.current;
    const drag = dragRef.current;
    if (!el || !drag || drag.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();

    const now = performance.now();
    const last = lastMoveRef.current;
    if (last) {
      const dt = now - last.t;
      if (dt > 0) {
        velocityRef.current = (event.clientX - last.x) / dt;
      }
    }
    lastMoveRef.current = { x: event.clientX, t: now };

    el.scrollLeft = drag.startScrollLeft - (event.clientX - drag.startX);
    updateThumb();
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      setDragging(false);
      startMomentum();
    }
  }

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    syncVisibleYear(event.currentTarget.scrollLeft);
    updateThumb();
  }

  return (
    <div className="heatmap">
      {/* Frozen overlay: sits outside the scrolling flow entirely (absolute,
          not a sticky child of it) and is painted on top. Not depending on
          position: sticky inside a wide horizontally-scrolling flex row
          sidesteps a WebView2 quirk where the sticky column would
          intermittently drop out partway through a drag. */}
      <div className="heatmap-frozen">
        <span className="heatmap-year-corner">{visibleYear}</span>
        <div className="heatmap-day-labels">
          {DAY_LABELS.map((label, index) => (
            <span key={index}>{label}</span>
          ))}
        </div>
      </div>
      <div
        className="heatmap-scroll"
        ref={scrollRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onScroll={handleScroll}
      >
        <HeatmapGrid blocks={blocks} bucketByDate={bucketByDate} metric={metric} filterId={filterId} />
      </div>
      {/* WebView2's native scrollbar can't be restyled (see .heatmap-scroll),
          so this is a minimal custom stand-in — thumb size/position written
          directly to the DOM by updateThumb, not React state, since it needs
          to track scroll/drag/momentum on every tick. */}
      <div className="heatmap-scrollbar-track">
        <div className="heatmap-scrollbar-thumb" ref={thumbRef} />
      </div>
    </div>
  );
}
