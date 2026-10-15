import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import type { AppTheme, PublicMenu, PublicRestaurantConfig } from '@cullinari/shared';
import { api } from './api';
import { addLine, reconcile, setQuantity, type CartLine } from './cart-logic';
import { TENANT } from './config';
import { load, save } from './storage';

export interface Customer {
  name: string;
  phone: string;
  email: string;
  address: string;
}

export interface RecentOrder {
  token: string;
  number: number;
  placedAt: string;
  totalMinor: number;
  /** Paystack reference, to re-check a card payment from the tracking screen. */
  paymentReference?: string;
}

interface Store {
  ready: boolean;
  /** Set when the first config load failed and nothing is cached. */
  loadError: string | null;
  config: PublicRestaurantConfig | null;
  theme: AppTheme;
  branchId: string | null;
  setBranchId: (id: string) => void;
  menu: PublicMenu | null;
  menuLoading: boolean;
  refresh: () => Promise<void>;
  cart: CartLine[];
  addToCart: (item: { id: string; name: string; priceMinor: number }, quantity: number, note?: string) => void;
  setLineQuantity: (key: string, quantity: number) => void;
  clearCart: () => void;
  /** Names of items removed from the cart because they're no longer available. */
  cartNotice: string | null;
  dismissCartNotice: () => void;
  customer: Customer;
  saveCustomer: (c: Customer) => void;
  recentOrders: RecentOrder[];
  rememberOrder: (o: RecentOrder) => void;
}

const Ctx = createContext<Store | null>(null);
const EMPTY_CUSTOMER: Customer = { name: '', phone: '', email: '', address: '' };

/**
 * App-wide state: the restaurant's live config and menu, the chosen branch, the cart and
 * the customer's saved details. The menu refreshes whenever the app comes to the foreground,
 * so prices and availability follow the admin without an app update.
 */
export function StoreProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PublicRestaurantConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [branchId, setBranch] = useState<string | null>(null);
  const [menu, setMenu] = useState<PublicMenu | null>(null);
  const [menuLoading, setMenuLoading] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartNotice, setCartNotice] = useState<string | null>(null);
  const [customer, setCustomer] = useState<Customer>(EMPTY_CUSTOMER);
  const [recentOrders, setRecent] = useState<RecentOrder[]>([]);
  const cartRef = useRef(cart);
  cartRef.current = cart;
  const branchRef = useRef(branchId);
  branchRef.current = branchId;

  // Restore what's on the device first, so the app opens instantly even offline.
  useEffect(() => {
    void (async () => {
      const [cfg, b, m, c, cu, r] = await Promise.all([
        load<PublicRestaurantConfig | null>('config', null),
        load<string | null>('branch', null),
        load<PublicMenu | null>('menu', null),
        load<CartLine[]>('cart', []),
        load<Customer>('customer', EMPTY_CUSTOMER),
        load<RecentOrder[]>('orders', []),
      ]);
      setConfig(cfg);
      setBranch(b);
      setMenu(m);
      setCart(c);
      setCustomer(cu);
      setRecent(r);
      setHydrated(true);
    })();
  }, []);

  const loadMenu = useCallback(async (forBranch: string | null) => {
    setMenuLoading(true);
    try {
      const m = await api.menu(forBranch ?? undefined);
      setMenu(m);
      void save('menu', m);
      const result = reconcile(cartRef.current, m);
      if (result.removed.length || result.repriced.length) {
        setCart(result.lines);
        void save('cart', result.lines);
        const parts = [];
        if (result.removed.length) parts.push(`${result.removed.join(', ')} ${result.removed.length === 1 ? 'is' : 'are'} no longer available and was removed`);
        if (result.repriced.length) parts.push(`the price of ${result.repriced.join(', ')} changed`);
        setCartNotice(`Your order was updated: ${parts.join('; ')}.`);
      }
    } finally {
      setMenuLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const cfg = await api.config();
      setConfig(cfg);
      setLoadError(null);
      void save('config', cfg);
      // Keep the chosen branch if it's still active, otherwise fall back to the first one.
      const active = cfg.branches.map((b) => b.id);
      const current = branchRef.current;
      const next = current && active.includes(current) ? current : (cfg.branches[0]?.id ?? null);
      branchRef.current = next;
      setBranch(next);
      void save('branch', next);
      await loadMenu(next).catch(() => undefined);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the menu');
    }
  }, [loadMenu]);

  useEffect(() => {
    if (!hydrated) return;
    void refresh();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void refresh());
    return () => sub.remove();
  }, [hydrated, refresh]);

  const value = useMemo<Store>(
    () => ({
      ready: hydrated && (!!config || !!loadError),
      loadError: config ? null : loadError,
      config,
      // Live colours from the admin win over the ones baked into the build.
      theme: config?.app?.theme ?? TENANT.theme,
      branchId,
      setBranchId: (id) => {
        if (id === branchId) return;
        setBranch(id);
        void save('branch', id);
        void loadMenu(id).catch(() => undefined);
      },
      menu,
      menuLoading,
      refresh,
      cart,
      addToCart: (item, quantity, note) =>
        setCart((c) => {
          const next = addLine(c, item, quantity, note);
          void save('cart', next);
          return next;
        }),
      setLineQuantity: (key, quantity) =>
        setCart((c) => {
          const next = setQuantity(c, key, quantity);
          void save('cart', next);
          return next;
        }),
      clearCart: () => {
        setCart([]);
        void save('cart', []);
      },
      cartNotice,
      dismissCartNotice: () => setCartNotice(null),
      customer,
      saveCustomer: (c) => {
        setCustomer(c);
        void save('customer', c);
      },
      recentOrders,
      rememberOrder: (o) =>
        setRecent((r) => {
          const next = [o, ...r.filter((x) => x.token !== o.token)].slice(0, 20);
          void save('orders', next);
          return next;
        }),
    }),
    [hydrated, config, loadError, branchId, menu, menuLoading, refresh, cart, cartNotice, customer, recentOrders, loadMenu],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}
