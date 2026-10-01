import type { CSSProperties, ReactNode } from 'react';
import { FONT_PUBLIC_SANS } from './OnboardingShell';

/**
 * Brings the onboarding wizard's Public Sans typeface to the rest of the app —
 * every page wraps its own content in this, and App.tsx wraps the nav/Frame
 * chrome and the loading/error states around them, so nothing falls back to
 * Polaris's default font. Only sets the font custom property Polaris's
 * Text/Button read — unlike OnboardingShell's panel, it doesn't pin colour
 * tokens, so normal Polaris theming (including dark mode) still applies here.
 */
export function AppFont({ children }: { children: ReactNode }) {
  return (
    <div
      style={
        {
          '--p-font-family-sans': FONT_PUBLIC_SANS,
          fontFamily: FONT_PUBLIC_SANS,
        } as CSSProperties
      }
    >
      {children}
    </div>
  );
}
