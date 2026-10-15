import { Controller, Get, Query } from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { AllowWhenRestricted, Auth, AuthContext, Roles, scopeBranch } from '../auth/auth.context';
import { Db } from '../db/db.service';
import { branches, inventoryItems } from '../db/schema';
import { EntitlementsService } from '../entitlements/entitlements.service';

/** Home screen: today's numbers, usage meters for all three caps, low stock and top items. */
@Controller()
export class DashboardController {
  constructor(
    private readonly db: Db,
    private readonly entitlements: EntitlementsService,
  ) {}

  @Roles('owner', 'manager')
  @Get('dashboard')
  async home(@Auth() auth: AuthContext, @Query('branchId') branchId?: string) {
    const scoped = scopeBranch(auth, branchId) ?? null;
    const tz = auth.timezone;
    const usage = await this.entitlements.usage(auth.tenantId, tz);

    return this.db.tenant(auth.tenantId, async (tx) => {
      const branchSql = scoped ? sql`and o.branch_id = ${scoped}` : sql``;
      const today = sql`(o.placed_at at time zone ${tz})::date = (now() at time zone ${tz})::date`;

      const totals = await tx.execute<{ revenue: string; orders: string; active: string; cancelled: string }>(sql`
        select coalesce(sum(o.total_minor) filter (where o.status <> 'cancelled'), 0) as revenue,
               count(*) filter (where o.status <> 'cancelled') as orders,
               count(*) filter (where o.status not in ('completed', 'cancelled')) as active,
               count(*) filter (where o.status = 'cancelled') as cancelled
        from orders o where ${today} ${branchSql}`);

      const topItems = await tx.execute<{ name: string; quantity: string; revenue: string }>(sql`
        select oi.name, sum(oi.quantity) as quantity, sum(oi.quantity * oi.unit_price_minor) as revenue
        from order_items oi join orders o on o.id = oi.order_id
        where ${today} and o.status <> 'cancelled' ${branchSql}
        group by oi.name order by quantity desc limit 5`);

      const week = await tx.execute<{ day: string; revenue: string; orders: string }>(sql`
        with days as (
          select generate_series((now() at time zone ${tz})::date - 6, (now() at time zone ${tz})::date, '1 day')::date as day
        )
        select to_char(d.day, 'YYYY-MM-DD') as day,
               coalesce(sum(o.total_minor), 0) as revenue,
               count(o.id) as orders
        from days d
        left join orders o on (o.placed_at at time zone ${tz})::date = d.day and o.status <> 'cancelled' ${branchSql}
        group by d.day order by d.day`);

      const lowStock = await tx
        .select({
          id: inventoryItems.id,
          name: inventoryItems.name,
          unit: inventoryItems.unit,
          qty: inventoryItems.qty,
          reorderLevel: inventoryItems.reorderLevel,
          branchName: branches.name,
        })
        .from(inventoryItems)
        .innerJoin(branches, eq(branches.id, inventoryItems.branchId))
        .where(
          and(
            isNull(inventoryItems.archivedAt),
            sql`${inventoryItems.qty} <= ${inventoryItems.reorderLevel}`,
            scoped ? eq(inventoryItems.branchId, scoped) : undefined,
          ),
        )
        .orderBy(asc(sql`${inventoryItems.qty} / nullif(${inventoryItems.reorderLevel}, 0)`))
        .limit(8);

      const t = totals.rows[0];
      return {
        today: {
          revenueMinor: Number(t.revenue),
          orders: Number(t.orders),
          activeOrders: Number(t.active),
          cancelled: Number(t.cancelled),
        },
        usage,
        topItems: topItems.rows.map((r) => ({ name: r.name, quantity: Number(r.quantity), revenueMinor: Number(r.revenue) })),
        last7Days: week.rows.map((r) => ({ day: r.day, revenueMinor: Number(r.revenue), orders: Number(r.orders) })),
        lowStock,
      };
    });
  }

  /** Usage meters; every role sees them so the order screen can warn near the cap. */
  @AllowWhenRestricted()
  @Get('usage')
  usage(@Auth() auth: AuthContext) {
    return this.entitlements.usage(auth.tenantId, auth.timezone);
  }
}
