import type { IconProps } from "./types";

export function IconLock({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect x="4.5" y="8.75" width="11" height="8" rx="2" fill="currentColor" />
      <path
        d="M6.75 8.75V6.5a3.25 3.25 0 0 1 6.5 0v2.25"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}
