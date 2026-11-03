import type { ReactNode } from 'react';

/** Icon tile + title + subtitle that opens an onboarding page. */
export function PageHead({
  icon,
  title,
  subtitle,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="av-head">
      <span className="av-tile" aria-hidden>
        {icon}
      </span>
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

/** Lavender info strip with an (i) glyph. */
export function Note({ children }: { children: ReactNode }) {
  return (
    <div className="av-note">
      <Glyph size={24}>
        <circle cx="12" cy="12" r="9.5" />
        <path d="M12 11v5.5M12 7.6v.1" />
      </Glyph>
      <span>{children}</span>
    </div>
  );
}

/** 24px-grid stroke icon wrapper so pages only supply the path data. */
export function Glyph({ size = 40, children }: { size?: number; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: decorative
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}
