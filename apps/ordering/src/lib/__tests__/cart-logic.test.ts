/// <reference types="jest" />
import { priceCart, type PublicMenu } from '@cullinari/shared';
import { addLine, itemCount, MAX_QTY, reconcile, setQuantity, toOrderItems, type CartLine } from '../cart-logic';

const jollof = { id: 'a', name: 'Jollof rice', priceMinor: 350000 };
const suya = { id: 'b', name: 'Suya platter', priceMinor: 450000 };

const menu = (items: Partial<PublicMenu['items'][number]>[]): PublicMenu => ({
  categories: [],
  items: items.map((i) => ({ id: 'x', categoryId: null, name: 'x', description: null, priceMinor: 0, imageUrl: null, isAvailable: true, ...i })),
});

describe('cart', () => {
  it('merges the same item and note into one line', () => {
    let c: CartLine[] = [];
    c = addLine(c, jollof, 1);
    c = addLine(c, jollof, 2);
    c = addLine(c, jollof, 1, 'Extra pepper');
    c = addLine(c, jollof, 1, '  extra PEPPER ');
    expect(c).toHaveLength(2);
    expect(c.map((l) => l.quantity)).toEqual([3, 2]);
    expect(itemCount(c)).toBe(5);
  });

  it('caps quantities and removes a line at zero', () => {
    let c = addLine([], suya, MAX_QTY + 10);
    expect(c[0].quantity).toBe(MAX_QTY);
    c = setQuantity(c, c[0].key, 0);
    expect(c).toEqual([]);
  });

  it('drops sold-out or removed items and picks up new prices from the live menu', () => {
    const c = addLine(addLine([], jollof, 2), suya, 1);
    const result = reconcile(c, menu([{ id: 'a', name: 'Jollof rice', priceMinor: 380000 }, { id: 'b', name: 'Suya platter', priceMinor: 450000, isAvailable: false }]));
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].priceMinor).toBe(380000);
    expect(result.removed).toEqual(['Suya platter']);
    expect(result.repriced).toEqual(['Jollof rice']);
  });

  it('sends one entry per line, with notes only where given', () => {
    const c = addLine(addLine([], jollof, 2), jollof, 1, 'No onions');
    expect(toOrderItems(c)).toEqual([
      { menuItemId: 'a', quantity: 2 },
      { menuItemId: 'a', quantity: 1, note: 'No onions' },
    ]);
  });

  it('prices the same way as the API', () => {
    const lines = [{ priceMinor: 350000, quantity: 2 }, { priceMinor: 450000, quantity: 1 }];
    expect(priceCart(lines, { fulfilment: 'delivery', deliveryFeeMinor: 150000, taxRateBps: 750 })).toEqual({
      subtotalMinor: 1150000,
      deliveryFeeMinor: 150000,
      taxMinor: 86250,
      totalMinor: 1386250,
    });
    expect(priceCart(lines, { fulfilment: 'pickup', deliveryFeeMinor: 150000, taxRateBps: 0 }).totalMinor).toBe(1150000);
  });
});
