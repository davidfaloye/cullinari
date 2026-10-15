import type { PublicMenu } from '@cullinari/shared';

/** Pure cart rules, kept apart from React so they can be unit tested. */

export interface CartLine {
  /** One line per item + note combination. */
  key: string;
  menuItemId: string;
  name: string;
  priceMinor: number;
  quantity: number;
  note?: string;
}

export const MAX_QTY = 50;

export const lineKey = (menuItemId: string, note?: string) => `${menuItemId}::${(note ?? '').trim().toLowerCase()}`;

export function addLine(lines: CartLine[], item: { id: string; name: string; priceMinor: number }, quantity: number, note?: string): CartLine[] {
  const trimmed = note?.trim() || undefined;
  const k = lineKey(item.id, trimmed);
  const existing = lines.find((l) => l.key === k);
  if (existing) {
    return lines.map((l) => (l.key === k ? { ...l, quantity: Math.min(MAX_QTY, l.quantity + quantity) } : l));
  }
  return [...lines, { key: k, menuItemId: item.id, name: item.name, priceMinor: item.priceMinor, quantity: Math.min(MAX_QTY, quantity), note: trimmed }];
}

export function setQuantity(lines: CartLine[], key: string, quantity: number): CartLine[] {
  if (quantity <= 0) return lines.filter((l) => l.key !== key);
  return lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(MAX_QTY, quantity) } : l));
}

export const itemCount = (lines: CartLine[]) => lines.reduce((n, l) => n + l.quantity, 0);

/**
 * Keeps the cart in step with the live menu: drops items that were removed or sold out (or
 * aren't offered at the chosen branch) and picks up price changes. Returns what changed so
 * the app can tell the customer.
 */
export function reconcile(lines: CartLine[], menu: PublicMenu): { lines: CartLine[]; removed: string[]; repriced: string[] } {
  const byId = new Map(menu.items.map((i) => [i.id, i]));
  const removed: string[] = [];
  const repriced: string[] = [];
  const next: CartLine[] = [];
  for (const l of lines) {
    const m = byId.get(l.menuItemId);
    if (!m || !m.isAvailable) {
      removed.push(l.name);
      continue;
    }
    if (m.priceMinor !== l.priceMinor) repriced.push(l.name);
    next.push({ ...l, name: m.name, priceMinor: m.priceMinor });
  }
  return { lines: next, removed, repriced };
}

/** The API takes one entry per item; lines with different notes stay separate. */
export function toOrderItems(lines: CartLine[]) {
  return lines.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity, ...(l.note ? { note: l.note } : {}) }));
}
