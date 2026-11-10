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
    aria-hidden="true"
    width={size}
    height={size}
    viewBox={viewBox}
    fill={fill ? color : 'none'}
    stroke={stroke ? color : 'none'}
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {Array.isArray(d) ? d.map((p) => <path key={p} d={p} />) : <path d={d} />}
  </svg>
);

export const XIcon = ({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) => (
  <Icon d="M18 6L6 18M6 6l12 12" size={size} color={color} />
);
export const ArrowLeft = () => <Icon d="M19 12H5M12 19l-7-7 7-7" size={20} />;
export const UploadIcon = ({ size = 16 }: { size?: number }) => (
  <Icon d={['M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4', 'M17 8l-5-5-5 5', 'M12 3v12']} size={size} />
);
export const PlusIcon = ({ size = 14 }: { size?: number }) => (
  <Icon d="M12 5v14M5 12h14" size={size} />
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
    aria-hidden="true"
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
