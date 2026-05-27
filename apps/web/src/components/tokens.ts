export const C = {
  pink: '#F55C7A',
  amber: '#F6B553',
  dark: '#141414',
  dark2: '#282828',
  white: '#FEFEFE',
  bg: '#FBFBFB',
  card: '#FFFFFF',
  border: '#EEEEEE',
  border2: '#E8E8E8',
  text: '#141414',
  mid: '#626262',
  light: '#939393',
  lighter: '#EEEEEE',
  field: '#F9F9F9',
  mint: '#209E46',
} as const;

export const grad = `linear-gradient(135deg, ${C.pink}, ${C.amber})`;
export const gradSubtle = `linear-gradient(135deg, rgba(245,92,122,0.15), rgba(246,181,83,0.15))`;

export const BG_TINTS = ['#f5f0e8', '#e8f0f5', '#f0e8f5', '#e8f5ee', '#f5e8e8', '#eef5e8', '#f5f5e8', '#e8e8f5'];
