import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow, monitorFromPoint } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useRef, useState } from "react";
import { formatHoursMinutes } from "../lib/format";
import { formatAccelerator } from "../lib/shortcutFormat";
import {
  acceptResumeOffer,
  confirmPendingSuggestion,
  continueThroughBreak,
  declineResumeOffer,
  denyPendingSuggestion,
  dismissBreakPrompt,
  openHomeWindow,
  getConfirmShortcut,
  getCurrentState,
} from "../lib/tauri";
import type {
  BreakPrompt,
  DayRecap,
  PendingSuggestion,
  ResumeOffer,
  ToastMessage,
  TrackingState,
} from "../lib/types";
import { getSavedCorner, getSavedScale } from "../widget/widgetPosition";
import type { ReactNode } from "react";
import {
  IconChart,
  IconCheck,
  IconCoffee,
  IconLock,
  IconPause,
  IconPlay,
  IconSwitch,
  IconTag,
} from "../components/icons";
import { initTheme, refreshTheme } from "../lib/theme";
import "../theme-tokens.css";
import "./toast.css";

initTheme();

type Tone = "accent" | "success" | "warn" | "neutral";

// Info toasts are short status lines from the backend; the icon is picked
// from their wording so each kind of event reads at a glance.
function infoIcon(text: string): { icon: ReactNode; tone: Tone } {
  const lower = text.toLowerCase();
  if (lower.includes("pausa") && !lower.includes("finita")) {
    return { icon: <IconPause size={14} />, tone: "warn" };
  }
  if (lower.includes("ripres") || lower.includes("finita")) {
    return { icon: <IconPlay size={14} />, tone: "success" };
  }
  if (lower.includes("blocco")) {
    return { icon: <IconLock size={14} />, tone: "accent" };
  }
  if (lower.startsWith("progetto") || lower.startsWith("attività")) {
    return { icon: <IconTag size={14} />, tone: "accent" };
  }
  return { icon: <IconCheck size={14} />, tone: "neutral" };
}

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
  | { kind: "confirm"; suggestion: PendingSuggestion }
  | { kind: "resume"; offer: ResumeOffer }
  | { kind: "break"; prompt: BreakPrompt }
  | { kind: "recap"; recap: DayRecap };

const RECAP_LIFETIME_MS = 2 * 60 * 1000;
const RECAP_MAX_PROJECTS = 4;

// The break / forgotten-work prompts live in the tracking state itself (a
// fresh window or a missed event still finds them there), so they're derived
// from each state snapshot. Returning `current` when nothing changed keeps
// the window from re-anchoring on every unrelated state-changed.
function promptFromState(current: Display | null, state: TrackingState): Display | null {
  if (state.pending) {
    return current?.kind === "confirm" ? current : { kind: "confirm", suggestion: state.pending };
  }
  if (state.resumeOffer) {
    return current?.kind === "resume" && current.offer.since === state.resumeOffer.since
      ? current
      : { kind: "resume", offer: state.resumeOffer };
  }
  if (state.breakPrompt) {
    return current?.kind === "break" && current.prompt.endsAt === state.breakPrompt.endsAt
      ? current
      : { kind: "break", prompt: state.breakPrompt };
  }
  return current?.kind === "info" || current?.kind === "recap" ? current : null;
}

function formatClock(iso: string) {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function ToastWindow() {
  const [display, setDisplay] = useState<Display | null>(null);
  // Same user setting as the widget's "Dimensione widget" slider — the toast
  // is part of the same corner UI, so it grows/shrinks with it.
  const [widgetScale, setWidgetScale] = useState(1);
  const [shortcut, setShortcut] = useState<string | null>(null);
  // Bumped whenever the widget resizes (hover-expand, picker open/close) so a
  // visible toast re-anchors to the widget's new rect instead of covering it.
  const [geometryTick, setGeometryTick] = useState(0);
  const isShowingRef = useRef(false);
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
      if (!cancelled) {
        setDisplay((current) => promptFromState(current, state));
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

    listen("widget-geometry-changed", () => {
      if (isShowingRef.current) {
        setGeometryTick((tick) => tick + 1);
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlisten.push(fn);
    });

    listen<DayRecap>("day-recap", (event) => {
      setDisplay((current) =>
        current && current.kind !== "info" ? current : { kind: "recap", recap: event.payload },
      );
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlisten.push(fn);
    });

    listen<ToastMessage>("toast-message", (event) => {
      setDisplay((current) =>
        current && current.kind !== "info" ? current : { kind: "info", text: event.payload.text },
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
      setDisplay((current) => promptFromState(current, event.payload));
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

    if (display?.kind === "info" || display?.kind === "recap") {
      dismissTimer.current = window.setTimeout(
        () => setDisplay(null),
        display.kind === "info" ? INFO_LIFETIME_MS : RECAP_LIFETIME_MS,
      );
    }

    return () => {
      if (dismissTimer.current !== null) {
        window.clearTimeout(dismissTimer.current);
      }
    };
  }, [display]);

  useEffect(() => {
    isShowingRef.current = display !== null;
    if (display) {
      refreshTheme();
    }

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
      await win.setIgnoreCursorEvents(display.kind === "info");

      // The hidden clone was laid out during this same React commit, so its
      // rect is the card's natural (unscaled) size, clamped by the
      // min/max-width rules in toast.css.
      const measured = measureRef.current?.getBoundingClientRect();
      const natural = {
        width: Math.ceil(measured?.width ?? 300),
        height: Math.ceil(measured?.height ?? 56),
      };

      const widget = await WebviewWindow.getByLabel("main");
      const widgetRect =
        widget && (await widget.isVisible().catch(() => false))
          ? await Promise.all([widget.outerPosition(), widget.outerSize(), widget.scaleFactor()])
              .then(([position, physicalSize, dpi]) => ({ position, physicalSize, dpi }))
              .catch(() => null)
          : null;

      // Grow with the widget: when it's expanded (Ctrl+hover, project picker)
      // the toast matches its width so the two read as one stacked unit.
      const widgetLogicalWidth = widgetRect
        ? widgetRect.physicalSize.toLogical(widgetRect.dpi).width
        : 0;
      const logical = {
        width: Math.max(natural.width, Math.floor(widgetLogicalWidth / widgetScale)),
        height: natural.height,
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
      // the widget resizes as it expands, so only its live rect says where
      // the toast can sit without covering it.
      let placed = false;
      if (widgetRect) {
        try {
          const {
            position: widgetPhysicalPos,
            physicalSize: widgetPhysicalSize,
            dpi: widgetDpi,
          } = widgetRect;
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
            const above = widgetPos.y - TOAST_WIDGET_GAP - size.height;
            const below = widgetPos.y + widgetSize.height + TOAST_WIDGET_GAP;
            const workAreaBottom = workAreaPosition.y + workAreaSize.height;
            // A tall expanded widget (open picker) can leave no room on the
            // preferred side — flip rather than let the clamp below push the
            // toast on top of the widget.
            let y = placeAbove
              ? above >= workAreaPosition.y || below + size.height > workAreaBottom
                ? above
                : below
              : below + size.height <= workAreaBottom || above < workAreaPosition.y
                ? below
                : above;

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
  }, [display, widgetScale, shortcut, geometryTick]);

  function respond(confirmed: boolean) {
    const kind = display?.kind;
    setDisplay(null);
    if (kind === "recap") {
      if (confirmed) {
        void openHomeWindow();
      }
    } else if (kind === "resume") {
      void (confirmed ? acceptResumeOffer() : declineResumeOffer());
    } else if (kind === "break") {
      void (confirmed ? continueThroughBreak() : dismissBreakPrompt());
    } else {
      void (confirmed ? confirmPendingSuggestion() : denyPendingSuggestion());
    }
  }

  if (!display) {
    return null;
  }

  function shortcutHint() {
    return shortcut ? (
      <p className="toast-hint">
        <kbd>{formatAccelerator(shortcut)}</kbd> per confermare
      </p>
    ) : null;
  }

  function prompt(
    tone: Tone,
    icon: ReactNode,
    title: ReactNode,
    body: ReactNode,
    [acceptLabel, denyLabel]: [string, string],
    extra?: ReactNode,
  ) {
    return (
      <div className={`toast-card prompt tone-${tone}`}>
        <div className="toast-main">
          <span className="toast-icon">{icon}</span>
          <div className="toast-text">
            <p className="toast-title">{title}</p>
            {body && <p className="toast-body">{body}</p>}
            {extra}
          </div>
        </div>
        <div className="toast-actions">
          <button type="button" className="deny" onClick={() => respond(false)}>
            {denyLabel}
          </button>
          <button type="button" className="accept" onClick={() => respond(true)}>
            {acceptLabel}
          </button>
        </div>
      </div>
    );
  }

  function renderCard(current: Display) {
    switch (current.kind) {
      case "info": {
        const { icon, tone } = infoIcon(current.text);
        return (
          <div className={`toast-card info tone-${tone}`}>
            <span className="toast-icon">{icon}</span>
            <span className="toast-info-text">{current.text}</span>
          </div>
        );
      }
      case "confirm": {
        const { suggestion } = current;
        return prompt(
          "accent",
          <IconSwitch size={16} />,
          "Cambio rilevato",
          <>
            Passare a <strong>{suggestion.project?.name ?? "Nessun progetto"}</strong>
            {suggestion.activityType ? ` · ${suggestion.activityType.name}` : ""}?
          </>,
          ["Sì", "No"],
          shortcutHint(),
        );
      }
      case "resume": {
        const { offer } = current;
        return prompt(
          "success",
          <IconPlay size={16} />,
          "Stai lavorando?",
          <>
            Su <strong>{offer.project?.name ?? offer.activityType?.name ?? "un progetto"}</strong> dalle{" "}
            {formatClock(offer.since)}. Riprendo da lì?
          </>,
          ["Riprendi", "No"],
          shortcutHint(),
        );
      }
      case "break":
        return prompt(
          "warn",
          <IconCoffee size={16} />,
          "Pausa pranzo",
          <>
            In pausa fino alle <strong>{current.prompt.endsAt}</strong>. Stai facendo un extra?
          </>,
          ["Continuo", "Pausa"],
          shortcutHint(),
        );
      case "recap": {
        const { recap } = current;
        return prompt(
          "accent",
          <IconChart size={16} />,
          <>
            La tua giornata · <strong>{formatHoursMinutes(recap.totalSeconds)}</strong>
          </>,
          null,
          ["Rivedi", "OK"],
          <ul className="toast-recap-list">
            {recap.projects.slice(0, RECAP_MAX_PROJECTS).map((project) => (
              <li key={project.id}>
                <span className="toast-recap-dot" style={{ background: project.color ?? "#98a2b3" }} />
                <span className="toast-recap-name">{project.name}</span>
                <span className="toast-recap-time">{formatHoursMinutes(project.seconds)}</span>
              </li>
            ))}
          </ul>,
        );
      }
    }
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
