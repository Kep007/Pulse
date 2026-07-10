import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";
import { confirmPendingSuggestion, denyPendingSuggestion, getCurrentState } from "../lib/tauri";
import type { PendingSuggestion, ToastMessage, TrackingState } from "../lib/types";
import { getSavedCorner } from "../widget/widgetPosition";
import "./toast.css";

const MARGIN = 16;
// The widget's own collapsed height (App.tsx's COLLAPSED_HEIGHT) — kept in
// sync by hand rather than imported, same as MARGIN above, since App.tsx is
// a page root, not a constants module. Used to stack the toast just outside
// the widget's pill rather than the screen corner, so it never covers it.
const WIDGET_COLLAPSED_HEIGHT = 48;
const TOAST_WIDGET_GAP = 12;
const INFO_SIZE = { width: 300, height: 56 };
const CONFIRM_SIZE = { width: 320, height: 122 };
const INFO_LIFETIME_MS = 3200;

type Display =
  | { kind: "info"; text: string }
  | { kind: "confirm"; suggestion: PendingSuggestion };

export function ToastWindow() {
  const [display, setDisplay] = useState<Display | null>(null);
  const dismissTimer = useRef<number | null>(null);
  const applyQueue = useRef(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    const unlisten: Array<() => void> = [];

    getCurrentState().then((state) => {
      if (!cancelled && state.pending) {
        setDisplay({ kind: "confirm", suggestion: state.pending });
      }
    });

    listen<ToastMessage>("toast-message", (event) => {
      setDisplay((current) =>
        current?.kind === "confirm" ? current : { kind: "info", text: event.payload.text },
      );
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlisten.push(fn);
    });

    listen<PendingSuggestion>("suggestion-pending", (event) => {
      setDisplay({ kind: "confirm", suggestion: event.payload });
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlisten.push(fn);
    });

    listen<TrackingState>("state-changed", (event) => {
      if (!event.payload.pending) {
        setDisplay((current) => (current?.kind === "confirm" ? null : current));
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlisten.push(fn);
    });

    return () => {
      cancelled = true;
      unlisten.forEach((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (dismissTimer.current !== null) {
      window.clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }

    if (display?.kind === "info") {
      dismissTimer.current = window.setTimeout(() => setDisplay(null), INFO_LIFETIME_MS);
    }

    return () => {
      if (dismissTimer.current !== null) {
        window.clearTimeout(dismissTimer.current);
      }
    };
  }, [display]);

  useEffect(() => {
    async function applyVisibility() {
      const win = getCurrentWindow();

      if (!display) {
        // Belt and braces: even while hidden, make sure the window can't
        // swallow clicks if anything ever shows it out of band.
        await win.setIgnoreCursorEvents(true);
        await win.hide();
        return;
      }

      // Only the confirm toast has anything to click (the Sì/No buttons).
      // The info toast is purely visual, and this window is transparent +
      // always-on-top: without click-through, its whole rectangle silently
      // eats every mouse event meant for the app underneath — customers hit
      // this as a "dead zone" right where the popup appears (e.g. Figma's
      // export dropdown, which opens exactly above the widget's corner).
      await win.setIgnoreCursorEvents(display.kind !== "confirm");

      const size = display.kind === "confirm" ? CONFIRM_SIZE : INFO_SIZE;
      const scale = await win.scaleFactor();
      const monitor = await currentMonitor();

      await win.setSize(new LogicalSize(size.width, size.height));

      if (monitor) {
        // `workArea` excludes the taskbar (unlike the monitor's full
        // bounds) — anchoring to the raw monitor height put most of the
        // toast's body underneath/behind the taskbar, which is why it
        // looked like notifications never appeared at all.
        const workAreaSize = monitor.workArea.size.toLogical(scale);
        const workAreaPosition = monitor.workArea.position.toLogical(scale);
        const corner = await getSavedCorner();
        const isRight = corner.includes("right");
        const isBottom = corner.includes("bottom");

        // Mirrors the widget's own corner math (see widgetPosition.ts) so
        // the toast's left/right edge lines up with the widget's — then
        // stacks vertically just outside the widget's pill (above it when
        // the widget sits at the bottom, below when it sits at the top)
        // instead of sharing the same corner, which would otherwise cover
        // the widget it's supposed to be a notification *about*.
        const x = isRight
          ? workAreaPosition.x + workAreaSize.width - size.width - MARGIN
          : workAreaPosition.x + MARGIN;
        const y = isBottom
          ? workAreaPosition.y +
            workAreaSize.height -
            MARGIN -
            WIDGET_COLLAPSED_HEIGHT -
            TOAST_WIDGET_GAP -
            size.height
          : workAreaPosition.y + MARGIN + WIDGET_COLLAPSED_HEIGHT + TOAST_WIDGET_GAP;

        await win.setPosition(new LogicalPosition(x, y));
      }

      await win.show();
    }

    // Strictly serialized, never cancelled: each state's show/hide runs to
    // completion before the next one starts. Letting them overlap caused the
    // worst bug this window ever had — a hide() for the new state completing
    // while the previous show() was still mid-flight, leaving a window that
    // React had emptied (fully transparent) but Windows still considered
    // visible: an invisible, always-on-top rectangle parked above the widget
    // that blocked clicks until the next toast happened to hide it. That's
    // also why pausing the timer "fixed" it for customers — the pause toast
    // itself ran a clean show→hide cycle.
    applyQueue.current = applyQueue.current
      .then(applyVisibility)
      .catch((error) => console.error("Unable to update toast window", error));
  }, [display]);

  function respond(confirmed: boolean) {
    setDisplay(null);
    void (confirmed ? confirmPendingSuggestion() : denyPendingSuggestion());
  }

  if (!display) {
    return null;
  }

  return (
    <main className="toast-window">
      {display.kind === "info" ? (
        <div className="toast-card info">{display.text}</div>
      ) : (
        <div className="toast-card confirm">
          <p>
            Cambio rilevato: <strong>{display.suggestion.project?.name ?? "Nessun progetto"}</strong>
            {display.suggestion.activityType ? ` · ${display.suggestion.activityType.name}` : ""}
          </p>
          <div className="toast-actions">
            <button type="button" className="deny" onClick={() => respond(false)}>
              No
            </button>
            <button type="button" className="accept" onClick={() => respond(true)}>
              Sì
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
