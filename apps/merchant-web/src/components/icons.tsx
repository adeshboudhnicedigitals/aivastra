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
