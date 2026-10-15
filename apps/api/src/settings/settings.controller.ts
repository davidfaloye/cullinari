import { Body, Controller, Get, Inject, Patch } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { Auth, AuthContext, Roles } from '../auth/auth.context';
import { AuditService } from '../common/audit.service';
import { encryptSecret } from '../common/crypto';
import { moneyMinor, parse } from '../common/validate';
import { AppConfig, CONFIG } from '../config';
import { Db } from '../db/db.service';
import { tenants, tenantSettings } from '../db/schema';

const isTimezone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const updateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  timezone: z.string().refine(isTimezone, 'Unknown timezone').optional(),
  deliveryFeeMinor: moneyMinor.optional(),
  taxRateBps: z.number().int().min(0).max(5000).optional(),
  payOnDeliveryEnabled: z.boolean().optional(),
  orderingPaused: z.boolean().optional(),
  paystackPublicKey: z.string().trim().regex(/^pk_(test|live)_\w+$/, 'Paste the key that starts with pk_').nullable().optional(),
  /** Write-only. Send a new key to replace it, or null to remove it. */
  paystackSecretKey: z.string().trim().regex(/^sk_(test|live)_\w+$/, 'Paste the key that starts with sk_').nullable().optional(),
});

@Roles('owner')
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Get()
  get(@Auth() auth: AuthContext) {
    return this.db.tenant(auth.tenantId, async (tx) => this.view(tx, auth.tenantId));
  }

  @Patch()
  update(@Auth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(updateSchema, body);
    return this.db.tenant(auth.tenantId, async (tx) => {
      const { name, timezone, paystackSecretKey, ...rest } = input;
      if (name !== undefined || timezone !== undefined) {
        await tx.update(tenants).set({ name, timezone }).where(eq(tenants.id, auth.tenantId));
      }
      const patch: Partial<typeof tenantSettings.$inferInsert> = { ...rest };
      if (paystackSecretKey !== undefined) {
        patch.paystackSecretKeyEnc = paystackSecretKey ? encryptSecret(paystackSecretKey, this.config.DATA_KEY) : null;
      }
      if (Object.keys(patch).length) {
        await tx.update(tenantSettings).set(patch).where(eq(tenantSettings.tenantId, auth.tenantId));
      }
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        actorId: auth.userId,
        action: 'settings.update',
        entity: 'tenant_settings',
        entityId: auth.tenantId,
        // Never log key material.
        after: { ...input, paystackSecretKey: paystackSecretKey === undefined ? undefined : paystackSecretKey ? 'set' : 'removed' },
      });
      return this.view(tx, auth.tenantId);
    });
  }

  private async view(tx: Parameters<Parameters<Db['tenant']>[1]>[0], tenantId: string) {
    const [t] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    const [s] = await tx.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId));
    return {
      name: t.name,
      slug: t.slug,
      timezone: t.timezone,
      currency: t.currency,
      deliveryFeeMinor: s.deliveryFeeMinor,
      taxRateBps: s.taxRateBps,
      payOnDeliveryEnabled: s.payOnDeliveryEnabled,
      orderingPaused: s.orderingPaused,
      paystackPublicKey: s.paystackPublicKey,
      paystackSecretKeySet: !!s.paystackSecretKeyEnc,
      paystackWebhookUrl: `${this.config.PUBLIC_API_URL}/webhooks/paystack/${t.slug}`,
    };
  }
}
