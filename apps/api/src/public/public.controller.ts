import { Body, Controller, Get, HttpCode, Inject, Ip, Param, Post, Query } from '@nestjs/common';
import { and, asc, desc, eq, isNotNull, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { ErrorCode } from '@cullinari/shared';
import { Public } from '../auth/auth.context';
import { isOpenNow } from '../branches/hours';
import { decryptSecret } from '../common/crypto';
import { AppError, notFound } from '../common/errors';
import { RateLimiter } from '../common/rate-limit';
import { parse } from '../common/validate';
import { AppConfig, CONFIG } from '../config';
import { Db } from '../db/db.service';
import { appConfigs, branches, menuCategories, menuItems, orderItems, orders, tenants, tenantSettings } from '../db/schema';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { OrdersService } from '../orders/orders.service';
import { PaystackService } from '../payments/paystack.service';

const checkoutLimiter = new RateLimiter(20, 60_000);

const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a valid phone number');

const orderSchema = z.object({
  branchId: z.string().uuid(),
  fulfilment: z.enum(['delivery', 'pickup']),
  paymentMethod: z.enum(['paystack', 'pay_on_delivery']),
  items: z
    .array(
      z.object({
        menuItemId: z.string().uuid(),
        quantity: z.number().int().min(1).max(50),
        note: z.string().trim().max(200).optional(),
      }),
    )
    .min(1)
    .max(50),
  customer: z.object({ name: z.string().trim().min(1).max(80), phone, email: z.string().email().optional() }),
  deliveryAddress: z.string().trim().max(300).optional(),
  note: z.string().trim().max(300).optional(),
  pushToken: z.string().max(200).optional(),
  callbackUrl: z.string().url().optional(),
});

/**
 * Endpoints the restaurant's ordering app calls. No admin session: the restaurant is
 * identified by its slug, and every query still runs under that tenant's row-level security.
 */
@Public()
@Controller('public/:slug')
export class PublicController {
  constructor(
    private readonly db: Db,
    private readonly orders: OrdersService,
    private readonly entitlements: EntitlementsService,
    private readonly paystack: PaystackService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** Everything the app needs at launch: branding, branches, whether ordering is open, payment options. */
  @Get()
  async config_(@Param('slug') slug: string) {
    const tenant = await this.tenant(slug);
    const usage = await this.entitlements.usage(tenant.id, tenant.timezone);
    return this.db.tenant(tenant.id, async (tx) => {
      const [settings] = await tx.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenant.id));
      const [app] = await tx
        .select()
        .from(appConfigs)
        .where(isNotNull(appConfigs.publishedAt))
        .orderBy(desc(appConfigs.version))
        .limit(1);
      const branchList = await tx
        .select({ id: branches.id, name: branches.name, address: branches.address, phone: branches.phone, hours: branches.hours })
        .from(branches)
        .where(eq(branches.isActive, true))
        .orderBy(asc(branches.createdAt));

      const accepting = ['onboarding', 'active', 'past_due'].includes(tenant.status) && !settings?.orderingPaused;
      return {
        name: tenant.name,
        slug: tenant.slug,
        currency: tenant.currency,
        ordering: {
          open: accepting && usage.orders_today.state !== 'reached',
          reason: !accepting ? 'paused' : usage.orders_today.state === 'reached' ? 'daily_limit' : null,
        },
        branches: branchList.map((b) => ({ ...b, isOpen: isOpenNow(b.hours, tenant.timezone) })),
        payments: {
          payOnDelivery: settings?.payOnDeliveryEnabled ?? false,
          paystack: !!settings?.paystackSecretKeyEnc,
          paystackPublicKey: settings?.paystackPublicKey ?? null,
        },
        deliveryFeeMinor: settings?.deliveryFeeMinor ?? 0,
        app: app ? { version: app.version, name: app.appName, theme: app.theme, splash: app.splash, layout: app.layout, features: app.features } : null,
      };
    });
  }

  @Get('menu')
  async menu(@Param('slug') slug: string, @Query('branchId') branchId?: string) {
    const tenant = await this.tenant(slug);
    const branch = branchId ? z.string().uuid().parse(branchId) : undefined;
    return this.db.tenant(tenant.id, async (tx) => {
      const scope = <T extends typeof menuItems | typeof menuCategories>(t: T) =>
        branch ? or(isNull(t.branchId), eq(t.branchId, branch)) : isNull(t.branchId);
      const categories = await tx
        .select({ id: menuCategories.id, name: menuCategories.name })
        .from(menuCategories)
        .where(scope(menuCategories))
        .orderBy(asc(menuCategories.sortOrder), asc(menuCategories.name));
      const items = await tx
        .select({
          id: menuItems.id,
          categoryId: menuItems.categoryId,
          name: menuItems.name,
          description: menuItems.description,
          priceMinor: menuItems.priceMinor,
          imageUrl: menuItems.imageUrl,
          isAvailable: menuItems.isAvailable,
        })
        .from(menuItems)
        .where(and(isNull(menuItems.archivedAt), scope(menuItems)))
        .orderBy(asc(menuItems.sortOrder), asc(menuItems.name));
      return { categories, items };
    });
  }

  @Post('orders')
  async place(@Param('slug') slug: string, @Body() body: unknown, @Ip() ip: string) {
    checkoutLimiter.check(`${ip}:${slug}`);
    const input = parse(orderSchema, body);
    const tenant = await this.tenant(slug);
    return this.orders.place(tenant, input);
  }

  /** Order tracking. The token is unguessable and only given to the customer who placed it. */
  @Get('orders/:token')
  async track(@Param('slug') slug: string, @Param('token') token: string) {
    const tenant = await this.tenant(slug);
    return this.db.tenant(tenant.id, async (tx) => {
      const [order] = await tx
        .select({
          id: orders.id,
          number: orders.number,
          status: orders.status,
          fulfilment: orders.fulfilment,
          paymentMethod: orders.paymentMethod,
          paymentStatus: orders.paymentStatus,
          totalMinor: orders.totalMinor,
          subtotalMinor: orders.subtotalMinor,
          deliveryFeeMinor: orders.deliveryFeeMinor,
          taxMinor: orders.taxMinor,
          placedAt: orders.placedAt,
          updatedAt: orders.updatedAt,
          branchName: branches.name,
        })
        .from(orders)
        .innerJoin(branches, eq(branches.id, orders.branchId))
        .where(eq(orders.trackingToken, token));
      if (!order) throw notFound('Order');
      const items = await tx
        .select({ name: orderItems.name, quantity: orderItems.quantity, unitPriceMinor: orderItems.unitPriceMinor })
        .from(orderItems)
        .where(eq(orderItems.orderId, order.id));
      const { id: _id, ...rest } = order;
      return { ...rest, items };
    });
  }

  /** Called by the app after the Paystack checkout closes; confirms with Paystack directly. */
  @Post('payments/:reference/verify')
  @HttpCode(200)
  async verify(@Param('slug') slug: string, @Param('reference') reference: string) {
    const tenant = await this.tenant(slug);
    const secretEnc = await this.db.tenant(tenant.id, async (tx) => {
      const [s] = await tx.select({ k: tenantSettings.paystackSecretKeyEnc }).from(tenantSettings);
      return s?.k;
    });
    if (!secretEnc) throw new AppError(ErrorCode.PAYMENT_UNAVAILABLE, 'Card payment is not set up', 400);
    const verified = await this.paystack.verify(decryptSecret(secretEnc, this.config.DATA_KEY), reference);
    const outcome = await this.orders.confirmPayment(tenant.id, reference, verified);
    return { status: outcome.status };
  }

  private async tenant(slug: string) {
    const [t] = await this.db.global((tx) => tx.select().from(tenants).where(eq(tenants.slug, slug.toLowerCase())));
    if (!t || t.status === 'suspended') throw notFound('Restaurant');
    return t;
  }
}
