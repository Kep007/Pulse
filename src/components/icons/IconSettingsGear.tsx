import type { IconProps } from "./types";

export function IconSettingsGear({ size = 16, className }: IconProps) {
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
        d="m8.6 3 .5-1.4h1.8L11.4 3a6.6 6.6 0 0 1 1.9.8l1.5-.6 1.3 1.3-.6 1.5c.4.6.6 1.2.8 1.9l1.4.5v1.8l-1.4.5a6.6 6.6 0 0 1-.8 1.9l.6 1.5-1.3 1.3-1.5-.6a6.6 6.6 0 0 1-1.9.8l-.5 1.4H8.9L8.4 17a6.6 6.6 0 0 1-1.9-.8l-1.5.6-1.3-1.3.6-1.5a6.6 6.6 0 0 1-.8-1.9L2 11.6V9.8l1.4-.5c.2-.7.4-1.3.8-1.9l-.6-1.5 1.3-1.3 1.5.6c.6-.4 1.2-.6 1.9-.8Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
