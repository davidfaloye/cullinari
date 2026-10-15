export function money(minor: number, currency = 'NGN') {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 0 }).format(minor / 100);
}

/** Form fields take naira; the API takes kobo. */
export const toMinor = (major: string | number) => Math.round(Number(major) * 100);
export const toMajor = (minor: number) => (minor / 100).toString();

export function timeAgo(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
}

export function clock(iso: string) {
  return new Date(iso).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
}

export function qty(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '');
}
