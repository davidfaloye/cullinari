// Cullinari data model (Drizzle). Every business table carries tenant_id (the restaurant
// account); branch-scoped tables also carry branch_id. Row-level security is added by the
// hand-written migration `0001_row_level_security.sql`, keyed on the `app.tenant_id` setting.
// Money is stored as integer minor units (kobo for NGN).
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { Entitlements } from '@cullinari/shared';

const id = () => uuid('id').primaryKey().defaultRandom();
const tenantId = () => uuid('tenant_id').notNull();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const qty = (name: string) => numeric(name, { precision: 12, scale: 3, mode: 'number' });

export const plans = pgTable('plans', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  monthlyUsd: integer('monthly_usd').notNull(),
  setupUsd: integer('setup_usd').notNull(),
  entitlements: jsonb('entitlements').$type<Entitlements>().notNull(),
  updatedAt: updatedAt(),
});

export const tenants = pgTable('tenants', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  planCode: text('plan_code')
    .notNull()
    .references(() => plans.code),
  status: text('status').notNull().default('onboarding'),
  timezone: text('timezone').notNull().default('Africa/Lagos'),
  currency: text('currency').notNull().default('NGN'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    planCode: text('plan_code')
      .notNull()
      .references(() => plans.code),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    status: text('status').notNull(),
    providerRef: text('provider_ref'),
    createdAt: createdAt(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [index('subscriptions_tenant_idx').on(t.tenantId)],
);

export const tenantOverrides = pgTable(
  'tenant_overrides',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    reason: text('reason'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('tenant_overrides_tenant_key').on(t.tenantId, t.key)],
);

export const tenantSettings = pgTable('tenant_settings', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id),
  deliveryFeeMinor: integer('delivery_fee_minor').notNull().default(0),
  taxRateBps: integer('tax_rate_bps').notNull().default(0),
  payOnDeliveryEnabled: boolean('pay_on_delivery_enabled').notNull().default(true),
  paystackPublicKey: text('paystack_public_key'),
  paystackSecretKeyEnc: text('paystack_secret_key_enc'),
  orderingPaused: boolean('ordering_paused').notNull().default(false),
  /** Last order number issued; incremented atomically when an order is placed. */
  orderSeq: integer('order_seq').notNull().default(1000),
  updatedAt: updatedAt(),
});

export interface BranchHours {
  /** 0 = Sunday. Times are HH:MM in the tenant's timezone. Missing day = closed. */
  [day: string]: { open: string; close: string } | null;
}

export const branches = pgTable(
  'branches',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    name: text('name').notNull(),
    address: text('address'),
    phone: text('phone'),
    hours: jsonb('hours').$type<BranchHours>(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('branches_tenant_idx').on(t.tenantId)],
);

/** Global: a person can belong to several restaurants. Not tenant-scoped, never returned raw. */
export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  phone: text('phone'),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  isStaff: boolean('is_staff').notNull().default(false),
  mustResetPassword: boolean('must_reset_password').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: tenantId().references(() => tenants.id),
    /** null = all branches */
    branchId: uuid('branch_id').references(() => branches.id),
    role: text('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('memberships_user_tenant').on(t.userId, t.tenantId), index('memberships_tenant_idx').on(t.tenantId)],
);

export const menuCategories = pgTable(
  'menu_categories',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    branchId: uuid('branch_id').references(() => branches.id),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('menu_categories_tenant_idx').on(t.tenantId)],
);

export const menuItems = pgTable(
  'menu_items',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    /** null = shared across branches */
    branchId: uuid('branch_id').references(() => branches.id),
    categoryId: uuid('category_id').references(() => menuCategories.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    description: text('description'),
    priceMinor: integer('price_minor').notNull(),
    imageUrl: text('image_url'),
    isAvailable: boolean('is_available').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('menu_items_tenant_idx').on(t.tenantId)],
);

export const inventoryItems = pgTable(
  'inventory_items',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    name: text('name').notNull(),
    unit: text('unit').notNull(),
    qty: qty('qty').notNull().default(0),
    reorderLevel: qty('reorder_level').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    /** 'user' or 'plan' (set when a downgrade forces items read-only) */
    archivedReason: text('archived_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('inventory_items_tenant_branch_idx').on(t.tenantId, t.branchId)],
);

export const recipes = pgTable(
  'recipes',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    menuItemId: uuid('menu_item_id')
      .notNull()
      .references(() => menuItems.id, { onDelete: 'cascade' }),
    inventoryItemId: uuid('inventory_item_id')
      .notNull()
      .references(() => inventoryItems.id, { onDelete: 'cascade' }),
    qty: qty('qty').notNull(),
  },
  (t) => [uniqueIndex('recipes_item_ingredient').on(t.menuItemId, t.inventoryItemId)],
);

export const stockMovements = pgTable(
  'stock_movements',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    inventoryItemId: uuid('inventory_item_id')
      .notNull()
      .references(() => inventoryItems.id),
    change: qty('change').notNull(),
    /** purchase | sale | waste | adjustment */
    reason: text('reason').notNull(),
    note: text('note'),
    orderId: uuid('order_id'),
    userId: uuid('user_id'),
    createdAt: createdAt(),
  },
  (t) => [index('stock_movements_item_idx').on(t.tenantId, t.inventoryItemId)],
);

export const customers = pgTable(
  'customers',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    phone: text('phone').notNull(),
    name: text('name'),
    email: text('email'),
    addresses: jsonb('addresses').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('customers_tenant_phone').on(t.tenantId, t.phone)],
);

export const orders = pgTable(
  'orders',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    customerId: uuid('customer_id').references(() => customers.id),
    number: integer('number').notNull(),
    status: text('status').notNull().default('placed'),
    /** delivery | pickup */
    fulfilment: text('fulfilment').notNull(),
    /** app | counter */
    channel: text('channel').notNull().default('app'),
    paymentMethod: text('payment_method').notNull(),
    paymentStatus: text('payment_status').notNull(),
    subtotalMinor: integer('subtotal_minor').notNull(),
    deliveryFeeMinor: integer('delivery_fee_minor').notNull().default(0),
    taxMinor: integer('tax_minor').notNull().default(0),
    totalMinor: integer('total_minor').notNull(),
    deliveryAddress: text('delivery_address'),
    note: text('note'),
    trackingToken: text('tracking_token').notNull().unique(),
    pushToken: text('push_token'),
    cancelReason: text('cancel_reason'),
    placedAt: timestamp('placed_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: updatedAt(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('orders_tenant_number').on(t.tenantId, t.number),
    index('orders_tenant_branch_placed_idx').on(t.tenantId, t.branchId, t.placedAt),
    index('orders_tenant_status_idx').on(t.tenantId, t.status),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    menuItemId: uuid('menu_item_id'),
    name: text('name').notNull(),
    unitPriceMinor: integer('unit_price_minor').notNull(),
    quantity: integer('quantity').notNull(),
    note: text('note'),
  },
  (t) => [index('order_items_order_idx').on(t.orderId)],
);

export const payments = pgTable(
  'payments',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    provider: text('provider').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    /** pending | paid | failed | refunded */
    status: text('status').notNull(),
    reference: text('reference').notNull().unique(),
    raw: jsonb('raw'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('payments_order_idx').on(t.tenantId, t.orderId)],
);

/** The order-cap counter. One row per tenant per local day. */
export const usageDaily = pgTable(
  'usage_daily',
  {
    tenantId: tenantId().references(() => tenants.id),
    date: date('date').notNull(),
    ordersCount: integer('orders_count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.date] })],
);

export const appConfigs = pgTable(
  'app_configs',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    version: integer('version').notNull(),
    appName: text('app_name').notNull(),
    bundleId: text('bundle_id').notNull(),
    theme: jsonb('theme').$type<{ primary: string; accent: string; logoUrl?: string; iconUrl?: string }>().notNull(),
    splash: jsonb('splash').$type<{ imageUrl?: string; background?: string } | null>(),
    layout: text('layout').notNull().default('list'),
    features: jsonb('features').$type<Record<string, boolean>>().notNull().default(sql`'{}'::jsonb`),
    domain: text('domain'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('app_configs_tenant_version').on(t.tenantId, t.version)],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    tenantId: uuid('tenant_id'),
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_log_tenant_idx').on(t.tenantId, t.createdAt)],
);
