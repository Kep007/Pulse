import type { IconProps } from "./types";

/** A small grid — spreadsheet formats (CSV / Excel). */
export function IconSheet({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="2.5" y="3" width="15" height="14" rx="2.5" />
      <path d="M2.5 8h15M2.5 12.5h15M8 8v9" />
    </svg>
  );
}
