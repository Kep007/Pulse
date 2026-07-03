import type { IconProps } from "./types";

export function IconHome({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M10 2.4a1 1 0 0 1 .64.23l7 5.83a1 1 0 0 1 .36.77V17a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-4.5a1 1 0 0 0-1-1h-2a1 1 0 0 0-1 1V17a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V9.23a1 1 0 0 1 .36-.77l7-5.83A1 1 0 0 1 10 2.4Z" />
    </svg>
  );
}
