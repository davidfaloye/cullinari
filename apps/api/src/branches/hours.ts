import type { BranchHours } from '../db/schema';

/** Day of week (0 = Sunday) and HH:MM for `now` in an IANA timezone. */
export function localDayAndTime(timezone: string, now = new Date()): { day: number; time: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return { day: days.indexOf(get('weekday')), time: `${get('hour')}:${get('minute')}` };
}

/**
 * No hours set means always open. A day missing or null means closed that day.
 * Closing times past midnight (e.g. 18:00-02:00) are supported.
 */
export function isOpenNow(hours: BranchHours | null | undefined, timezone: string, now = new Date()): boolean {
  if (!hours || Object.keys(hours).length === 0) return true;
  const { day, time } = localDayAndTime(timezone, now);
  const today = hours[String(day)];
  const yesterday = hours[String((day + 6) % 7)];

  if (today) {
    if (today.open <= today.close && time >= today.open && time < today.close) return true;
    if (today.open > today.close && time >= today.open) return true;
  }
  if (yesterday && yesterday.open > yesterday.close && time < yesterday.close) return true;
  return false;
}
