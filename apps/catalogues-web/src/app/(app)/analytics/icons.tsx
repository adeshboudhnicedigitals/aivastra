import { C, M } from '@/components/tokens';

// Inline SVGs copied from the approved design. All are decorative (aria-hidden);
// the controls and headings that contain them carry the accessible names.

type IconProps = { size?: number; stroke?: string; strokeWidth?: number };

function Base({
  size = 24,
  stroke = 'currentColor',
  strokeWidth = 2,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function GarmentIcon(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M12 8V7a2 2 0 1 0-2-2" />
      <path d="M12 8l9 6.5a1 1 0 0 1-.6 1.8H3.6a1 1 0 0 1-.6-1.8z" />
    </Base>
  );
}

export function UsersIcon(p: IconProps) {
  return (
    <Base {...p}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M17 14c2.5 0 4.5 1.7 4.5 4.5" />
    </Base>
  );
}

export function PhoneIcon(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />
    </Base>
  );
}

export function RepeatIcon(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v5h-5" />
    </Base>
  );
}

export function UserPlusIcon(p: IconProps) {
  return (
    <Base {...p}>
      <circle cx="10" cy="8" r="3.5" />
      <path d="M3.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M19 8v6M16 11h6" />
    </Base>
  );
}

export function BarsIcon(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M5 20V12M12 20V5M19 20v-5" />
    </Base>
  );
}

export function CalendarIcon(p: IconProps) {
  return (
    <Base {...p}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </Base>
  );
}

export function DownloadIcon(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M12 4v11M7 11l5 5 5-5M4 20h16" />
    </Base>
  );
}

export function SearchIcon(p: IconProps) {
  return (
    <Base {...p}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
    </Base>
  );
}

export function CrownIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"
        fill={C.amber}
        stroke={M.warning}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TriangleIcon({ up }: { up: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
      <path d={up ? 'M12 5l8 14H4z' : 'M12 19L4 5h16z'} fill="currentColor" />
    </svg>
  );
}
