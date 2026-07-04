import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { IconHome, IconPause, IconPlay, IconSwitch, IconTag } from "./components/icons";
import { useElapsedSeconds } from "./lib/events";
import { formatElapsed } from "./lib/format";
import { useTrackingState } from "./lib/TrackingContext";
import { openHomeWindow, pauseTracking, resumeTracking } from "./lib/tauri";
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

const EXPANDED_SIZE = { width: MAX_COLLAPSED_WIDTH, height: 132 };
const PICKER_SIZE = { width: MAX_COLLAPSED_WIDTH, height: 320 };

type OpenPicker = "project" | "activity" | null;

export function App() {
  const state = useTrackingState();
  const elapsed = useElapsedSeconds(state?.segmentStartedAt, state?.isPaused ?? false);
  const [openPicker, setOpenPicker] = useState<OpenPicker>(null);
  const [hoverState, setHoverState] = useState<WidgetHoverState>("idle");
  const [isDocked, setIsDocked] = useState(false);
  const [collapsedWidth, setCollapsedWidth] = useState(MIN_COLLAPSED_WIDTH);
  const [nameWidth, setNameWidth] = useState<number | undefined>(undefined);
  const measureNameRef = useRef<HTMLElement>(null);
  const measureTimeRef = useRef<HTMLTimeElement>(null);

  const isPaused = state?.isPaused ?? false;
  const projectName = state?.project?.name ?? "Nessun progetto rilevato";
  const activityName = state?.activityType?.name ?? "Nessuna attività";
  const hasTimer = Boolean(state?.project || state?.activityType);

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
  }, [projectName, hasTimer]);

  const collapsedSize = useMemo(
    () => ({ width: collapsedWidth, height: COLLAPSED_HEIGHT }),
    [collapsedWidth],
  );
  // Ctrl+hover ("expand") or an open picker bring the widget to full
  // visibility/interactivity; plain hover ("fade") does the opposite — see
  // the isFaded effect below.
  const isExpanded = openPicker !== null || hoverState === "expand";
  const isFaded = openPicker === null && hoverState === "fade";
  const targetSize = openPicker ? PICKER_SIZE : isExpanded ? EXPANDED_SIZE : collapsedSize;
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
  useEffect(() => {
    let cancelled = false;
    dockToSavedCorner(MIN_COLLAPSED_WIDTH, COLLAPSED_HEIGHT)
      .then(() => clampToScreen())
      .catch((error) => console.error("Unable to dock widget to corner", error))
      .finally(() => {
        if (!cancelled) {
          setIsDocked(true);
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
      </div>

      <section className={isExpanded ? "drag-zone expanded" : "drag-zone"}>
        {isExpanded ? (
          <div className="label-row">
            <div className="label-left">
              <div className={isPaused ? "status-dot paused" : "status-dot"} />
              <span className="label">
                {isPaused ? "In pausa" : state?.source === "manual" ? "Manuale" : "Automatico"}
              </span>
            </div>
            {hasTimer && <time>{elapsedLabel}</time>}
          </div>
        ) : (
          <div className={isPaused ? "status-dot paused" : "status-dot"} />
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
          <button
            type="button"
            className="activity-chip"
            title="Cambia attività"
            onClick={() => setOpenPicker((current) => (current === "activity" ? null : "activity"))}
          >
            <IconTag size={11} />
            <span>{activityName}</span>
          </button>

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
