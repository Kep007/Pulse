import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { IconHome, IconPause, IconPlay, IconSwitch, IconTag } from "./components/icons";
import { useElapsedSeconds } from "./lib/events";
import { formatElapsed } from "./lib/format";
import { useTrackingState } from "./lib/TrackingContext";
import { openHomeWindow, pauseTracking, resumeTracking } from "./lib/tauri";
import { ActivityPicker } from "./widget/ActivityPicker";
import { ProjectPicker } from "./widget/ProjectPicker";
import { useHoverExpand, useHoverIntent } from "./widget/useHoverExpand";
import { dockToSavedCorner, saveCurrentCornerFromPosition } from "./widget/widgetPosition";

// Fixed rather than measured-to-fit: comfortably fits the longest strings in
// use ("Nessun progetto rilevato", 12-char project names) plus the timer and
// home button. A measure-and-resize-to-content approach was tried but hit a
// window/webview size mismatch on multi-monitor DPI setups that clipped
// content, so a generous fixed width is the more robust choice here.
const COLLAPSED_SIZE = { width: 260, height: 40 };
const EXPANDED_SIZE = { width: 300, height: 112 };
const PICKER_SIZE = { width: 300, height: 320 };

type OpenPicker = "project" | "activity" | null;

export function App() {
  const state = useTrackingState();
  const elapsed = useElapsedSeconds(state?.segmentStartedAt, state?.isPaused ?? false);
  const [openPicker, setOpenPicker] = useState<OpenPicker>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isDocked, setIsDocked] = useState(false);
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

  const targetSize = openPicker ? PICKER_SIZE : isHovered ? EXPANDED_SIZE : COLLAPSED_SIZE;
  useHoverExpand(targetSize, isDocked);
  useHoverIntent(setIsHovered);

  const isExpanded = isHovered || openPicker !== null;

  // Initial corner-docking must land before useHoverExpand starts computing
  // anchors from the window's current position — otherwise whichever effect
  // calls setPosition last wins the race, and hover-driven resizes end up
  // preserving the OS's default placement instead of the saved corner.
  useEffect(() => {
    let cancelled = false;
    dockToSavedCorner(COLLAPSED_SIZE.width, COLLAPSED_SIZE.height)
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
      <section className="drag-zone" data-tauri-drag-region>
        <div
          className={isPaused ? "status-dot paused" : "status-dot"}
          data-tauri-drag-region
        />
        <div className="project" data-tauri-drag-region>
          {isExpanded && (
            <span className="label" data-tauri-drag-region>
              {isPaused ? "In pausa" : state?.source === "manual" ? "Manuale" : "Automatico"}
            </span>
          )}
          <div className="project-name-row" data-tauri-drag-region>
            <strong data-tauri-drag-region>{projectName}</strong>
            <button
              type="button"
              className="inline-switch"
              title="Cambia progetto"
              onClick={() => setOpenPicker((current) => (current === "project" ? null : "project"))}
            >
              <IconSwitch size={11} />
            </button>
          </div>
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
