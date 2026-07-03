import type { IconProps } from "./types";

export function IconChart({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect x="3.5" y="10.5" width="3" height="6" rx="1" fill="currentColor" />
      <rect x="8.5" y="6.5" width="3" height="10" rx="1" fill="currentColor" />
      <rect x="13.5" y="3.5" width="3" height="13" rx="1" fill="currentColor" />
    </svg>
  );
}
