import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { IconHome, IconPause, IconPlay, IconSwitch, IconTag } from "./components/icons";
import { useElapsedSeconds } from "./lib/events";
import { formatElapsed } from "./lib/format";
import { useTrackingState } from "./lib/TrackingContext";
import { openHomeWindow, pauseTracking, resumeTracking } from "./lib/tauri";
import { ActivityPicker } from "./widget/ActivityPicker";
import { ProjectPicker } from "./widget/ProjectPicker";
import { useHoverExpand, useHoverIntent } from "./widget/useHoverExpand";
import { clampToScreen, dockToSavedCorner, saveCurrentCornerFromPosition } from "./widget/widgetPosition";

const COLLAPSED_HEIGHT = 40;
const MIN_COLLAPSED_WIDTH = 150;
const MAX_COLLAPSED_WIDTH = 300;
const WIDGET_PADDING = 8;
const SWITCH_ICON_SIZE = 18;

const EXPANDED_SIZE = { width: MAX_COLLAPSED_WIDTH, height: 132 };
const PICKER_SIZE = { width: MAX_COLLAPSED_WIDTH, height: 320 };

type OpenPicker = "project" | "activity" | null;

export function App() {
  const state = useTrackingState();
  const elapsed = useElapsedSeconds(state?.segmentStartedAt, state?.isPaused ?? false);
  const [openPicker, setOpenPicker] = useState<OpenPicker>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isDocked, setIsDocked] = useState(false);
  const [collapsedWidth, setCollapsedWidth] = useState(MIN_COLLAPSED_WIDTH);
  const measureRowRef = useRef<HTMLElement>(null);
  const moveSaveTimer = useRef<number | null>(null);
  // Only a real user drag (via startDragging) should ever persist a new
  // corner — our own hover-expand resizes also move the window, and trying
  // to retroactively "suppress" those after the fact is a losing race
  // against when the moved event actually arrives.
  const isUserDraggingRef = useRef(false);

  const isPaused = state?.isPaused ?? false;
  const projectName = state?.project?.name ?? "Nessun progetto rilevato";
  const activityName = state?.activityType?.name ?? "Nessuna attività";
  const hasTimer = Boolean(state?.project || state?.activityType);

  // Sizes the collapsed pill to fit its content exactly rather than guessing
  // a chrome-width constant (past attempts at that under- and over-shot,
  // leaving either a clipped button or dead space in the pill). A hidden
  // clone of the actual drag-zone row — same classes, so its box model
  // matches pixel-for-pixel — reports its true natural (max-content) width,
  // which the real row can't do directly since its grid track is what
  // shrinks to make ellipsis truncation work.
  useLayoutEffect(() => {
    const rowWidth = measureRowRef.current?.scrollWidth ?? 0;
    const next = Math.min(
      MAX_COLLAPSED_WIDTH,
      Math.max(MIN_COLLAPSED_WIDTH, rowWidth + WIDGET_PADDING * 2),
    );
    setCollapsedWidth(next);
  }, [projectName, hasTimer]);

  const collapsedSize = useMemo(
    () => ({ width: collapsedWidth, height: COLLAPSED_HEIGHT }),
    [collapsedWidth],
  );
  const targetSize = openPicker ? PICKER_SIZE : isHovered ? EXPANDED_SIZE : collapsedSize;
  useHoverExpand(targetSize, isDocked);
  useHoverIntent(setIsHovered);

  const isExpanded = isHovered || openPicker !== null;

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

  useEffect(() => {
    if (!isDocked) {
      return;
    }

    let unlisten: (() => void) | undefined;
    let cancelled = false;

    getCurrentWindow()
      .onMoved(() => {
        if (!isUserDraggingRef.current) {
          return;
        }
        if (moveSaveTimer.current !== null) {
          window.clearTimeout(moveSaveTimer.current);
        }
        moveSaveTimer.current = window.setTimeout(() => {
          void saveCurrentCornerFromPosition();
        }, 300);
      })
      .then((fn) => {
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
      });

    return () => {
      cancelled = true;
      unlisten?.();
      if (moveSaveTimer.current !== null) {
        window.clearTimeout(moveSaveTimer.current);
      }
    };
  }, [isDocked]);

  async function startDrag(event: MouseEvent<HTMLElement>) {
    if (event.button !== 0) {
      return;
    }

    // Excludes buttons and the scrollable project/activity picker (whose
    // native scrollbar thumb would otherwise be hijacked into a window drag
    // instead of scrolling the list).
    if (event.target instanceof Element && event.target.closest("button, .picker")) {
      return;
    }

    event.preventDefault();
    isUserDraggingRef.current = true;
    try {
      // Resolves only once the native drag-move loop ends (mouse released),
      // so the flag stays true for exactly the moves that loop produces.
      await getCurrentWindow().startDragging();
    } catch (error) {
      console.error("Unable to start window drag", error);
    } finally {
      isUserDraggingRef.current = false;
      // Supersedes the debounced onMoved save below with a definitive one
      // that reflects the post-clamp position, so a drag that lands off-
      // screen doesn't get its stale (off-screen) corner persisted.
      if (moveSaveTimer.current !== null) {
        window.clearTimeout(moveSaveTimer.current);
        moveSaveTimer.current = null;
      }
      await clampToScreen();
      await saveCurrentCornerFromPosition();
    }
  }

  function togglePause() {
    void (state?.isPaused ? resumeTracking() : pauseTracking());
  }

  const elapsedLabel = useMemo(() => formatElapsed(elapsed), [elapsed]);

  return (
    <main
      className={isExpanded ? "widget expanded" : "widget"}
      data-tauri-drag-region
      onMouseDown={startDrag}
    >
      <div aria-hidden="true" style={{ position: "absolute", visibility: "hidden", pointerEvents: "none" }}>
        <section className="drag-zone" ref={measureRowRef}>
          <div className="status-dot" />
          <div className="project-name-row">
            <strong>{projectName}</strong>
            <button type="button" className="inline-switch" tabIndex={-1}>
              <IconSwitch size={SWITCH_ICON_SIZE} />
            </button>
          </div>
          {hasTimer && <time>00:00:00</time>}
        </section>
      </div>

      <section className="drag-zone" data-tauri-drag-region>
        {isExpanded ? (
          <div className="label-row" data-tauri-drag-region>
            <div
              className={isPaused ? "status-dot paused" : "status-dot"}
              data-tauri-drag-region
            />
            <span className="label" data-tauri-drag-region>
              {isPaused ? "In pausa" : state?.source === "manual" ? "Manuale" : "Automatico"}
            </span>
          </div>
        ) : (
          <div
            className={isPaused ? "status-dot paused" : "status-dot"}
            data-tauri-drag-region
          />
        )}
        <div
          className={isExpanded ? "project-name-row flush" : "project-name-row"}
          data-tauri-drag-region
        >
          <strong data-tauri-drag-region>{projectName}</strong>
          <button
            type="button"
            className="inline-switch"
            title="Cambia progetto"
            onClick={() => setOpenPicker((current) => (current === "project" ? null : "project"))}
          >
            <IconSwitch size={SWITCH_ICON_SIZE} />
          </button>
        </div>
        {hasTimer && <time data-tauri-drag-region>{elapsedLabel}</time>}
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
