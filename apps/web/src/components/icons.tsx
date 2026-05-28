import { C } from './tokens';

type Paths = string | string[];

export const Icon = ({
  d,
  size = 16,
  color = 'currentColor',
  viewBox = '0 0 24 24',
  stroke = true,
  fill = false,
}: {
  d: Paths;
  size?: number;
  color?: string;
  viewBox?: string;
  stroke?: boolean;
  fill?: boolean;
}) => (
  <svg
    width={size}
    height={size}
    viewBox={viewBox}
    fill={fill ? color : 'none'}
    stroke={stroke ? color : 'none'}
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
);

export const MailIcon = () => (
  <Icon d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z M22 6l-10 7L2 6" />
);
export const LockIcon = () => (
  <Icon
    d={[
      'M19 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2z',
      'M7 11V7a5 5 0 0110 0v4',
    ]}
  />
);
export const UserIcon = () => (
  <Icon d={['M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2', 'M12 11a4 4 0 100-8 4 4 0 000 8z']} />
);
export const Eye = () => (
  <Icon
    d={[
      'M1 12s4-8 11-8 11 8 11 8',
      'M1 12s4 8 11 8 11-8 11-8',
      'M12 12m-3 0a3 3 0 106 0 3 3 0 10-6 0',
    ]}
  />
);
export const EyeOff = () => (
  <Icon
    d={[
      'M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94',
      'M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19',
      'M1 1l22 22',
    ]}
  />
);
export const StudioIcon = () => (
  <Icon d={['M12 20h9', 'M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z']} size={18} />
);
export const CatalogueIcon = () => <Icon d="M4 6h16M4 10h16M4 14h16M4 18h16" size={18} />;
export const AssetsIcon = () => (
  <Icon
    d={[
      'M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z',
      'M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12',
    ]}
    size={18}
  />
);
export const PricingIcon = () => (
  <Icon
    d="M12 2a10 10 0 100 20A10 10 0 0012 2zm0 0v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"
    size={18}
  />
);
export const CheckIcon = ({ color = C.pink, size = 16 }: { color?: string; size?: number }) => (
  <Icon d="M20 6L9 17l-5-5" size={size} color={color} />
);
export const XIcon = ({ size = 16 }: { size?: number }) => (
  <Icon d="M18 6L6 18M6 6l12 12" size={size} />
);
export const DownloadIcon = () => (
  <Icon d={['M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3']} />
);
export const SearchIcon = () => (
  <Icon d={['M11 19a8 8 0 100-16 8 8 0 000 16z', 'M21 21l-4.35-4.35']} />
);
export const ChevronRight = () => <Icon d="M9 18l6-6-6-6" />;
export const ChevronDown = () => <Icon d="M6 9l6 6 6-6" />;
export const ArrowLeft = () => <Icon d="M19 12H5M12 19l-7-7 7-7" size={20} />;
export const SortIcon = () => <Icon d={['M3 6h18', 'M7 12h10', 'M11 18h4']} />;
export const FilterIcon = () => <Icon d={['M22 3H2l8 9.46V19l4 2v-8.54L22 3z']} />;
export const UploadIcon = ({ size = 16 }: { size?: number }) => (
  <Icon d={['M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4', 'M17 8l-5-5-5 5', 'M12 3v12']} size={size} />
);
export const SparkleIcon = () => (
  <Icon d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" size={14} />
);
export const FullscreenIcon = () => (
  <Icon
    d={[
      'M8 3H5a2 2 0 00-2 2v3',
      'M21 8V5a2 2 0 00-2-2h-3',
      'M3 16v3a2 2 0 002 2h3',
      'M16 21h3a2 2 0 002-2v-3',
    ]}
  />
);
export const DotsIcon = () => (
  <Icon
    d="M12 5a1 1 0 100-2 1 1 0 000 2zm0 7a1 1 0 100-2 1 1 0 000 2zm0 7a1 1 0 100-2 1 1 0 000 2z"
    fill
    stroke={false}
  />
);
export const PlusIcon = ({ size = 14 }: { size?: number }) => (
  <Icon d="M12 5v14M5 12h14" size={size} />
);
export const SettingsIcon = () => (
  <Icon
    d={[
      'M12 15a3 3 0 100-6 3 3 0 000 6z',
      'M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z',
    ]}
    size={18}
  />
);
export const LogOutIcon = () => (
  <Icon d={['M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4', 'M16 17l5-5-5-5', 'M21 12H9']} />
);
export const GiftIcon = () => (
  <Icon
    d={[
      'M20 12v10H4V12',
      'M22 7H2v5h20V7z',
      'M12 22V7',
      'M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z',
      'M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z',
    ]}
  />
);
export const MoonIcon = () => <Icon d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />;
export const SunIcon = () => (
  <Icon
    d={[
      'M12 1v2',
      'M12 21v2',
      'M4.22 4.22l1.42 1.42',
      'M18.36 18.36l1.42 1.42',
      'M1 12h2',
      'M21 12h2',
      'M4.22 19.78l1.42-1.42',
      'M18.36 5.64l1.42-1.42',
      'M12 17a5 5 0 100-10 5 5 0 000 10z',
    ]}
  />
);
export const TrashIcon = () => (
  <Icon
    d={[
      'M3 6h18',
      'M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6',
      'M10 11v6M14 11v6',
      'M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2',
    ]}
    size={14}
  />
);
export const SpinnerIcon = ({ size = 20 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="av-spin"
  >
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);
export const GridIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
  </svg>
);
