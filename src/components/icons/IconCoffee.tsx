import type { IconProps } from "./types";

/** A cup — the scheduled (lunch) break. */
export function IconCoffee({ size = 16, className }: IconProps) {
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
      <path d="M3.5 8h10v4.5a4 4 0 0 1-4 4h-2a4 4 0 0 1-4-4V8z" />
      <path d="M13.5 9.5h1a2 2 0 0 1 0 4h-1.2" />
      <path d="M7 2.5c-.6.7-.6 1.5 0 2.2M10 2.5c-.6.7-.6 1.5 0 2.2" />
    </svg>
  );
}
