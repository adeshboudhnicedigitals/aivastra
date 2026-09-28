import type { CSSProperties, ReactNode } from 'react';
import { FONT_PUBLIC_SANS } from './OnboardingShell';

/**
 * Brings the onboarding wizard's Public Sans typeface to the app's main pages,
 * one at a time as they're brought in line with it (Dashboard first). Only
 * sets the font custom property Polaris's Text/Button read — unlike
 * OnboardingShell's panel, it doesn't pin colour tokens, so normal Polaris
 * theming (including dark mode) still applies here.
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
