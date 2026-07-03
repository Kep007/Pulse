import type { IconProps } from "./types";

export function IconPlay({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path d="M6 4.2c0-.9 1-1.5 1.8-1l8.4 5.8c.7.5.7 1.5 0 2l-8.4 5.8c-.8.5-1.8-.1-1.8-1V4.2Z" fill="currentColor" />
    </svg>
  );
}
