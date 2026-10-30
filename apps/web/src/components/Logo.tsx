interface LogoProps {
  className?: string;
  /** Accessible name. Pass `null` when the logo sits next to the app name as decoration. */
  title?: string | null;
}

/** Three blocks stepping up. Colour comes from `currentColor`, which defaults to the accent token. */
export function Logo({ className = 'size-8 text-accent', title = 'Skillstack' }: LogoProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      fill="currentColor"
      role={title === null ? undefined : 'img'}
      aria-label={title ?? undefined}
      aria-hidden={title === null ? true : undefined}
      focusable="false"
    >
      <rect x="4" y="42" width="18" height="18" rx="4.5" opacity=".45" />
      <rect x="23" y="23" width="18" height="18" rx="4.5" opacity=".72" />
      <rect x="42" y="4" width="18" height="18" rx="4.5" opacity="1" />
    </svg>
  );
}
