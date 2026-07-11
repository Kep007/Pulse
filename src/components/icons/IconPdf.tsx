import type { IconProps } from "./types";

/** Minimal filled document with a folded corner — the "PDF" mark for the
 *  export button; the wording next to it says the format, the glyph stays
 *  clean at small sizes. */
export function IconPdf({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M6 1.5h5.2L16.5 6.8V16A2.5 2.5 0 0 1 14 18.5H6A2.5 2.5 0 0 1 3.5 16V4A2.5 2.5 0 0 1 6 1.5z"
        fill="currentColor"
      />
      <path d="M11.2 1.5v5.3h5.3" fill="currentColor" opacity="0.35" />
      <path
        d="M6.4 11h7.2M6.4 14h4.8"
        stroke="#ffffff"
        strokeWidth="1.3"
        strokeLinecap="round"
        opacity="0.9"
      />
    </svg>
  );
}
