import type { ReactNode } from 'react';

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const FlaskIcon = () => (
  <Icon>
    <path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2.2h12.4a1.5 1.5 0 0 0 1.3-2.2L14 9V3" />
  </Icon>
);

export const CheckIcon = () => (
  <Icon>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
);

export const AlertIcon = () => (
  <Icon>
    <path d="M12 3l9.5 17h-19L12 3zM12 10v4M12 17.2v.1" />
  </Icon>
);

export const ClockIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Icon>
);

export const TodayIcon = () => (
  <Icon>
    <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Icon>
);

export const SettingsIcon = () => (
  <Icon>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="8" cy="17" r="2" />
  </Icon>
);

export const PlanIcon = () => (
  <Icon>
    <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
  </Icon>
);

export const CourseIcon = () => (
  <Icon>
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H12v15H5.5A1.5 1.5 0 0 0 4 20.5zM20 5.5A1.5 1.5 0 0 0 18.5 4H12v15h6.5a1.5 1.5 0 0 1 1.5 1.5z" />
  </Icon>
);

export const ExamIcon = () => (
  <Icon>
    <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3zM9 12l2.2 2.2L15.5 10" />
  </Icon>
);

export const PracticeIcon = () => (
  <Icon>
    <path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />
  </Icon>
);

export const AdminIcon = () => (
  <Icon>
    <path d="M9 4h6v3H9zM7 5.5H6a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6.5a1 1 0 0 0-1-1h-1M9 12h6M9 16h4" />
  </Icon>
);

export const CvIcon = () => (
  <Icon>
    <path d="M6 3h8l4 4v14H6zM14 3v4h4M9 13h6M9 17h4" />
  </Icon>
);

export const CircleIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="8" />
  </Icon>
);

export const HalfCircleIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" />
  </Icon>
);

export const PinIcon = () => (
  <Icon>
    <path d="M9 4h6l-1 6 3 3H7l3-3-1-6zM12 13v7" />
  </Icon>
);

export const SkipIcon = () => (
  <Icon>
    <path d="M5 6l8 6-8 6zM17 6v12" />
  </Icon>
);

export const WeekIcon = () => (
  <Icon>
    <path d="M4 20V10M10 20V5M16 20v-7M22 20H2" />
  </Icon>
);

export const ArrowUpIcon = () => (
  <Icon>
    <path d="M12 20V5M6 11l6-6 6 6" />
  </Icon>
);

export const ReturnIcon = () => (
  <Icon>
    <path d="M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" />
  </Icon>
);

export const ChevronLeftIcon = () => (
  <Icon>
    <path d="M15 5l-7 7 7 7" />
  </Icon>
);

export const ChevronRightIcon = () => (
  <Icon>
    <path d="M9 5l7 7-7 7" />
  </Icon>
);

export const LockIcon = () => (
  <Icon>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Icon>
);
