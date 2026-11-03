import type { CSSProperties, ReactNode } from 'react';
import { FONT_APP } from './OnboardingShell';

/**
 * Brings the app's Inter typeface to the rest of the app —
 * every page wraps its own content in this, and App.tsx wraps the nav/Frame
 * chrome and the loading/error states around them, so nothing falls back to
 * Polaris's default font. Only sets the font custom property Polaris's
 * Text/Button read — unlike OnboardingShell's panel, it doesn't pin colour
 * tokens, so normal Polaris theming (including dark mode) still applies here.
 */
export function AppFont({ children }: { children: ReactNode }) {
  return (
    <div
      className="av-app"
      style={
        {
          '--p-font-family-sans': FONT_APP,
          fontFamily: FONT_APP,
        } as CSSProperties
      }
    >
      {children}
    </div>
  );
}
