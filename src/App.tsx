import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { IconHome, IconPause, IconPlay, IconSwitch, IconTag } from "./components/icons";
import { useElapsedSeconds } from "./lib/events";
import { formatElapsed } from "./lib/format";
import { useTrackingState } from "./lib/TrackingContext";
import { getActivityDetectionEnabled, openHomeWindow, pauseTracking, resumeTracking } from "./lib/tauri";
import { ActivityPicker } from "./widget/ActivityPicker";
import { ProjectPicker } from "./widget/ProjectPicker";
import { useHoverExpand, useHoverIntent } from "./widget/useHoverExpand";
import type { WidgetHoverState } from "./widget/useHoverExpand";
import { clampToScreen, dockToSavedCorner } from "./widget/widgetPosition";

const COLLAPSED_HEIGHT = 48;
const MIN_COLLAPSED_WIDTH = 90;
const MAX_COLLAPSED_WIDTH = 300;
const WIDGET_PADDING = 7;
const SWITCH_ICON_SIZE = 18;

// Tuned for the layout with the activity chip visible; with it hidden
// (activity detection off), the window shrinks by the chip's own measured
// footprint — see the measureChipRef sizing effect below — rather than
// leaving a fixed gap of dead space that the column's justify-content:
// center would otherwise split evenly above and below the remaining rows.
// +8 over the rows' own content height accounts for .drag-zone's wider
// row-gap (see styles.css), which pushes the name row below the corner
// timer's box — without the extra height, that push would come out of the
// activity chip/action buttons' space instead, clipping them.
const EXPANDED_HEIGHT = 140;
// .activity-chip's margin-top (-6px) eats back 6 of the .widget flex gap's
// 8px, netting a 2px gap above it — the only piece of its footprint that
// isn't part of its own measured box.
const CHIP_GAP_ABOVE = 2;
const EXPANDED_MIN_WIDTH = MAX_COLLAPSED_WIDTH;
const EXPANDED_MAX_WIDTH = 420;
const EXPANDED_PADDING = 12;
const INLINE_SWITCH_WIDTH = 24;
const NAME_ROW_GAP = 4;
// Project names are short by convention (enforced when naming them in the
// Projects tab), so the window only ever needs to grow up to this many
// characters' worth of width — anything longer (including the "no project
// detected" fallback message, which runs well past this on its own) gets
// ellipsized instead of pushing the pill wider indefinitely. Kept lower than
// it looks like it needs to be (was 20) so the expanded pill's inline-switch
// button has room to sit comfortably next to the name rather than pushing
// right up against the corner timer.
const MAX_NAME_CHARS = 15;

const PICKER_SIZE = { width: MAX_COLLAPSED_WIDTH, height: 320 };

type OpenPicker = "project" | "activity" | null;

export function App() {
  const state = useTrackingState();
  const elapsed = useElapsedSeconds(
    state?.segmentStartedAt,
    state?.isPaused ?? false,
    state?.todaySecondsBeforeSegment ?? 0,
  );
  const [openPicker, setOpenPicker] = useState<OpenPicker>(null);
  const [hoverState, setHoverState] = useState<WidgetHoverState>("idle");
  const [isDocked, setIsDocked] = useState(false);
  const [collapsedWidth, setCollapsedWidth] = useState(MIN_COLLAPSED_WIDTH);
  const [expandedWidth, setExpandedWidth] = useState(EXPANDED_MIN_WIDTH);
  const [expandedHeight, setExpandedHeight] = useState(EXPANDED_HEIGHT);
  const [nameWidth, setNameWidth] = useState<number | undefined>(undefined);
  const measureNameRef = useRef<HTMLElement>(null);
  const measureTimeRef = useRef<HTMLTimeElement>(null);
  const measureChipRef = useRef<HTMLSpanElement>(null);
  // Activities are parked (see Settings) — default to hidden rather than
  // flashing the chip on for the instant before this resolves, since off is
  // the common case right now.
  const [activityEnabled, setActivityEnabled] = useState(false);

  useEffect(() => {
    getActivityDetectionEnabled().then(setActivityEnabled);
  }, []);

  const isPaused = state?.isPaused ?? false;
  const isIdle = state?.isIdle ?? false;
  const hasProject = state?.project != null;
  // Priority, most to least specific: paused (gray) always wins; then idle
  // (red) — the system's been untouched long enough that the backend already
  // stopped crediting time to it (see IDLE_THRESHOLD_SECS in
  // detector/mod.rs); then "no project" (red too, different label) —
  // including right at startup, before anything has been detected yet, which
  // used to read as green even though nothing was actually being tracked;
  // then a manually-picked project (orange), a deliberate choice the
  // auto-detector won't silently override (see the Source::Manual branch in
  // detector/mod.rs's tick()); otherwise auto-detected and active (green,
  // plain .status-dot).
  const statusDotClass = isPaused
    ? "status-dot paused"
    : isIdle || !hasProject
      ? "status-dot none"
      : state?.source === "manual"
        ? "status-dot manual"
        : "status-dot";
  const rawProjectName = isIdle
    ? "Nessuna attività"
    : (state?.project?.name ?? "Nessun progetto rilevato");
  const projectName =
    rawProjectName.length > MAX_NAME_CHARS
      ? `${rawProjectName.slice(0, MAX_NAME_CHARS)}…`
      : rawProjectName;
  const activityName = state?.activityType?.name ?? "Nessuna attività";
  const hasTimer = !isIdle && Boolean(state?.project || state?.activityType);

  // Sizes the collapsed pill to fit its content exactly rather than guessing
  // a chrome-width constant (past attempts at that under- and over-shot,
  // leaving either a clipped button or dead space in the pill). The name and
  // timer are measured directly via plain hidden clones — not inside a
  // cloned copy of the drag-zone grid — because the grid's own column
  // sizing (`minmax(0, max-content)` competing with `justify-content:
  // center`) turned out to sometimes resolve a track a few pixels narrower
  // than an isolated measurement of the same content, even with room to
  // spare. Building the row width additively from these isolated
  // measurements plus the layout's known fixed pieces (dot, gaps, padding)
  // sidesteps that grid-sizing ambiguity entirely, and the name element
  // below gets its measured width applied directly for the same reason: at
  // its exact natural width, its content can't overflow its own box, so
  // text-overflow: ellipsis never has anything to trigger on.
  useLayoutEffect(() => {
    const DOT_WIDTH = 8;
    const COLUMN_GAP = 8;
    const DRAG_ZONE_PADDING_LEFT = 9;
    const TIME_MARGIN_RIGHT = 8;

    // getBoundingClientRect (not scrollWidth, which rounds to an integer)
    // and Math.ceil, plus a small fixed margin: this app's WebView2 engine
    // still renders an explicitly-sized element a couple of pixels narrower
    // than this same measurement in some cases.
    const nw = Math.ceil(measureNameRef.current?.getBoundingClientRect().width ?? 0) + 4;
    setNameWidth(nw);

    const timeWidth = hasTimer
      ? Math.ceil(measureTimeRef.current?.getBoundingClientRect().width ?? 0)
      : 0;
    const contentWidth =
      DRAG_ZONE_PADDING_LEFT +
      DOT_WIDTH +
      COLUMN_GAP +
      nw +
      (hasTimer ? COLUMN_GAP + timeWidth + TIME_MARGIN_RIGHT : 0);

    const next = Math.min(
      MAX_COLLAPSED_WIDTH,
      Math.max(MIN_COLLAPSED_WIDTH, contentWidth + WIDGET_PADDING * 2),
    );
    setCollapsedWidth(next);

    // Expanded mode used to stay at a fixed width regardless of the name,
    // so a long one (the "Nessun progetto rilevato" fallback is the usual
    // culprit) had nowhere to go but to run into the switch button and the
    // corner timer instead of the window making room for it.
    const expandedContentWidth = nw + NAME_ROW_GAP + INLINE_SWITCH_WIDTH;
    const nextExpandedWidth = Math.min(
      EXPANDED_MAX_WIDTH,
      Math.max(EXPANDED_MIN_WIDTH, expandedContentWidth + EXPANDED_PADDING * 2),
    );
    setExpandedWidth(nextExpandedWidth);

    const chipHeight = activityEnabled
      ? 0
      : Math.ceil(measureChipRef.current?.getBoundingClientRect().height ?? 0) + CHIP_GAP_ABOVE;
    setExpandedHeight(EXPANDED_HEIGHT - chipHeight);
  }, [projectName, hasTimer, activityEnabled]);

  const expandedSize = useMemo(
    () => ({ width: expandedWidth, height: expandedHeight }),
    [expandedWidth, expandedHeight],
  );
  const collapsedSize = useMemo(
    () => ({ width: collapsedWidth, height: COLLAPSED_HEIGHT }),
    [collapsedWidth],
  );
  // Ctrl+hover ("expand") or an open picker bring the widget to full
  // visibility/interactivity; plain hover ("fade") does the opposite — see
  // the isFaded effect below.
  const isExpanded = openPicker !== null || hoverState === "expand";
  const isFaded = openPicker === null && hoverState === "fade";
  const targetSize = openPicker ? PICKER_SIZE : isExpanded ? expandedSize : collapsedSize;
  useHoverExpand(targetSize, isDocked);
  useHoverIntent(setHoverState);

  // The widget is always-on-top, so without this it would sit in front of
  // whatever the user is trying to click underneath it (a window's own
  // close button, a menu, ...) every time the cursor happens to pass over
  // it. Fully hiding it AND letting clicks fall through to the window below
  // is what makes that non-disruptive — CSS opacity alone would still eat
  // the click.
  useEffect(() => {
    void getCurrentWindow().setIgnoreCursorEvents(isFaded);
  }, [isFaded]);

  // Initial corner-docking must land before useHoverExpand starts computing
  // anchors from the window's current position — otherwise whichever effect
  // calls setPosition last wins the race, and hover-driven resizes end up
  // preserving the OS's default placement instead of the saved corner.
  //
  // The window itself starts hidden (tauri.conf.json `visible: false` on
  // "main") specifically so this effect can position it *before* it's ever
  // painted — showing it only in the `finally` below is what prevents the
  // old flash at the OS's default spawn position.
  useEffect(() => {
    let cancelled = false;
    dockToSavedCorner(MIN_COLLAPSED_WIDTH, COLLAPSED_HEIGHT)
      .then(() => clampToScreen())
      .catch((error) => console.error("Unable to dock widget to corner", error))
      .finally(() => {
        if (!cancelled) {
          setIsDocked(true);
          getCurrentWindow()
            .show()
            .catch((error) => console.error("Unable to show widget window", error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The widget's position is fixed and only changeable from the Home
  // window's settings now (no more free dragging) — this is what makes a
  // corner change picked there take effect immediately instead of only on
  // the widget's next launch.
  useEffect(() => {
    const unlistenPromise = listen("widget-corner-changed", () => {
      void dockToSavedCorner(collapsedSize.width, collapsedSize.height).then(() =>
        clampToScreen(),
      );
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [collapsedSize.width, collapsedSize.height]);

  function togglePause() {
    void (state?.isPaused ? resumeTracking() : pauseTracking());
  }

  const elapsedLabel = useMemo(() => formatElapsed(elapsed), [elapsed]);

  return (
    <main className={`widget${isExpanded ? " expanded" : ""}${isFaded ? " faded" : ""}`}>
      <div
        aria-hidden="true"
        style={{ position: "absolute", visibility: "hidden", pointerEvents: "none", whiteSpace: "nowrap" }}
      >
        <strong ref={measureNameRef}>{projectName}</strong>
        {hasTimer && <time ref={measureTimeRef}>00:00:00</time>}
        <span ref={measureChipRef} className="activity-chip">
          <IconTag size={11} />
          <span>{activityName}</span>
        </span>
      </div>

      <section className={isExpanded ? "drag-zone expanded" : "drag-zone"}>
        {isExpanded ? (
          <div className="label-row">
            <div className="label-left">
              <div className={statusDotClass} />
              <span className="label">
                {isPaused
                  ? "In pausa"
                  : isIdle
                    ? "Inattivo"
                    : state?.source === "manual"
                      ? "Manuale"
                      : "Automatico"}
              </span>
            </div>
            {hasTimer && <time>{elapsedLabel}</time>}
          </div>
        ) : (
          <div className={statusDotClass} />
        )}
        <div className={isExpanded ? "project-name-row flush" : "project-name-row"}>
          <strong style={{ width: nameWidth }}>{projectName}</strong>
          {isExpanded && (
            <button
              type="button"
              className="inline-switch"
              title="Cambia progetto"
              onClick={() => setOpenPicker((current) => (current === "project" ? null : "project"))}
            >
              <IconSwitch size={SWITCH_ICON_SIZE} />
            </button>
          )}
        </div>
        {!isExpanded && hasTimer && <time>{elapsedLabel}</time>}
      </section>

      {isExpanded && (
        <>
          {activityEnabled && (
            <button
              type="button"
              className="activity-chip"
              title="Cambia attività"
              onClick={() => setOpenPicker((current) => (current === "activity" ? null : "activity"))}
            >
              <IconTag size={11} />
              <span>{activityName}</span>
            </button>
          )}

          <nav className="actions" aria-label="Controlli timer">
            <button
              className="secondary"
              type="button"
              title="Apri Pulse"
              onClick={() => void openHomeWindow()}
            >
              <IconHome size={16} />
              <span>Home</span>
            </button>
            <button
              className="primary"
              type="button"
              title={isPaused ? "Riprendi timer" : "Pausa timer"}
              onClick={togglePause}
            >
              {isPaused ? <IconPlay size={14} /> : <IconPause size={14} />}
              <span>{isPaused ? "Riprendi" : "Pausa"}</span>
            </button>
          </nav>
        </>
      )}

      {openPicker === "project" && (
        <ProjectPicker
          activeProjectId={state?.project?.id ?? null}
          onClose={() => setOpenPicker(null)}
        />
      )}
      {openPicker === "activity" && (
        <ActivityPicker
          activeActivityId={state?.activityType?.id ?? null}
          onClose={() => setOpenPicker(null)}
        />
      )}
    </main>
  );
}
