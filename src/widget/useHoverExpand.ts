import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { cursorPosition, currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef } from "react";

const COLLAPSE_GRACE_MS = 400;
const HOVER_POLL_MS = 150;

export type SizeSpec = { width: number; height: number };

/**
 * Resizes the widget window to `targetSize` instantly, keeping whichever
 * screen corner it's docked to visually fixed. Tauri always resizes from the
 * top-left origin, so the anchor edges (whichever half of the monitor the
 * window currently sits in) have to be recomputed each time, otherwise
 * growing the window would drift away from its corner instead of expanding
 * toward it.
 *
 * No animation: each call awaits a handful of async round trips to the
 * Tauri backend (outerPosition/outerSize/currentMonitor) before applying.
 * When targetSize changes again — e.g. the automatic project detector
 * switching projects — before an in-flight call's round trips resolve, the
 * stale call would previously still land, sometimes after the newer one,
 * leaving the window sized for an earlier (often shorter) project name
 * while the newer, longer name rendered inside it — truncating it and
 * crowding its trailing padding. The call-id guard below discards any
 * resize whose request is no longer the latest by the time its data comes
 * back, so only the most recent target ever actually gets applied.
 */
export function useHoverExpand(targetSize: SizeSpec, enabled: boolean) {
  const latestCallId = useRef(0);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const callId = ++latestCallId.current;

    async function applyTarget() {
      const win = getCurrentWindow();
      const scale = await win.scaleFactor();
      const [physicalPosition, physicalSize, monitor] = await Promise.all([
        win.outerPosition(),
        win.outerSize(),
        currentMonitor(),
      ]);
      if (callId !== latestCallId.current) {
        return;
      }

      const startPosition = physicalPosition.toLogical(scale);
      const startSize = physicalSize.toLogical(scale);
      const monitorSize = monitor ? monitor.size.toLogical(scale) : null;

      const currentRight = startPosition.x + startSize.width;
      const currentBottom = startPosition.y + startSize.height;
      const anchorRight = monitorSize ? currentRight > monitorSize.width / 2 : false;
      const anchorBottom = monitorSize ? currentBottom > monitorSize.height / 2 : false;

      const endX = anchorRight ? currentRight - targetSize.width : startPosition.x;
      const endY = anchorBottom ? currentBottom - targetSize.height : startPosition.y;

      await Promise.all([
        win.setSize(new LogicalSize(targetSize.width, targetSize.height)),
        win.setPosition(new LogicalPosition(endX, endY)),
      ]);
    }

    applyTarget().catch((error) => console.error("Unable to resize widget", error));
  }, [targetSize.width, targetSize.height, enabled]);
}

/**
 * Tracks whether the cursor is over the window by polling the OS cursor
 * position against the window's own bounds, rather than DOM
 * mouseenter/mouseleave — those stop firing reliably once the window loses
 * OS focus (which it constantly does, since it's an always-on-top utility
 * widget sitting over whatever app the user is actually working in), so a
 * mouseleave while the widget still has the mouse over it but not focus
 * would never arrive and the widget would stay expanded forever.
 */
export function useHoverIntent(onChange: (hovered: boolean) => void) {
  const collapseTimer = useRef<number | null>(null);
  const isHoveredRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const win = getCurrentWindow();
        const [cursor, position, size] = await Promise.all([
          cursorPosition(),
          win.outerPosition(),
          win.outerSize(),
        ]);
        if (cancelled) {
          return;
        }

        const inside =
          cursor.x >= position.x &&
          cursor.x <= position.x + size.width &&
          cursor.y >= position.y &&
          cursor.y <= position.y + size.height;

        if (inside) {
          if (collapseTimer.current !== null) {
            window.clearTimeout(collapseTimer.current);
            collapseTimer.current = null;
          }
          if (!isHoveredRef.current) {
            isHoveredRef.current = true;
            onChange(true);
          }
        } else if (isHoveredRef.current && collapseTimer.current === null) {
          collapseTimer.current = window.setTimeout(() => {
            collapseTimer.current = null;
            isHoveredRef.current = false;
            onChange(false);
          }, COLLAPSE_GRACE_MS);
        }
      } catch (error) {
        console.error("Unable to poll cursor position", error);
      }
    }

    const intervalId = window.setInterval(() => void poll(), HOVER_POLL_MS);
    void poll();

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      if (collapseTimer.current !== null) {
        window.clearTimeout(collapseTimer.current);
      }
    };
  }, [onChange]);
}
