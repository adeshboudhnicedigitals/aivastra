// Brand tokens for the AiVastra Shopify admin app — values taken verbatim
// from the approved design (AiVastra Shopify App Design Brief), which itself
// mirrors the gradient in apps/catalogues-web/src/components/tokens.ts (`grad`).
export const BRAND = {
  logoGradient: 'linear-gradient(91.84deg,#521D9C 0.33%,#BD2587 50.77%,#F96657 99.67%)',
  buttonGradient: 'linear-gradient(135deg,#7C3AED 0%,#BD2587 100%)',
  purple: '#7C3AED',
  purpleDark: '#6423C4',
  purpleTint: '#F1E8FC',
  purpleBorder: 'rgba(124,58,237,0.25)',

  ink: '#18121F',
  inkSoft: '#3A3444',
  textMuted: '#6B6478',
  textFaint: '#948DA0',
  textPlaceholder: '#AFA9BC',

  bg: '#F5F4F8',
  card: '#FFFFFF',
  border: 'rgba(23,15,38,0.07)',
  borderStrong: 'rgba(23,15,38,0.14)',
  borderInput: 'rgba(23,15,38,0.12)',
  hoverTint: 'rgba(23,15,38,0.05)',

  success: '#22A55A',
  successText: '#127A42',
  successBg: '#E4F6EA',
  warning: '#F0684B',
  warningText: '#C9502B',
  warningBg: '#FDE7E1',
  danger: '#E0334F',
  dangerStrong: '#C81E3A',
  dangerBg: '#FBE4E4',
  disabledDot: '#A9A3B5',
  disabledBg: '#EDEBF0',
  disabledText: '#6B6478',
} as const;

export const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
