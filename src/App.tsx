import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { IconHome, IconLock, IconPause, IconPlay, IconSwitch, IconTag } from "./components/icons";
import { useElapsedSeconds } from "./lib/events";
import { formatElapsed } from "./lib/format";
import { useTrackingState } from "./lib/TrackingContext";
import {
  getActivityDetectionEnabled,
  openHomeWindow,
  pauseTracking,
  resumeTracking,
  setIdleLock,
} from "./lib/tauri";
import { ActivityPicker } from "./widget/ActivityPicker";
import { ProjectPicker } from "./widget/ProjectPicker";
import { useHoverExpand, useHoverIntent } from "./widget/useHoverExpand";
import type { WidgetHoverState } from "./widget/useHoverExpand";
import { clampToScreen, dockToSavedCorner, getSavedScale } from "./widget/widgetPosition";

const COLLAPSED_HEIGHT = 48;
const MIN_COLLAPSED_WIDTH = 90;
const MAX_COLLAPSED_WIDTH = 300;
// All four sides of the collapsed pill (keep in sync with .widget's padding
// in styles.css) — equal by request, so the pill reads as evenly inset.
const WIDGET_PADDING = 8;
const SWITCH_ICON_SIZE = 18;

// The expanded pill's exact content height without the activity chip, summed
// from the layout's fixed pieces (styles.css): 12 padding-top + 11 label row
// (11px label, line-height 1) + 10 .drag-zone row-gap + 24 name row (the
// inline-switch button, taller than the 16px name) + 16 above the buttons
// (8px .widget flex gap + 8px .actions margin-top) + 30 buttons + 12
// padding-bottom. Sizing the window to exactly this (plus the chip's
// measured footprint when enabled) is what makes the visual bottom inset
// equal EXPANDED_PADDING like the other three sides — the previous
// hand-tuned total carried ~13px of slack that .widget's justify-content:
// center split above and below, which read as extra top/bottom padding
// (measured at 18px bottom vs 12px sides on a customer screenshot).
const EXPANDED_BASE_HEIGHT = 115;
// .activity-chip's margin-top (-6px) eats back 6 of the .widget flex gap's
// 8px, netting a 2px gap above it — the only piece of its footprint that
// isn't part of its own measured box.
const CHIP_GAP_ABOVE = 2;
const EXPANDED_MIN_WIDTH = MAX_COLLAPSED_WIDTH;
const EXPANDED_MAX_WIDTH = 420;
// All four sides of the expanded pill, equal by request (keep in sync with
// .widget.expanded's padding in styles.css). The old asymmetric extra on
// the right (28px total) existed to keep the inline-switch button clear of
// the corner timer — that clearance is now guaranteed properly instead, by
// the window width itself accounting for the timer (see NAME_TO_TIMER_GAP).
const EXPANDED_PADDING = 12;
const INLINE_SWITCH_WIDTH = 24;
const NAME_ROW_GAP = 4;
// Fixed horizontal clearance between the inline-switch button (trailing the
// project name) and the corner timer's left edge. Baking the timer's own
// measured width plus this gap into the expanded window's width is what
// keeps that spacing constant however long the (≤MAX_NAME_CHARS) name is —
// previously the width ignored the timer entirely, so a 15-char name ran
// the switch button right up against (or under) the timer. Short names
// don't shrink below EXPANDED_MIN_WIDTH, where the gap simply grows.
const NAME_TO_TIMER_GAP = 24;
// Font size of the expanded pill's corner timer (`.label-row time` in
// styles.css) — the hidden measurement clone must match it.
const CORNER_TIMER_FONT_SIZE = 32;
// Project names are short by convention (enforced when naming them in the
// Projects tab), so the window only ever needs to grow up to this many
// characters' worth of width — anything longer gets ellipsized instead of
// pushing the pill wider indefinitely. Only applies to an actual project's
// name (see isRealProjectName below) — the "no project"/"no activity"
// fallback status messages are exempt. Kept lower than it looks like it
// needs to be (was 20) so the expanded pill's inline-switch button has room
// to sit comfortably next to the name rather than pushing right up against
// the corner timer.
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
  const [expandedHeight, setExpandedHeight] = useState(EXPANDED_BASE_HEIGHT);
  const [nameWidth, setNameWidth] = useState<number | undefined>(undefined);
  // Multiplies the whole widget via CSS transform (see the render below)
  // rather than reworking the layout to be resolution-independent — every
  // constant/measurement above stays in its original 1x logical-pixel frame,
  // and only the final on-screen size (this scale × those logical pixels) is
  // affected. Persisted in Settings; see widgetPosition.ts's getSavedScale.
  const [scale, setScale] = useState(1);
  const measureNameRef = useRef<HTMLElement>(null);
  const measureTimeRef = useRef<HTMLTimeElement>(null);
  const measureCornerTimeRef = useRef<HTMLTimeElement>(null);
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
  const isIdleLocked = state?.isIdleLocked ?? false;
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
  // Only an actual project's own name is subject to MAX_NAME_CHARS — these
  // two fallback strings are system status messages, not project names, and
  // both run past the limit on their own (see MAX_NAME_CHARS above). Ellipsizing
  // them would be truncating a *status*, which reads as broken rather than
  // tidy, so they're left free to size the expanded pill however wide they
  // need (still capped by EXPANDED_MAX_WIDTH below, and shown in full in the
  // collapsed pill too via that width's own CSS ellipsis, not this one).
  const isRealProjectName = !isIdle && hasProject;
  const projectName =
    isRealProjectName && rawProjectName.length > MAX_NAME_CHARS
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
    // getBoundingClientRect reports the *on-screen* box, i.e. already
    // multiplied by the widget's own CSS transform (see the render below) —
    // dividing by `scale` here converts it back to the 1x logical pixels
    // every other constant/measurement in this effect is expressed in.
    const nw = Math.ceil((measureNameRef.current?.getBoundingClientRect().width ?? 0) / scale) + 4;
    setNameWidth(nw);

    const timeWidth = hasTimer
      ? Math.ceil((measureTimeRef.current?.getBoundingClientRect().width ?? 0) / scale)
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
    // corner timer instead of the window making room for it. The corner
    // timer's width (measured at its own 32px size, roughly double the
    // collapsed timer's) is part of the content too — see NAME_TO_TIMER_GAP.
    const cornerTimeWidth = hasTimer
      ? Math.ceil((measureCornerTimeRef.current?.getBoundingClientRect().width ?? 0) / scale)
      : 0;
    const expandedContentWidth =
      nw +
      NAME_ROW_GAP +
      INLINE_SWITCH_WIDTH +
      (hasTimer ? NAME_TO_TIMER_GAP + cornerTimeWidth : 0);
    const nextExpandedWidth = Math.min(
      EXPANDED_MAX_WIDTH,
      Math.max(EXPANDED_MIN_WIDTH, expandedContentWidth + EXPANDED_PADDING * 2),
    );
    setExpandedWidth(nextExpandedWidth);

    const chipFootprint = activityEnabled
      ? Math.ceil((measureChipRef.current?.getBoundingClientRect().height ?? 0) / scale) +
        CHIP_GAP_ABOVE
      : 0;
    setExpandedHeight(EXPANDED_BASE_HEIGHT + chipFootprint);
  }, [projectName, hasTimer, activityEnabled, scale]);

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
  // The window itself has to grow/shrink by `scale` too — the transform
  // below only stretches what's painted *inside* the window, not the
  // window's own OS-level bounds.
  const scaledTargetSize = useMemo(
    () => ({ width: targetSize.width * scale, height: targetSize.height * scale }),
    [targetSize.width, targetSize.height, scale],
  );
  useHoverExpand(scaledTargetSize, isDocked);
  useHoverIntent(setHoverState);

  // The widget is always-on-top, so without this it would sit in front of
  // whatever the user is trying to click underneath it (a window's own
  // close button, a Figma panel, a WhatsApp menu, ...) every time the cursor
  // happens to pass over it. Click-through is the default state, not just
  // something "fade" turns on: hover detection polls the OS cursor position
  // on a 150ms timer (see useHoverIntent), so there's an inherent window
  // between the cursor actually landing on the widget and this effect
  // reacting to it. Keying this off `isFaded` used to mean the *idle* state
  // (cursor not yet detected as hovering) was non-click-through by default —
  // exactly the state a fast click lands in first — so every click near the
  // widget raced that poll and regularly lost, swallowed by the invisible
  // window instead of reaching Figma/WhatsApp underneath. Nothing in the
  // collapsed or faded widget has an onClick handler anyway (only the
  // ctrl+hover "expanded" controls do), so there's no interactivity to lose
  // by defaulting to click-through and only turning it off once expanded.
  useEffect(() => {
    void getCurrentWindow().setIgnoreCursorEvents(!isExpanded);
  }, [isExpanded]);

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
    (async () => {
      // Awaited before the first dock (rather than left to the scale state
      // + a later effect) so the very first placement already accounts for
      // it — otherwise the widget would briefly dock assuming 1x, then jump
      // once the saved scale loaded a moment later.
      const savedScale = await getSavedScale();
      if (cancelled) {
        return;
      }
      setScale(savedScale);
      await dockToSavedCorner(MIN_COLLAPSED_WIDTH * savedScale, COLLAPSED_HEIGHT * savedScale);
      await clampToScreen();
    })()
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
      void dockToSavedCorner(collapsedSize.width * scale, collapsedSize.height * scale).then(() =>
        clampToScreen(),
      );
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [collapsedSize.width, collapsedSize.height, scale]);

  // Same idea as widget-corner-changed above: the widget's scale is only
  // ever changed from the Home window's Settings now, so it needs applying
  // live rather than waiting for the widget's next launch.
  useEffect(() => {
    const unlistenPromise = listen<number>("widget-scale-changed", (event) => {
      const nextScale = event.payload;
      setScale(nextScale);
      void dockToSavedCorner(collapsedSize.width * nextScale, collapsedSize.height * nextScale).then(
        () => clampToScreen(),
      );
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [collapsedSize.width, collapsedSize.height]);

  function togglePause() {
    void (state?.isPaused ? resumeTracking() : pauseTracking());
  }

  function toggleLock() {
    void setIdleLock(!isIdleLocked);
  }

  const elapsedLabel = useMemo(() => formatElapsed(elapsed), [elapsed]);

  return (
    <main
      className={`widget${isExpanded ? " expanded" : ""}${isFaded ? " faded" : ""}`}
      style={{
        width: targetSize.width,
        height: targetSize.height,
        transform: `scale(${scale})`,
        transformOrigin: "top left",
      }}
    >
      <div
        aria-hidden="true"
        style={{ position: "absolute", visibility: "hidden", pointerEvents: "none", whiteSpace: "nowrap" }}
      >
        <strong ref={measureNameRef}>{projectName}</strong>
        {hasTimer && <time ref={measureTimeRef}>00:00:00</time>}
        {hasTimer && (
          <time ref={measureCornerTimeRef} style={{ fontSize: CORNER_TIMER_FONT_SIZE }}>
            00:00:00
          </time>
        )}
        <span ref={measureChipRef} className="activity-chip">
          <IconTag size={11} />
          <span>{activityName}</span>
        </span>
      </div>

      {isIdleLocked && !isExpanded && (
        <div className="lock-badge" title="Blocco inattività attivo">
          <IconLock size={10} />
        </div>
      )}

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
              {isIdleLocked && (
                <span className="lock-inline" title="Blocco inattività attivo">
                  <IconLock size={12} />
                </span>
              )}
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
              className={`icon-only lock-toggle${isIdleLocked ? " active" : ""}`}
              type="button"
              title={
                isIdleLocked
                  ? "Disattiva blocco inattività"
                  : "Blocca: niente pausa per inattività (riunioni, pensieri)"
              }
              aria-pressed={isIdleLocked}
              onClick={toggleLock}
            >
              <IconLock size={15} />
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
