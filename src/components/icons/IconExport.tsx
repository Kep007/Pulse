import type { IconProps } from "./types";

/** Arrow leaving a tray — the generic "export" action. */
export function IconExport({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M10 12.5V2.5M6.5 6 10 2.5 13.5 6" />
      <path d="M3.5 11.5v3A2.5 2.5 0 0 0 6 17h8a2.5 2.5 0 0 0 2.5-2.5v-3" />
    </svg>
  );
}
