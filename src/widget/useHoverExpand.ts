import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { cursorPosition, currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef } from "react";

const COLLAPSE_GRACE_MS = 400;
const HOVER_POLL_MS = 150;
const RESIZE_ANIMATION_MS = 220;
const RESIZE_FRAME_MS = 16;

export type SizeSpec = { width: number; height: number };

function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3;
}

function lerp(from: number, to: number, t: number) {
  return from + (to - from) * t;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Animates the widget window to `targetSize` over a short tween — Tauri has
 * no native window-resize animation API, so this steps setSize/setPosition
 * across a handful of frames with an easing curve — while keeping whichever
 * screen corner it's docked to visually fixed. Tauri always resizes from the
 * top-left origin, so the anchor edges (whichever half of the monitor the
 * window currently sits in) have to be recomputed once up front and
 * interpolated toward alongside the size, otherwise growing the window
 * would drift away from its corner instead of expanding toward it.
 */
export function useHoverExpand(targetSize: SizeSpec, enabled: boolean) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;

    async function animateToTarget() {
      const win = getCurrentWindow();
      const scale = await win.scaleFactor();
      const [physicalPosition, physicalSize, monitor] = await Promise.all([
        win.outerPosition(),
        win.outerSize(),
        currentMonitor(),
      ]);
      if (cancelled) {
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

      const steps = Math.max(1, Math.round(RESIZE_ANIMATION_MS / RESIZE_FRAME_MS));

      for (let step = 1; step <= steps; step++) {
        if (cancelled) {
          return;
        }

        const t = easeOutCubic(step / steps);
        const width = Math.round(lerp(startSize.width, targetSize.width, t));
        const height = Math.round(lerp(startSize.height, targetSize.height, t));
        const x = Math.round(lerp(startPosition.x, endX, t));
        const y = Math.round(lerp(startPosition.y, endY, t));

        await Promise.all([
          win.setSize(new LogicalSize(width, height)),
          win.setPosition(new LogicalPosition(x, y)),
        ]);

        if (step < steps) {
          await wait(RESIZE_FRAME_MS);
        }
      }
    }

    animateToTarget().catch((error) => console.error("Unable to resize widget", error));

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
