import { useStore } from './store';

/** Neutral palette; the restaurant's primary and accent colours are layered on top. */
export const base = {
  bg: '#f7f7f5',
  surface: '#ffffff',
  surface2: '#efefec',
  ink: '#1a1c1b',
  muted: '#62686a',
  line: '#e2e3df',
  bad: '#b3261e',
  badSoft: '#fbe2df',
  warnSoft: '#fdf0d5',
  warn: '#8a5300',
  radius: 14,
};

/** Picks black or white text for a background colour (WCAG relative luminance). */
export function onColor(hex: string): string {
  const n = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.4 ? '#14171a' : '#ffffff';
}

/** Mixes a colour toward white for soft backgrounds (amount 0-1). */
export function tint(hex: string, amount: number): string {
  const n = hex.replace('#', '');
  const mix = (i: number) => Math.round(parseInt(n.slice(i, i + 2), 16) + (255 - parseInt(n.slice(i, i + 2), 16)) * amount);
  return `#${[0, 2, 4].map((i) => mix(i).toString(16).padStart(2, '0')).join('')}`;
}

export function useTheme() {
  const { theme } = useStore();
  return {
    ...base,
    primary: theme.primary,
    onPrimary: onColor(theme.primary),
    primarySoft: tint(theme.primary, 0.88),
    accent: theme.accent,
    onAccent: onColor(theme.accent),
  };
}
