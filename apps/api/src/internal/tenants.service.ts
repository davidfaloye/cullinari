import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { ErrorCode, type PlanCode, type TenantStatus } from '@cullinari/shared';
import { hashPassword } from '../auth/auth.service';
import { AuditService } from '../common/audit.service';
import { tempPassword } from '../common/crypto';
import { AppError, notFound } from '../common/errors';
import { Db } from '../db/db.service';
import { appConfigs, branches, memberships, plans, tenantOverrides, tenants, tenantSettings, users } from '../db/schema';
import { EntitlementsService } from '../entitlements/entitlements.service';

export interface CreateTenantInput {
  name: string;
  slug: string;
  planCode: PlanCode;
  timezone?: string;
  branchName?: string;
  owner: { email: string; name: string; password?: string };
  theme?: { primary: string; accent: string };
}

/** Manual onboarding (Phase 1) and the base for the staff console. */
@Injectable()
export class TenantsService {
  constructor(
    private readonly db: Db,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
  ) {}

  async create(input: CreateTenantInput, actorId: string | null = null) {
    return this.db.db.transaction(async (tx) => {
      const [plan] = await tx.select().from(plans).where(eq(plans.code, input.planCode));
      if (!plan) throw new AppError(ErrorCode.VALIDATION, `Unknown plan ${input.planCode}`, 400);

      const [tenant] = await tx
        .insert(tenants)
        .values({ name: input.name, slug: input.slug, planCode: input.planCode, timezone: input.timezone ?? 'Africa/Lagos' })
        .returning();
      await tx.execute(sql`select set_config('app.tenant_id', ${tenant.id}, true)`);

      await tx.insert(tenantSettings).values({ tenantId: tenant.id });
      const [branch] = await tx
        .insert(branches)
        .values({ tenantId: tenant.id, name: input.branchName ?? 'Main branch' })
        .returning();

      const email = input.owner.email.trim().toLowerCase();
      const [existing] = await tx.select().from(users).where(eq(users.email, email));
      let ownerId = existing?.id;
      let temporaryPassword: string | null = null;
      if (!existing) {
        const password = input.owner.password ?? (temporaryPassword = tempPassword());
        const [u] = await tx
          .insert(users)
          .values({ email, name: input.owner.name, passwordHash: await hashPassword(password), mustResetPassword: !input.owner.password })
          .returning();
        ownerId = u.id;
      }
      await tx.insert(memberships).values({ userId: ownerId!, tenantId: tenant.id, role: 'owner' });

      await tx.insert(appConfigs).values({
        tenantId: tenant.id,
        version: 1,
        appName: input.name,
        bundleId: `com.cullinari.${input.slug.replace(/[^a-z0-9]/g, '')}`,
        theme: input.theme ?? { primary: '#0f6b4f', accent: '#b9e04c' },
        layout: 'list',
        publishedAt: new Date(),
      });

      await this.audit.record(tx, { tenantId: tenant.id, actorId, action: 'tenant.create', entity: 'tenant', entityId: tenant.id, after: { name: tenant.name, slug: tenant.slug, plan: tenant.planCode } });
      return { tenant, branch, owner: { id: ownerId, email, temporaryPassword } };
    });
  }

  async update(tenantId: string, patch: { planCode?: PlanCode; status?: TenantStatus }, actorId: string | null = null) {
    const row = await this.db.tenant(tenantId, async (tx) => {
      const [before] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
      if (!before) throw notFound('Restaurant');
      const [after] = await tx.update(tenants).set(patch).where(eq(tenants.id, tenantId)).returning();
      await this.audit.record(tx, { tenantId, actorId, action: 'tenant.update', entity: 'tenant', entityId: tenantId, before: { plan: before.planCode, status: before.status }, after: { plan: after.planCode, status: after.status } });
      return after;
    });
    // Upgrades apply instantly: drop the cached caps so the next order sees them.
    this.entitlements.invalidate(tenantId);
    return row;
  }

  async setOverride(tenantId: string, o: { key: string; value: unknown; reason: string; expiresAt?: Date }, actorId: string | null = null) {
    // A JS null would become SQL NULL; "unlimited" must be stored as the JSON value null.
    const value = (o.value === null ? sql`'null'::jsonb` : o.value) as never;
    const row = await this.db.tenant(tenantId, async (tx) => {
      const [saved] = await tx
        .insert(tenantOverrides)
        .values({ tenantId, key: o.key, value, reason: o.reason, expiresAt: o.expiresAt ?? null, createdBy: actorId })
        .onConflictDoUpdate({
          target: [tenantOverrides.tenantId, tenantOverrides.key],
          set: { value, reason: o.reason, expiresAt: o.expiresAt ?? null },
        })
        .returning();
      await this.audit.record(tx, { tenantId, actorId, action: 'override.set', entity: 'tenant_override', entityId: saved.id, after: o });
      return saved;
    });
    this.entitlements.invalidate(tenantId);
    return row;
  }

  async list() {
    const rows = await this.db.global((tx) => tx.select().from(tenants).orderBy(tenants.createdAt));
    return Promise.all(
      rows.map(async (t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        plan: t.planCode,
        status: t.status,
        createdAt: t.createdAt,
        usage: await this.entitlements.usage(t.id, t.timezone),
      })),
    );
  }
}
