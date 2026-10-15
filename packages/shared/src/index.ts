// Shared vocabulary for the API, the admin dashboard and the ordering app.
// Anything that both sides must agree on (plan caps, error codes, order states) lives here.

export type PlanCode = 'starter' | 'growth' | 'pro';

/** null means unlimited. */
export interface Entitlements {
  max_orders_per_day: number | null;
  max_inventory_items: number | null;
  max_branches: number | null;
  app: {
    custom_splash: boolean;
    custom_layout: boolean;
    extra_options: boolean;
    custom_domain: boolean;
    custom_features: boolean;
  };
  support: 'standard' | 'priority';
}

export interface PlanDefinition {
  code: PlanCode;
  name: string;
  monthly_usd: number;
  setup_usd: number;
  entitlements: Entitlements;
}

/** Source of truth for the seed. At runtime the API reads the plans table, which staff can edit. */
export const PLAN_DEFINITIONS: PlanDefinition[] = [
  {
    code: 'starter',
    name: 'Starter',
    monthly_usd: 20,
    setup_usd: 75,
    entitlements: {
      max_orders_per_day: 50,
      max_inventory_items: 100,
      max_branches: 1,
      app: { custom_splash: false, custom_layout: false, extra_options: false, custom_domain: false, custom_features: false },
      support: 'standard',
    },
  },
  {
    code: 'growth',
    name: 'Growth',
    monthly_usd: 45,
    setup_usd: 200,
    entitlements: {
      max_orders_per_day: 200,
      max_inventory_items: 500,
      max_branches: 3,
      app: { custom_splash: true, custom_layout: true, extra_options: true, custom_domain: false, custom_features: false },
      support: 'standard',
    },
  },
  {
    code: 'pro',
    name: 'Pro',
    monthly_usd: 100,
    setup_usd: 400,
    entitlements: {
      max_orders_per_day: null,
      max_inventory_items: null,
      max_branches: null,
      app: { custom_splash: true, custom_layout: true, extra_options: true, custom_domain: true, custom_features: true },
      support: 'priority',
    },
  },
];

/** Stable error codes so the admin and the app can show the right message. */
export const ErrorCode = {
  PLAN_LIMIT_ORDERS: 'PLAN_LIMIT_ORDERS',
  PLAN_LIMIT_ITEMS: 'PLAN_LIMIT_ITEMS',
  PLAN_LIMIT_BRANCHES: 'PLAN_LIMIT_BRANCHES',
  PLAN_FEATURE_LOCKED: 'PLAN_FEATURE_LOCKED',
  TENANT_RESTRICTED: 'TENANT_RESTRICTED',
  ORDERING_PAUSED: 'ORDERING_PAUSED',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  ITEM_UNAVAILABLE: 'ITEM_UNAVAILABLE',
  BRANCH_CLOSED: 'BRANCH_CLOSED',
  PAYMENT_UNAVAILABLE: 'PAYMENT_UNAVAILABLE',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  NOT_FOUND: 'NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  VALIDATION: 'VALIDATION',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  CONFLICT: 'CONFLICT',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ApiError {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export const ROLES = ['owner', 'manager', 'cashier', 'kitchen'] as const;
export type Role = (typeof ROLES)[number];

export const TENANT_STATUSES = ['onboarding', 'active', 'past_due', 'restricted', 'suspended'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const ORDER_STATUSES = [
  'placed',
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type FulfilmentType = 'delivery' | 'pickup';
export type PaymentMethod = 'paystack' | 'pay_on_delivery';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded' | 'not_required';

/**
 * Allowed status moves. Delivery orders go ready -> out_for_delivery -> completed;
 * pickup orders go ready -> completed. Cancelling is allowed until the food is ready.
 */
export function allowedNextStatuses(status: OrderStatus, fulfilment: FulfilmentType): OrderStatus[] {
  switch (status) {
    case 'placed':
      return ['accepted', 'cancelled'];
    case 'accepted':
      return ['preparing', 'cancelled'];
    case 'preparing':
      return ['ready', 'cancelled'];
    case 'ready':
      return fulfilment === 'delivery' ? ['out_for_delivery'] : ['completed'];
    case 'out_for_delivery':
      return ['completed'];
    default:
      return [];
  }
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  placed: 'New',
  accepted: 'Accepted',
  preparing: 'Preparing',
  ready: 'Ready',
  out_for_delivery: 'Out for delivery',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/** Which roles may move an order into a given status. */
export const STATUS_ROLES: Record<OrderStatus, Role[]> = {
  placed: [],
  accepted: ['owner', 'manager', 'cashier'],
  preparing: ['owner', 'manager', 'cashier', 'kitchen'],
  ready: ['owner', 'manager', 'cashier', 'kitchen'],
  out_for_delivery: ['owner', 'manager', 'cashier'],
  completed: ['owner', 'manager', 'cashier'],
  cancelled: ['owner', 'manager', 'cashier'],
};

export interface UsageMeter {
  used: number;
  limit: number | null;
  /** 0-100, or null when unlimited */
  percent: number | null;
  state: 'ok' | 'warning' | 'reached';
}

/** Warning at 80%, reached at 100%, as in the plan-limits table. */
export function meter(used: number, limit: number | null): UsageMeter {
  if (limit === null) return { used, limit, percent: null, state: 'ok' };
  const percent = limit === 0 ? 100 : Math.min(100, Math.round((used / limit) * 100));
  const state = used >= limit ? 'reached' : percent >= 80 ? 'warning' : 'ok';
  return { used, limit, percent, state };
}

export interface UsageSummary {
  plan: PlanCode;
  orders_today: UsageMeter;
  inventory_items: UsageMeter;
  branches: UsageMeter;
}

/** Money is stored in minor units (kobo for NGN). */
export function formatMoney(minor: number, currency = 'NGN'): string {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 0 }).format(minor / 100);
}

/** Server-to-client WebSocket events. */
export const SocketEvent = {
  ORDER_CREATED: 'order.created',
  ORDER_UPDATED: 'order.updated',
  USAGE_UPDATED: 'usage.updated',
} as const;

/** The order shape the admin receives from the API and over the WebSocket. */
export interface OrderView {
  id: string;
  number: number;
  branchId: string;
  branchName: string;
  status: OrderStatus;
  fulfilment: FulfilmentType;
  channel: string;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  subtotalMinor: number;
  deliveryFeeMinor: number;
  taxMinor: number;
  totalMinor: number;
  deliveryAddress: string | null;
  note: string | null;
  cancelReason: string | null;
  customer: { id: string; name: string | null; phone: string } | null;
  items: { id: string; name: string; quantity: number; unitPriceMinor: number; note: string | null }[];
  placedAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/* ---------- Ordering app ---------- */

export const APP_LAYOUTS = ['list', 'grid', 'featured'] as const;
export type AppLayout = (typeof APP_LAYOUTS)[number];

/** Extra app options sold on Growth ("a few, chosen at setup") and Pro ("all"). */
export const APP_OPTIONS = ['promo_banner', 'scheduled_orders', 'pickup_only', 'delivery_only', 'reorder_button'] as const;
export type AppOption = (typeof APP_OPTIONS)[number];
/** How many extra options a Growth app may switch on. Pro is unlimited. */
export const GROWTH_MAX_OPTIONS = 3;

export interface AppTheme {
  primary: string;
  accent: string;
  logoUrl?: string;
  iconUrl?: string;
}

export interface PublicBranch {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  hours: Record<string, { open: string; close: string } | null> | null;
  isOpen: boolean;
}

/** What GET /public/:slug returns: everything the app needs at launch. */
export interface PublicRestaurantConfig {
  name: string;
  slug: string;
  currency: string;
  ordering: { open: boolean; reason: 'paused' | 'daily_limit' | null };
  branches: PublicBranch[];
  payments: { payOnDelivery: boolean; paystack: boolean; paystackPublicKey: string | null };
  deliveryFeeMinor: number;
  taxRateBps: number;
  app: {
    version: number;
    name: string;
    theme: AppTheme;
    /** null unless the plan includes a custom splash screen */
    splash: { imageUrl?: string; background?: string } | null;
    /** always 'list' unless the plan includes custom layouts */
    layout: AppLayout;
    options: Partial<Record<AppOption, boolean>>;
    promoText: string | null;
  } | null;
}

export interface PublicMenu {
  categories: { id: string; name: string }[];
  items: {
    id: string;
    categoryId: string | null;
    name: string;
    description: string | null;
    priceMinor: number;
    imageUrl: string | null;
    isAvailable: boolean;
  }[];
}

export interface PlacedOrder {
  orderId: string;
  number: number;
  status: OrderStatus;
  trackingToken: string;
  subtotalMinor: number;
  deliveryFeeMinor: number;
  taxMinor: number;
  totalMinor: number;
  currency: string;
  payment: { authorizationUrl: string; accessCode: string; reference: string; publicKey: string | null } | null;
}

export interface TrackedOrder {
  number: number;
  status: OrderStatus;
  fulfilment: FulfilmentType;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  subtotalMinor: number;
  deliveryFeeMinor: number;
  taxMinor: number;
  totalMinor: number;
  placedAt: string;
  updatedAt: string;
  branchName: string;
  items: { name: string; quantity: number; unitPriceMinor: number }[];
}

/** Steps shown on the tracking screen, in order. */
export function trackingSteps(fulfilment: FulfilmentType): OrderStatus[] {
  return fulfilment === 'delivery'
    ? ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'completed']
    : ['placed', 'accepted', 'preparing', 'ready', 'completed'];
}

/** Customer-facing wording for each status. */
export const CUSTOMER_STATUS_TEXT: Record<OrderStatus, string> = {
  placed: 'Order sent',
  accepted: 'Accepted by the restaurant',
  preparing: 'Being prepared',
  ready: 'Ready',
  out_for_delivery: 'On its way',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/** Same pricing rule as the API, so the app can show totals before checkout. */
export function priceCart(
  lines: { priceMinor: number; quantity: number }[],
  opts: { fulfilment: FulfilmentType; deliveryFeeMinor: number; taxRateBps: number },
) {
  const subtotalMinor = lines.reduce((s, l) => s + l.priceMinor * l.quantity, 0);
  const deliveryFeeMinor = opts.fulfilment === 'delivery' ? opts.deliveryFeeMinor : 0;
  const taxMinor = Math.round((subtotalMinor * opts.taxRateBps) / 10_000);
  return { subtotalMinor, deliveryFeeMinor, taxMinor, totalMinor: subtotalMinor + deliveryFeeMinor + taxMinor };
}
