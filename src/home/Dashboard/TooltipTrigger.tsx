import { useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";

type Placement = "top" | "bottom";

type TooltipTriggerProps = {
  className: string;
  style?: CSSProperties;
  ariaLabel: string;
  renderTooltip: () => ReactNode;
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
export function TooltipTrigger({ className, style, ariaLabel, renderTooltip }: TooltipTriggerProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const [portal, setPortal] = useState<{ left: number; top: number; placement: Placement } | null>(
    null,
  );

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
      />
      {portal
        ? createPortal(
            <div
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
