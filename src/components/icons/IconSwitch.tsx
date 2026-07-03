import type { IconProps } from "./types";

export function IconSwitch({ size = 16, className }: IconProps) {
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
        d="M4 7.5h9.5M13.5 7.5 10.5 4.5M13.5 7.5 10.5 10.5M16 12.5H6.5M6.5 12.5 9.5 9.5M6.5 12.5 9.5 15.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
