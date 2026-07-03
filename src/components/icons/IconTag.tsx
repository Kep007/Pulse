import type { IconProps } from "./types";

export function IconTag({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M3 4a1 1 0 0 1 1-1h5.34a1 1 0 0 1 .71.3l6.65 6.66a1 1 0 0 1 0 1.4l-5.35 5.35a1 1 0 0 1-1.41 0L3.3 10.05a1 1 0 0 1-.3-.7V4Z" />
      <circle cx="6.6" cy="6.6" r="1.3" fill="#fff" />
    </svg>
  );
}
