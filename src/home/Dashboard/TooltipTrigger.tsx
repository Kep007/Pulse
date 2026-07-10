import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";

type Placement = "top" | "bottom";

type TooltipTriggerProps = {
  className: string;
  style?: CSSProperties;
  ariaLabel: string;
  renderTooltip: () => ReactNode;
  children?: ReactNode;
};

// Rough worst-case height (title + total + up to 6 breakdown rows) used to
// decide whether there's room to open upward — doesn't need to be exact,
// just enough to avoid picking "top" right before the tooltip would clip.
const TOOLTIP_HEIGHT_BUDGET = 190;
const VIEWPORT_MARGIN = 12;

// Renders the hover/focus tooltip through a portal positioned with
// `position: fixed`, rather than as an absolutely-positioned child of the
// trigger. That keeps it out of any scrollable ancestor's content box
// entirely — inside one (like the heatmap's horizontally-scrolling grid), a
// child that visually overflows the box forces the browser to also treat
// the *other* axis as scrollable, and clips or introduces an unwanted
// scrollbar depending on which way it opens. Placement (above/below) is
// picked per-trigger from the actual space available at hover time, so a
// button near the top of the viewport opens downward and one near the
// bottom opens upward, automatically.
export function TooltipTrigger({
  className,
  style,
  ariaLabel,
  renderTooltip,
  children,
}: TooltipTriggerProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const [portal, setPortal] = useState<{ left: number; top: number; placement: Placement } | null>(
    null,
  );

  // `left` centers the tooltip on the trigger (translate(-50%)), which near
  // the window's left/right edge would push part of it off-screen — and with
  // `width: max-content` (see .cell-tooltip-portal) there's no longer any
  // shrink-to-fit to hide that. Nudge it back inside after it has rendered,
  // when its real width is known; written straight to the DOM to avoid a
  // re-render loop.
  useLayoutEffect(() => {
    const el = portalRef.current;
    if (!el || !portal) {
      return;
    }
    const half = el.offsetWidth / 2;
    const clamped = Math.min(
      Math.max(portal.left, VIEWPORT_MARGIN + half),
      window.innerWidth - VIEWPORT_MARGIN - half,
    );
    if (clamped !== portal.left) {
      el.style.left = `${clamped}px`;
    }
  }, [portal]);

  function show() {
    const el = ref.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const placement: Placement = rect.top >= TOOLTIP_HEIGHT_BUDGET + VIEWPORT_MARGIN ? "top" : "bottom";
    setPortal({
      left: rect.left + rect.width / 2,
      top: placement === "top" ? rect.top - 8 : rect.bottom + 8,
      placement,
    });
  }

  function hide() {
    setPortal(null);
  }

  return (
    <>
      <button
        ref={ref}
        type="button"
        className={className}
        style={style}
        aria-label={ariaLabel}
        onMouseEnter={show}
        onFocus={show}
        onMouseLeave={hide}
        onBlur={hide}
      >
        {children}
      </button>
      {portal
        ? createPortal(
            <div
              ref={portalRef}
              className={`cell-tooltip-portal cell-tooltip-portal-${portal.placement}`}
              style={{ left: portal.left, top: portal.top }}
            >
              {renderTooltip()}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
