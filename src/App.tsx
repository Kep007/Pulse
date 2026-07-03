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
import { dockToSavedCorner, saveCurrentCornerFromPosition } from "./widget/widgetPosition";

const COLLAPSED_HEIGHT = 40;
const MIN_COLLAPSED_WIDTH = 150;
const MAX_COLLAPSED_WIDTH = 300;
// Padding + dot + gaps + inline-switch button, generously rounded up — the
// project name text is measured separately since it's the only part whose
// width actually varies. A first attempt at this undercounted the chrome
// and clipped the trailing button, so this build in a larger safety margin
// on top of the literal box-model math.
const BASE_CHROME_WIDTH = 94;
// Extra allowance for the "00:00:00" timer + its gap when shown.
const TIMER_CHROME_WIDTH = 60;

const EXPANDED_SIZE = { width: MAX_COLLAPSED_WIDTH, height: 112 };
const PICKER_SIZE = { width: MAX_COLLAPSED_WIDTH, height: 320 };

type OpenPicker = "project" | "activity" | null;

export function App() {
  const state = useTrackingState();
  const elapsed = useElapsedSeconds(state?.segmentStartedAt, state?.isPaused ?? false);
  const [openPicker, setOpenPicker] = useState<OpenPicker>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isDocked, setIsDocked] = useState(false);
  const [collapsedWidth, setCollapsedWidth] = useState(MIN_COLLAPSED_WIDTH);
  const measureRef = useRef<HTMLSpanElement>(null);
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

  // Measures the natural (untruncated) width of the project name so the
  // collapsed pill can shrink/grow to fit it — short names like "GPT"
  // shouldn't sit in a pill sized for "Nessun progetto rilevato". The
  // visible text lives in a `1fr` grid track, whose own box never reflects
  // its natural width, hence the separate hidden measuring span.
  useLayoutEffect(() => {
    const textWidth = measureRef.current?.scrollWidth ?? 0;
    const chrome = BASE_CHROME_WIDTH + (hasTimer ? TIMER_CHROME_WIDTH : 0);
    const next = Math.min(MAX_COLLAPSED_WIDTH, Math.max(MIN_COLLAPSED_WIDTH, textWidth + chrome));
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
      <span
        ref={measureRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          visibility: "hidden",
          whiteSpace: "nowrap",
          fontSize: 13,
          fontWeight: 600,
          pointerEvents: "none",
        }}
      >
        {projectName}
      </span>

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
              <IconSwitch size={12} />
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
