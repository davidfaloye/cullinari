import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNotNull, max } from 'drizzle-orm';
import {
  APP_OPTIONS,
  ErrorCode,
  GROWTH_MAX_OPTIONS,
  type AppLayout,
  type AppOption,
  type AppTheme,
  type Entitlements,
  type PlanCode,
} from '@cullinari/shared';
import { AuditService } from '../common/audit.service';
import { AppError, notFound } from '../common/errors';
import { AppConfig, CONFIG } from '../config';
import { Db, type Tx } from '../db/db.service';
import { appConfigs, tenants } from '../db/schema';
import { EntitlementsService } from '../entitlements/entitlements.service';

export interface AppConfigInput {
  appName: string;
  theme: AppTheme;
  splash?: { imageUrl?: string; background?: string } | null;
  layout?: AppLayout;
  options?: Partial<Record<AppOption, boolean>>;
  promoText?: string | null;
  domain?: string | null;
}

type Row = typeof appConfigs.$inferSelect;

/**
 * App personalisation, gated by plan. Values the plan does not allow are rejected when a
 * version is created, and also masked when served, so a downgrade takes effect without
 * anyone editing the stored config.
 */
@Injectable()
export class AppConfigService {
  constructor(
    private readonly db: Db,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** Throws PLAN_FEATURE_LOCKED for anything the plan doesn't include. */
  validate(e: Entitlements, plan: PlanCode, input: AppConfigInput) {
    const locked = (feature: string, needs: 'Growth' | 'Pro') =>
      new AppError(ErrorCode.PLAN_FEATURE_LOCKED, `${feature} needs the ${needs} plan`, 403, { feature, needs });

    if (input.splash && (input.splash.imageUrl || input.splash.background) && !e.app.custom_splash) throw locked('A custom splash screen', 'Growth');
    if (input.layout && input.layout !== 'list' && !e.app.custom_layout) throw locked('Menu layouts', 'Growth');
    if (input.domain && !e.app.custom_domain) throw locked('A custom domain', 'Pro');

    const on = Object.entries(input.options ?? {}).filter(([, v]) => v).map(([k]) => k);
    const unknown = on.filter((k) => !(APP_OPTIONS as readonly string[]).includes(k));
    if (unknown.length) throw new AppError(ErrorCode.VALIDATION, `Unknown app options: ${unknown.join(', ')}`, 400);
    if (on.length && !e.app.extra_options) throw locked('Extra app options', 'Growth');
    if (plan !== 'pro' && !e.app.custom_features && on.length > GROWTH_MAX_OPTIONS) {
      throw new AppError(ErrorCode.PLAN_FEATURE_LOCKED, `Growth includes up to ${GROWTH_MAX_OPTIONS} extra options`, 403, { feature: 'options' });
    }
    if (input.options?.pickup_only && input.options?.delivery_only) {
      throw new AppError(ErrorCode.VALIDATION, 'Choose pickup only or delivery only, not both', 400);
    }
    if (input.promoText && !input.options?.promo_banner) {
      throw new AppError(ErrorCode.VALIDATION, 'Turn on the promo banner option to set promo text', 400);
    }
  }

  /** Masks anything the current plan no longer includes. */
  effective(row: Row, e: Entitlements) {
    const options = Object.fromEntries(
      Object.entries((row.features ?? {}) as Record<string, boolean>).filter(([, v]) => v && e.app.extra_options),
    ) as Partial<Record<AppOption, boolean>>;
    return {
      version: row.version,
      name: row.appName,
      theme: row.theme as AppTheme,
      splash: e.app.custom_splash ? (row.splash ?? null) : null,
      layout: (e.app.custom_layout ? row.layout : 'list') as AppLayout,
      options,
      promoText: options.promo_banner ? (row.promoText ?? null) : null,
      domain: e.app.custom_domain ? row.domain : null,
    };
  }

  async latestPublished(tx: Tx) {
    const [row] = await tx.select().from(appConfigs).where(isNotNull(appConfigs.publishedAt)).orderBy(desc(appConfigs.version)).limit(1);
    return row ?? null;
  }

  /** Creates a new, unpublished version (the setup form in the staff console). */
  async createVersion(slug: string, input: AppConfigInput, actorId: string | null = null) {
    const tenant = await this.tenantBySlug(slug);
    const { plan, entitlements } = await this.entitlements.getEntitlements(tenant.id);
    this.validate(entitlements, plan, input);
    return this.db.tenant(tenant.id, async (tx) => {
      const [{ v }] = await tx.select({ v: max(appConfigs.version) }).from(appConfigs);
      const [prev] = await tx.select().from(appConfigs).where(eq(appConfigs.version, v ?? 0));
      const [row] = await tx
        .insert(appConfigs)
        .values({
          tenantId: tenant.id,
          version: (v ?? 0) + 1,
          appName: input.appName,
          bundleId: prev?.bundleId ?? bundleIdFor(slug),
          theme: input.theme,
          splash: input.splash ?? null,
          layout: input.layout ?? 'list',
          features: (input.options ?? {}) as Record<string, boolean>,
          promoText: input.promoText ?? null,
          domain: input.domain ?? null,
          createdBy: actorId,
        })
        .returning();
      await this.audit.record(tx, { tenantId: tenant.id, actorId, action: 'app_config.create', entity: 'app_config', entityId: row.id, after: input });
      return row;
    });
  }

  async publish(slug: string, version: number, actorId: string | null = null) {
    const tenant = await this.tenantBySlug(slug);
    return this.db.tenant(tenant.id, async (tx) => {
      const [row] = await tx
        .update(appConfigs)
        .set({ publishedAt: new Date() })
        .where(and(eq(appConfigs.tenantId, tenant.id), eq(appConfigs.version, version)))
        .returning();
      if (!row) throw notFound('App config version');
      await this.audit.record(tx, { tenantId: tenant.id, actorId, action: 'app_config.publish', entity: 'app_config', entityId: row.id, after: { version } });
      return row;
    });
  }

  /**
   * Everything the build pipeline needs to produce this restaurant's app. Uses the latest
   * version (published or not), masked by the plan, so staff can build before publishing.
   */
  async buildConfig(slug: string) {
    const tenant = await this.tenantBySlug(slug);
    const { plan, entitlements } = await this.entitlements.getEntitlements(tenant.id);
    return this.db.tenant(tenant.id, async (tx) => {
      const [row] = await tx.select().from(appConfigs).orderBy(desc(appConfigs.version)).limit(1);
      if (!row) throw notFound('App config');
      return {
        slug: tenant.slug,
        plan,
        bundleId: row.bundleId,
        scheme: schemeFor(tenant.slug),
        apiUrl: this.config.PUBLIC_API_URL,
        ...this.effective(row, entitlements),
      };
    });
  }

  private async tenantBySlug(slug: string) {
    const [t] = await this.db.global((tx) => tx.select().from(tenants).where(eq(tenants.slug, slug)));
    if (!t) throw notFound('Restaurant');
    return t;
  }
}

/** com.cullinari.mamaskitchen */
export const bundleIdFor = (slug: string) => `com.cullinari.${slug.replace(/[^a-z0-9]/g, '')}`;
/** Deep-link scheme, e.g. cullinari-mamaskitchen:// */
export const schemeFor = (slug: string) => `cullinari-${slug.replace(/[^a-z0-9]/g, '')}`;
