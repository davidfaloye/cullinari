import { Controller, Headers, HttpCode, Inject, Logger, Param, Post, RawBodyRequest, Req } from '@nestjs/common';
import type { Request } from 'express';
import { eq } from 'drizzle-orm';
import { Public } from '../auth/auth.context';
import { decryptSecret } from '../common/crypto';
import { forbidden, notFound } from '../common/errors';
import { AppConfig, CONFIG } from '../config';
import { Db } from '../db/db.service';
import { tenants, tenantSettings } from '../db/schema';
import { OrdersService } from '../orders/orders.service';
import { PaystackService } from './paystack.service';

/**
 * Paystack webhooks. Each restaurant sets this URL in its own Paystack dashboard:
 *   {PUBLIC_API_URL}/webhooks/paystack/{slug}
 * The signature is checked against that restaurant's secret key, and processing is
 * idempotent on the transaction reference.
 */
@Public()
@Controller('webhooks/paystack')
export class WebhooksController {
  private readonly logger = new Logger('Webhooks');

  constructor(
    private readonly db: Db,
    private readonly paystack: PaystackService,
    private readonly orders: OrdersService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Post(':slug')
  @HttpCode(200)
  async paystackEvent(
    @Param('slug') slug: string,
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') signature?: string,
  ) {
    const [tenant] = await this.db.global((tx) => tx.select().from(tenants).where(eq(tenants.slug, slug)));
    if (!tenant) throw notFound('Restaurant');

    const secretEnc = await this.db.tenant(tenant.id, async (tx) => {
      const [s] = await tx.select({ k: tenantSettings.paystackSecretKeyEnc }).from(tenantSettings);
      return s?.k;
    });
    if (!secretEnc || !req.rawBody) throw forbidden('Webhook not accepted');
    const secret = decryptSecret(secretEnc, this.config.DATA_KEY);
    if (!this.paystack.isValidSignature(req.rawBody, signature, secret)) throw forbidden('Invalid signature');

    const event = req.body as { event?: string; data?: { reference?: string; status?: string; amount?: number } };
    if (event.event !== 'charge.success' || !event.data?.reference) return { received: true };

    try {
      await this.orders.confirmPayment(tenant.id, event.data.reference, {
        status: event.data.status ?? 'success',
        amountMinor: Number(event.data.amount ?? 0),
        raw: event.data,
      });
    } catch (err) {
      // Unknown reference (e.g. a payment not made through Cullinari): acknowledge so Paystack stops retrying.
      this.logger.warn(`Paystack webhook for ${slug} not applied: ${String(err)}`);
    }
    return { received: true };
  }
}
