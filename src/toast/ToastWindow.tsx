import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";
import { confirmPendingSuggestion, denyPendingSuggestion, getCurrentState } from "../lib/tauri";
import type { PendingSuggestion, ToastMessage, TrackingState } from "../lib/types";
import "./toast.css";

const MARGIN = 16;
const INFO_SIZE = { width: 300, height: 56 };
const CONFIRM_SIZE = { width: 320, height: 122 };
const INFO_LIFETIME_MS = 3200;

type Display =
  | { kind: "info"; text: string }
  | { kind: "confirm"; suggestion: PendingSuggestion };

export function ToastWindow() {
  const [display, setDisplay] = useState<Display | null>(null);
  const dismissTimer = useRef<number | null>(null);

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
    let cancelled = false;

    async function applyVisibility() {
      const win = getCurrentWindow();

      if (!display) {
        await win.hide();
        return;
      }

      const size = display.kind === "confirm" ? CONFIRM_SIZE : INFO_SIZE;
      const scale = await win.scaleFactor();
      const monitor = await currentMonitor();
      if (cancelled) {
        return;
      }

      await win.setSize(new LogicalSize(size.width, size.height));

      if (monitor) {
        const monitorSize = monitor.size.toLogical(scale);
        const monitorPosition = monitor.position.toLogical(scale);
        await win.setPosition(
          new LogicalPosition(
            monitorPosition.x + MARGIN,
            monitorPosition.y + monitorSize.height - size.height - MARGIN,
          ),
        );
      }

      await win.show();
    }

    applyVisibility().catch((error) => console.error("Unable to show toast window", error));

    return () => {
      cancelled = true;
    };
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
