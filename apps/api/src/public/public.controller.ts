import { Body, Controller, Get, HttpCode, Inject, Ip, Logger, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { ErrorCode, type PublicRestaurantConfig } from '@cullinari/shared';
import { AppConfigService } from '../apps/app-config.service';
import { Public } from '../auth/auth.context';
import { isOpenNow } from '../branches/hours';
import { decryptSecret } from '../common/crypto';
import { AppError, notFound } from '../common/errors';
import { RateLimiter } from '../common/rate-limit';
import { parse } from '../common/validate';
import { AppConfig, CONFIG } from '../config';
import { Db } from '../db/db.service';
import { branches, menuCategories, menuItems, orderItems, orders, payments, tenants, tenantSettings } from '../db/schema';
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
  /** The app's own deep link (custom scheme) to come back to after card checkout. */
  returnUrl: z.string().max(300).optional(),
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
    private readonly apps: AppConfigService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  private readonly logger = new Logger('Public');

  /** Everything the app needs at launch: branding, branches, whether ordering is open, payment options. */
  @Get()
  async config_(@Param('slug') slug: string): Promise<PublicRestaurantConfig> {
    const tenant = await this.tenant(slug);
    const usage = await this.entitlements.usage(tenant.id, tenant.timezone);
    const { entitlements } = await this.entitlements.getEntitlements(tenant.id);
    return this.db.tenant(tenant.id, async (tx) => {
      const [settings] = await tx.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenant.id));
      const app = await this.apps.latestPublished(tx);
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
        taxRateBps: settings?.taxRateBps ?? 0,
        app: app ? (({ domain: _domain, ...rest }) => rest)(this.apps.effective(app, entitlements)) : null,
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
    if (input.returnUrl && !this.isAllowedReturnUrl(input.returnUrl)) {
      throw new AppError(ErrorCode.VALIDATION, 'returnUrl must be an app link', 400);
    }
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

  /**
   * Paystack sends the customer here after checkout (with ?reference=). We confirm the payment
   * with Paystack, then redirect into the app at its returnUrl with the order's tracking token.
   */
  @Get('payments/return')
  async paymentReturn(@Param('slug') slug: string, @Query('reference') reference: string | undefined, @Res() res: Response) {
    const tenant = await this.tenant(slug);
    if (!reference) throw notFound('Payment');
    const found = await this.db.tenant(tenant.id, async (tx) => {
      const [row] = await tx
        .select({ returnUrl: payments.returnUrl, token: orders.trackingToken, secretEnc: tenantSettings.paystackSecretKeyEnc })
        .from(payments)
        .innerJoin(orders, eq(orders.id, payments.orderId))
        .innerJoin(tenantSettings, eq(tenantSettings.tenantId, payments.tenantId))
        .where(eq(payments.reference, reference));
      return row;
    });
    if (!found) throw notFound('Payment');

    let status = 'pending';
    try {
      const verified = await this.paystack.verify(decryptSecret(found.secretEnc!, this.config.DATA_KEY), reference);
      status = (await this.orders.confirmPayment(tenant.id, reference, verified)).status;
    } catch (err) {
      // The webhook will still confirm it; the app polls the order either way.
      this.logger.warn(`Payment return verify failed for ${reference}: ${String(err)}`);
    }

    const query = `token=${encodeURIComponent(found.token)}&payment=${status}`;
    if (found.returnUrl && this.isAllowedReturnUrl(found.returnUrl)) {
      return res.redirect(302, `${found.returnUrl}${found.returnUrl.includes('?') ? '&' : '?'}${query}`);
    }
    // No app link (e.g. opened in a desktop browser): show a plain page.
    res.type('html').send(
      `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(tenant.name)}</title>` +
        `<body style="font-family:system-ui;padding:32px;text-align:center"><h1>${status === 'paid' ? 'Payment received' : 'Payment pending'}</h1>` +
        `<p>Return to the ${escapeHtml(tenant.name)} app to follow your order.</p></body>`,
    );
  }

  /**
   * Only redirect into apps: custom schemes (cullinari-mamaskitchen://, exp:// in development)
   * or a web origin this API already trusts. Prevents using the return page as an open redirect.
   */
  private isAllowedReturnUrl(url: string): boolean {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    const scheme = parsed.protocol.replace(':', '');
    if (['javascript', 'data', 'file', 'vbscript'].includes(scheme)) return false;
    if (scheme === 'http' || scheme === 'https') {
      return this.config.CORS_ORIGINS.split(',').map((o) => o.trim()).includes(parsed.origin);
    }
    return /^[a-z][a-z0-9+.-]*$/.test(scheme);
  }

  private async tenant(slug: string) {
    const [t] = await this.db.global((tx) => tx.select().from(tenants).where(eq(tenants.slug, slug.toLowerCase())));
    if (!t || t.status === 'suspended') throw notFound('Restaurant');
    return t;
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
