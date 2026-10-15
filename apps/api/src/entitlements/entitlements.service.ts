import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { ErrorCode, meter, type Entitlements, type PlanCode, type UsageSummary } from '@cullinari/shared';
import { AppConfig, CONFIG } from '../config';
import { AppError, planLimit } from '../common/errors';
import { Db, type Tx } from '../db/db.service';
import { branches, inventoryItems, plans, tenantOverrides, tenants } from '../db/schema';

export interface TenantEntitlements {
  plan: PlanCode;
  entitlements: Entitlements;
}

/**
 * The single place plan limits are decided.
 *
 * getEntitlements() merges the plan's entitlements with any per-tenant overrides and caches
 * the result per tenant. Every write that can exceed a cap calls one of the assert/consume
 * methods inside the same transaction as the write, so two simultaneous requests can never
 * both slip past the limit.
 */
@Injectable()
export class EntitlementsService {
  private cache = new Map<string, { value: TenantEntitlements; expiresAt: number }>();

  constructor(
    private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async getEntitlements(tenantId: string): Promise<TenantEntitlements> {
    const hit = this.cache.get(tenantId);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const value = await this.db.tenant(tenantId, async (tx) => {
      const [row] = await tx
        .select({ plan: tenants.planCode, entitlements: plans.entitlements })
        .from(tenants)
        .innerJoin(plans, eq(plans.code, tenants.planCode))
        .where(eq(tenants.id, tenantId));
      if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Restaurant not found', 404);

      const overrides = await tx
        .select({ key: tenantOverrides.key, value: tenantOverrides.value })
        .from(tenantOverrides)
        .where(or(isNull(tenantOverrides.expiresAt), gt(tenantOverrides.expiresAt, new Date())));

      return { plan: row.plan as PlanCode, entitlements: applyOverrides(row.entitlements, overrides) };
    });

    this.cache.set(tenantId, { value, expiresAt: Date.now() + this.config.ENTITLEMENTS_TTL_SECONDS * 1000 });
    return value;
  }

  /** Call after a plan change or override so the next request sees the new caps at once. */
  invalidate(tenantId: string) {
    this.cache.delete(tenantId);
  }

  /**
   * Counts one order against today's cap (today in the restaurant's timezone).
   * The upsert only increments while orders_count < cap; the row lock it takes makes
   * concurrent checkouts queue up, so exactly `cap` orders get through per day.
   */
  async consumeOrderSlot(tx: Tx, tenantId: string, timezone: string): Promise<number> {
    const { entitlements } = await this.getEntitlements(tenantId);
    const cap = entitlements.max_orders_per_day;
    if (cap !== null && cap <= 0) throw this.ordersLimit(cap);

    const result = await tx.execute<{ orders_count: number }>(sql`
      insert into usage_daily (tenant_id, date, orders_count)
      values (${tenantId}, (now() at time zone ${timezone})::date, 1)
      on conflict (tenant_id, date) do update
        set orders_count = usage_daily.orders_count + 1
        where ${cap}::int is null or usage_daily.orders_count < ${cap}::int
      returning orders_count`);

    if (result.rows.length === 0) throw this.ordersLimit(cap!);
    return Number(result.rows[0].orders_count);
  }

  /** Gives a slot back, e.g. when a card payment could not even be started. */
  async releaseOrderSlot(tx: Tx, tenantId: string, placedAt: Date, timezone: string) {
    await tx.execute(sql`
      update usage_daily set orders_count = greatest(orders_count - 1, 0)
      where tenant_id = ${tenantId} and date = (${placedAt.toISOString()}::timestamptz at time zone ${timezone})::date`);
  }

  async assertCanAddBranch(tx: Tx, tenantId: string) {
    const { entitlements } = await this.getEntitlements(tenantId);
    const cap = entitlements.max_branches;
    if (cap === null) return;
    await this.lock(tx, tenantId, 'branches');
    const [{ n }] = await tx
      .select({ n: count() })
      .from(branches)
      .where(and(eq(branches.tenantId, tenantId), eq(branches.isActive, true)));
    if (n >= cap) {
      throw planLimit(
        ErrorCode.PLAN_LIMIT_BRANCHES,
        `Your plan includes ${cap} branch${cap === 1 ? '' : 'es'}. Upgrade to add more.`,
        { used: n, limit: cap },
      );
    }
  }

  async assertCanAddInventoryItem(tx: Tx, tenantId: string) {
    const { entitlements } = await this.getEntitlements(tenantId);
    const cap = entitlements.max_inventory_items;
    if (cap === null) return;
    await this.lock(tx, tenantId, 'inventory');
    const [{ n }] = await tx
      .select({ n: count() })
      .from(inventoryItems)
      .where(and(eq(inventoryItems.tenantId, tenantId), isNull(inventoryItems.archivedAt)));
    if (n >= cap) {
      throw planLimit(
        ErrorCode.PLAN_LIMIT_ITEMS,
        `Your plan includes ${cap} inventory items. Archive unused items or upgrade to add more.`,
        { used: n, limit: cap },
      );
    }
  }

  async assertFeature(tenantId: string, feature: keyof Entitlements['app']) {
    const { entitlements } = await this.getEntitlements(tenantId);
    if (!entitlements.app[feature]) {
      throw new AppError(ErrorCode.PLAN_FEATURE_LOCKED, 'This option is not included in your plan', 403, { feature });
    }
  }

  async usage(tenantId: string, timezone: string): Promise<UsageSummary> {
    const { plan, entitlements } = await this.getEntitlements(tenantId);
    return this.db.tenant(tenantId, async (tx) => {
      const today = await tx.execute<{ orders_count: number }>(sql`
        select orders_count from usage_daily
        where tenant_id = ${tenantId} and date = (now() at time zone ${timezone})::date`);
      const [{ items }] = await tx
        .select({ items: count() })
        .from(inventoryItems)
        .where(and(eq(inventoryItems.tenantId, tenantId), isNull(inventoryItems.archivedAt)));
      const [{ active }] = await tx
        .select({ active: count() })
        .from(branches)
        .where(and(eq(branches.tenantId, tenantId), eq(branches.isActive, true)));
      return {
        plan,
        orders_today: meter(Number(today.rows[0]?.orders_count ?? 0), entitlements.max_orders_per_day),
        inventory_items: meter(items, entitlements.max_inventory_items),
        branches: meter(active, entitlements.max_branches),
      };
    });
  }

  private ordersLimit(cap: number) {
    return planLimit(ErrorCode.PLAN_LIMIT_ORDERS, `Today's limit of ${cap} online orders has been reached.`, {
      limit: cap,
    });
  }

  /** Serialises cap checks per tenant for counts that aren't a single counter row. */
  private async lock(tx: Tx, tenantId: string, what: string) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${tenantId}:${what}`}))`);
  }
}

/** Overrides use dotted keys: "max_branches" -> 4, "app.custom_splash" -> true. */
export function applyOverrides(base: Entitlements, overrides: { key: string; value: unknown }[]): Entitlements {
  const out: Entitlements = structuredClone(base);
  for (const { key, value } of overrides) {
    const parts = key.split('.');
    let node: Record<string, unknown> = out as unknown as Record<string, unknown>;
    for (const p of parts.slice(0, -1)) {
      if (typeof node[p] !== 'object' || node[p] === null) node[p] = {};
      node = node[p] as Record<string, unknown>;
    }
    node[parts[parts.length - 1]] = value;
  }
  return out;
}

