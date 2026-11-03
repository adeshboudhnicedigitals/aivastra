import { useState } from 'react';

interface NameAvatarProps {
  name: string;
  email?: string;
  size?: number;
  /** Uploaded profile picture; falls back to initials when absent or failing to load. */
  imageUrl?: string | null;
}

export function NameAvatar({ name, email, size = 32, imageUrl }: NameAvatarProps) {
  const [broken, setBroken] = useState(false);
  const initials = name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('');

  let h = 0;
  for (const c of name) {
    h = (h * 31 + c.charCodeAt(0)) % 360;
  }

  return (
    <span
      style={{
        display: 'inline-grid',
        placeItems: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        background: `oklch(0.82 0.06 ${h})`,
        color: `oklch(0.32 0.10 ${h})`,
        fontSize: size * 0.4,
        fontWeight: 500,
        flexShrink: 0,
        overflow: 'hidden',
      }}
      title={email}
    >
      {imageUrl && !broken ? (
        // biome-ignore lint/performance/noImgElement: short-lived presigned storage URL
        <img
          src={imageUrl}
          alt=""
          onError={() => setBroken(true)}
          style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }}
        />
      ) : (
        initials
      )}
    </span>
  );
}
