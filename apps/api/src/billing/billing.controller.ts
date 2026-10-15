import { Controller, Get } from '@nestjs/common';
import { asc, desc } from 'drizzle-orm';
import { AllowWhenRestricted, Auth, AuthContext, Roles } from '../auth/auth.context';
import { Db } from '../db/db.service';
import { plans, subscriptions } from '../db/schema';
import { EntitlementsService } from '../entitlements/entitlements.service';

/**
 * Current plan, usage and the plan catalogue. Self-serve upgrades and USD subscriptions
 * arrive in Phase 2; until then the admin links the owner to Cullinari to change plan.
 */
@Roles('owner')
@AllowWhenRestricted()
@Controller('billing')
export class BillingController {
  constructor(
    private readonly db: Db,
    private readonly entitlements: EntitlementsService,
  ) {}

  @Get()
  async summary(@Auth() auth: AuthContext) {
    const [{ plan, entitlements }, usage] = await Promise.all([
      this.entitlements.getEntitlements(auth.tenantId),
      this.entitlements.usage(auth.tenantId, auth.timezone),
    ]);
    const catalogue = await this.db.global((tx) => tx.select().from(plans).orderBy(asc(plans.monthlyUsd)));
    const history = await this.db.tenant(auth.tenantId, (tx) =>
      tx.select().from(subscriptions).orderBy(desc(subscriptions.periodStart)).limit(12),
    );
    return {
      plan,
      status: auth.tenantStatus,
      entitlements,
      usage,
      plans: catalogue.map((p) => ({ code: p.code, name: p.name, monthlyUsd: p.monthlyUsd, setupUsd: p.setupUsd, entitlements: p.entitlements })),
      subscriptions: history,
    };
  }
}
