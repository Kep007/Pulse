import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow, monitorFromPoint } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useRef, useState } from "react";
import { formatAccelerator } from "../lib/shortcutFormat";
import {
  confirmPendingSuggestion,
  denyPendingSuggestion,
  getConfirmShortcut,
  getCurrentState,
} from "../lib/tauri";
import type { PendingSuggestion, ToastMessage, TrackingState } from "../lib/types";
import { getSavedCorner, getSavedScale } from "../widget/widgetPosition";
import "./toast.css";

const MARGIN = 16;
// The widget's own collapsed height (App.tsx's COLLAPSED_HEIGHT) — kept in
// sync by hand rather than imported, same as MARGIN above, since App.tsx is
// a page root, not a constants module. Used to stack the toast just outside
// the widget's pill rather than the screen corner, so it never covers it.
// The widget renders at COLLAPSED_HEIGHT × its user-chosen scale, so the
// stacking math below multiplies by the same scale — otherwise a shrunken
// widget leaves a hole between itself and the toast.
const WIDGET_COLLAPSED_HEIGHT = 48;
const TOAST_WIDGET_GAP = 16;
const INFO_LIFETIME_MS = 3200;

type Display =
  | { kind: "info"; text: string }
  | { kind: "confirm"; suggestion: PendingSuggestion };

export function ToastWindow() {
  const [display, setDisplay] = useState<Display | null>(null);
  // Same user setting as the widget's "Dimensione widget" slider — the toast
  // is part of the same corner UI, so it grows/shrinks with it.
  const [widgetScale, setWidgetScale] = useState(1);
  const [shortcut, setShortcut] = useState<string | null>(null);
  const dismissTimer = useRef<number | null>(null);
  const applyQueue = useRef(Promise.resolve());
  // Off-screen unscaled clone of the card (see render below): its natural
  // size drives the window size, so the popup adapts to long project names
  // instead of truncating or leaving uneven whitespace.
  const measureRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const unlisten: Array<() => void> = [];

    getCurrentState().then((state) => {
      if (!cancelled && state.pending) {
        setDisplay({ kind: "confirm", suggestion: state.pending });
      }
    });

    void getSavedScale().then((value) => {
      if (!cancelled) {
        setWidgetScale(value);
      }
    });

    getConfirmShortcut().then((value) => {
      if (!cancelled) {
        setShortcut(value);
      }
    });

    listen<number>("widget-scale-changed", (event) => {
      setWidgetScale(event.payload);
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlisten.push(fn);
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
      // Re-read the shortcut on every new suggestion: the user may have
      // changed it in Settings since this window loaded, and there's no
      // dedicated "shortcut changed" event to subscribe to.
      getConfirmShortcut().then(setShortcut);
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

      // The hidden clone was laid out during this same React commit, so its
      // rect is the card's natural (unscaled) size, clamped by the
      // min/max-width rules in toast.css.
      const measured = measureRef.current?.getBoundingClientRect();
      const logical = {
        width: Math.ceil(measured?.width ?? 300),
        height: Math.ceil(measured?.height ?? 56),
      };
      if (contentRef.current) {
        contentRef.current.style.width = `${logical.width}px`;
        contentRef.current.style.height = `${logical.height}px`;
        // Same trick as the widget (App.tsx): layout stays at 1x logical
        // pixels, only the final on-screen size is scaled.
        contentRef.current.style.transform = `scale(${widgetScale})`;
      }
      const size = {
        width: Math.ceil(logical.width * widgetScale),
        height: Math.ceil(logical.height * widgetScale),
      };

      await win.setSize(new LogicalSize(size.width, size.height));

      // Anchor to the widget's *actual* window rect, not the saved corner:
      // the widget is draggable, so the corner it was last docked to says
      // nothing about where it sits right now — positioning from the corner
      // left the toast overlapping (or nowhere near) a dragged widget.
      let placed = false;
      const widget = await WebviewWindow.getByLabel("main");
      if (widget && (await widget.isVisible().catch(() => false))) {
        try {
          const [widgetPhysicalPos, widgetPhysicalSize, widgetDpi] = await Promise.all([
            widget.outerPosition(),
            widget.outerSize(),
            widget.scaleFactor(),
          ]);
          // The widget may have been dragged onto a different monitor than
          // the one this (hidden) toast window last showed on — resolve the
          // monitor from the widget's own center, falling back to ours.
          const monitor =
            (await monitorFromPoint(
              widgetPhysicalPos.x + widgetPhysicalSize.width / 2,
              widgetPhysicalPos.y + widgetPhysicalSize.height / 2,
            ).catch(() => null)) ?? (await currentMonitor());
          const widgetPos = widgetPhysicalPos.toLogical(widgetDpi);
          const widgetSize = widgetPhysicalSize.toLogical(widgetDpi);

          if (monitor) {
            // `workArea` excludes the taskbar (unlike the monitor's full
            // bounds) — anchoring to the raw monitor height put most of the
            // toast's body underneath/behind the taskbar, which is why it
            // looked like notifications never appeared at all.
            const workAreaSize = monitor.workArea.size.toLogical(widgetDpi);
            const workAreaPosition = monitor.workArea.position.toLogical(widgetDpi);

            // Stack just outside the widget's pill (above it when the widget
            // sits in the lower half of the screen, below otherwise) and line
            // up the edge nearest the screen border, so widget + toast read
            // as one unit wherever the widget was dragged.
            const placeAbove =
              widgetPos.y + widgetSize.height / 2 >
              workAreaPosition.y + workAreaSize.height / 2;
            const alignRight =
              widgetPos.x + widgetSize.width / 2 >
              workAreaPosition.x + workAreaSize.width / 2;

            let x = alignRight ? widgetPos.x + widgetSize.width - size.width : widgetPos.x;
            let y = placeAbove
              ? widgetPos.y - TOAST_WIDGET_GAP - size.height
              : widgetPos.y + widgetSize.height + TOAST_WIDGET_GAP;

            x = Math.min(
              Math.max(x, workAreaPosition.x),
              workAreaPosition.x + workAreaSize.width - size.width,
            );
            y = Math.min(
              Math.max(y, workAreaPosition.y),
              workAreaPosition.y + workAreaSize.height - size.height,
            );

            await win.setPosition(new LogicalPosition(x, y));
            placed = true;
          }
        } catch (error) {
          console.error("Unable to anchor toast to the widget, using corner", error);
        }
      }

      if (!placed) {
        // Widget hidden or unreachable: fall back to the widget's *saved*
        // corner (same math as widgetPosition.ts), assuming its collapsed
        // footprint at the current scale.
        const dpi = await win.scaleFactor();
        const monitor = await currentMonitor();
        if (monitor) {
          const workAreaSize = monitor.workArea.size.toLogical(dpi);
          const workAreaPosition = monitor.workArea.position.toLogical(dpi);
          const corner = await getSavedCorner();
          const isRight = corner.includes("right");
          const isBottom = corner.includes("bottom");
          const widgetHeight = WIDGET_COLLAPSED_HEIGHT * widgetScale;

          const x = isRight
            ? workAreaPosition.x + workAreaSize.width - size.width - MARGIN
            : workAreaPosition.x + MARGIN;
          const y = isBottom
            ? workAreaPosition.y +
              workAreaSize.height -
              MARGIN -
              widgetHeight -
              TOAST_WIDGET_GAP -
              size.height
            : workAreaPosition.y + MARGIN + widgetHeight + TOAST_WIDGET_GAP;

          await win.setPosition(new LogicalPosition(x, y));
        }
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
  }, [display, widgetScale, shortcut]);

  function respond(confirmed: boolean) {
    setDisplay(null);
    void (confirmed ? confirmPendingSuggestion() : denyPendingSuggestion());
  }

  if (!display) {
    return null;
  }

  function renderCard(current: Display) {
    if (current.kind === "info") {
      return <div className="toast-card info">{current.text}</div>;
    }
    const { suggestion } = current;
    return (
      <div className="toast-card confirm">
        <div className="toast-text">
          <p className="toast-title">
            Cambio rilevato: <strong>{suggestion.project?.name ?? "Nessun progetto"}</strong>
            {suggestion.activityType ? ` · ${suggestion.activityType.name}` : ""}
          </p>
          {shortcut && (
            <p className="toast-hint">
              {/* Minimal filled keyboard glyph (Material "keyboard") — marks
                  the line as a hotkey without adding any text. */}
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20 5H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 2H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z" />
              </svg>
              <span>
                <strong>{formatAccelerator(shortcut)}</strong> per confermare
              </span>
            </p>
          )}
        </div>
        <div className="toast-actions">
          <button type="button" className="accept" onClick={() => respond(true)}>
            Sì
          </button>
          <button type="button" className="deny" onClick={() => respond(false)}>
            No
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <main className="toast-window" ref={contentRef}>
        {renderCard(display)}
      </main>
      <div className="toast-measure" ref={measureRef} aria-hidden="true">
        {renderCard(display)}
      </div>
    </>
  );
}
