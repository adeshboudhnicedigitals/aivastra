export const Colors = {
  light: {
    bg: '#F8F7FC',
    bgSecondary: '#F0EEF8',
    surface: '#FFFFFF',
    surfaceElevated: '#FFFFFF',
    surfaceVariant: '#EAE6F4',
    glass: 'rgba(255,255,255,0.84)',
    text: '#1D1A24',
    textSecondary: '#625D6B',
    textMuted: '#8C8596',
    border: '#DED9E8',
    accent: '#6750A4',
    accentContainer: '#EADDFF',
    onAccent: '#FFFFFF',
    onAccentContainer: '#21005D',
    accentSecondary: '#F35D7F',
    success: '#1E8E5A',
    warning: '#A86400',
    error: '#BA1A1A',
    info: '#3567B7',
    shadow: 'rgba(35,25,66,0.12)',
    errorContainer: '#FFDAD6',
    warningContainer: '#FFDEA6',
    successContainer: '#B8F3D2',
    infoContainer: '#D8E2FF',
  },
  dark: {
    bg: '#121016',
    bgSecondary: '#1C1922',
    surface: '#211E27',
    surfaceElevated: '#2A2632',
    surfaceVariant: '#332E3C',
    glass: 'rgba(42,38,50,0.88)',
    text: '#F0EAF4',
    textSecondary: '#CAC3D0',
    textMuted: '#938C9A',
    border: '#46404F',
    accent: '#D0BCFF',
    accentContainer: '#4F378B',
    onAccent: '#381E72',
    onAccentContainer: '#EADDFF',
    accentSecondary: '#FFB1C1',
    success: '#72D69E',
    warning: '#FFB95C',
    error: '#FFB4AB',
    info: '#AFC6FF',
    shadow: 'rgba(0,0,0,0.34)',
    errorContainer: '#5F1717',
    warningContainer: '#4B3412',
    successContainer: '#133D2B',
    infoContainer: '#20375F',
  },
} as const;

export type AppColors = typeof Colors.light | typeof Colors.dark;

export const Spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 };
export const Radius = { sm: 8, md: 12, lg: 18, xl: 24, xxl: 32, full: 9999 };
// Floating tab bar (position: 'absolute') is 72px tall with a 12px bottom margin —
// screens must add this much bottom padding (on top of the safe-area inset) or
// their last row/button renders behind it.
export const TabBarClearance = 100;
export const Elevation = {
  soft: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 4,
  },
};
export const Typography = {
  display: { fontSize: 34, fontWeight: '800' as const, lineHeight: 40, letterSpacing: -0.8 },
  h1: { fontSize: 28, fontWeight: '800' as const, lineHeight: 34, letterSpacing: -0.5 },
  h2: { fontSize: 22, fontWeight: '700' as const, lineHeight: 28, letterSpacing: -0.2 },
  h3: { fontSize: 18, fontWeight: '700' as const, lineHeight: 24 },
  body: { fontSize: 15, fontWeight: '400' as const, lineHeight: 22 },
  bodyBold: { fontSize: 15, fontWeight: '700' as const, lineHeight: 22 },
  caption: { fontSize: 13, fontWeight: '400' as const, lineHeight: 18 },
  captionBold: { fontSize: 13, fontWeight: '700' as const, lineHeight: 18 },
  label: { fontSize: 11, fontWeight: '700' as const, lineHeight: 16, letterSpacing: 0.5 },
  code: { fontSize: 12, fontFamily: 'monospace', lineHeight: 16 },
};
