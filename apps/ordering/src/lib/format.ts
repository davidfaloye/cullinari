export function money(minor: number, currency = 'NGN') {
  try {
    return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 0 }).format(minor / 100);
  } catch {
    // Older Android JS engines without full Intl
    return `${currency === 'NGN' ? '₦' : `${currency} `}${Math.round(minor / 100).toLocaleString()}`;
  }
}

export function shortDate(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}`;
}

/** "Mon 09:00–21:00" for today's hours, or null when no hours are set. */
export function todaysHours(hours: Record<string, { open: string; close: string } | null> | null): string | null {
  if (!hours || !Object.keys(hours).length) return null;
  const today = hours[String(new Date().getDay())];
  return today ? `Today ${today.open}–${today.close}` : 'Closed today';
}
