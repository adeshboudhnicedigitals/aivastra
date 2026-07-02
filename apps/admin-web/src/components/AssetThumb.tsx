export function AssetThumb({
  thumbnailKey,
  r2Key,
  label,
  w = 64,
  h = 64,
  storageBase,
  onPreview,
  cursor,
}: {
  thumbnailKey?: string;
  r2Key?: string;
  label: string;
  w?: number;
  h?: number;
  storageBase: string | null;
  onPreview?: (url: string) => void;
  cursor?: string;
}) {
  const src = thumbnailKey && storageBase ? `${storageBase}/${thumbnailKey}` : null;
  const fullUrl = r2Key && storageBase ? `${storageBase}/${r2Key}` : null;
  if (src) {
    const img = (
      // biome-ignore lint/performance/noImgElement: admin panel
      <img
        src={src}
        alt={label}
        loading="lazy"
        style={{
          width: w,
          height: h,
          objectFit: 'cover',
          borderRadius: 6,
          flexShrink: 0,
          display: 'block',
          cursor: cursor ?? (fullUrl ? 'zoom-in' : undefined),
        }}
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
    );
    return fullUrl ? (
      <a
        href={fullUrl}
        rel="noreferrer"
        style={{ flexShrink: 0 }}
        onClick={(e) => {
          e.preventDefault();
          onPreview?.(fullUrl);
        }}
      >
        {img}
      </a>
    ) : (
      img
    );
  }
  return (
    <div
      style={{
        width: w,
        height: h,
        borderRadius: 6,
        background: 'var(--subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        color: 'var(--muted)',
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {label.slice(0, 2).toUpperCase()}
    </div>
  );
}
