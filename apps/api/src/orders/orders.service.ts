import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNull, lt, notInArray, sql } from 'drizzle-orm';
import {
  allowedNextStatuses,
  ErrorCode,
  priceCart,
  STATUS_ROLES,
  type FulfilmentType,
  type OrderStatus,
  type OrderView,
  type PaymentMethod,
} from '@cullinari/shared';
import { AppConfig, CONFIG } from '../config';
import { AuthContext, assertBranchAccess } from '../auth/auth.context';
import { AuditService } from '../common/audit.service';
import { decryptSecret, randomToken } from '../common/crypto';
import { AppError, notFound } from '../common/errors';
import { Db, type Tx } from '../db/db.service';
import {
  branches,
  customers,
  menuItems,
  orderItems,
  orders,
  payments,
  tenants,
  tenantSettings,
} from '../db/schema';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { isOpenNow } from '../branches/hours';
import { PushService } from '../notifications/push.service';
import { PaystackService } from '../payments/paystack.service';
import { EventsGateway } from '../realtime/events.gateway';

export interface PlaceOrderInput {
  branchId: string;
  fulfilment: FulfilmentType;
  paymentMethod: PaymentMethod;
  items: { menuItemId: string; quantity: number; note?: string }[];
  customer: { name: string; phone: string; email?: string };
  deliveryAddress?: string;
  note?: string;
  pushToken?: string;
  /** App deep link to return to after card checkout, e.g. olaskitchen://payment */
  returnUrl?: string;
}

type TenantRow = typeof tenants.$inferSelect;

const ACCEPTING_STATUSES = ['onboarding', 'active', 'past_due'];

@Injectable()
export class OrdersService {
  private readonly logger = new Logger('Orders');

  constructor(
    private readonly db: Db,
    private readonly entitlements: EntitlementsService,
    private readonly events: EventsGateway,
    private readonly push: PushService,
    private readonly paystack: PaystackService,
    private readonly audit: AuditService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Checkout from the ordering app. Prices come from the menu, never from the client.
   * The daily cap is counted in the same transaction as the order insert, so a failed
   * insert gives the slot back and concurrent checkouts can't overshoot the cap.
   */
  async place(tenant: TenantRow, input: PlaceOrderInput) {
    if (!ACCEPTING_STATUSES.includes(tenant.status)) {
      throw new AppError(ErrorCode.ORDERING_PAUSED, "We're not taking online orders right now", 403);
    }

    const placed = await this.db.tenant(tenant.id, async (tx) => {
      const [settings] = await tx.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenant.id));
      if (!settings || settings.orderingPaused) {
        throw new AppError(ErrorCode.ORDERING_PAUSED, "We're not taking online orders right now", 403);
      }

      const [branch] = await tx
        .select()
        .from(branches)
        .where(and(eq(branches.id, input.branchId), eq(branches.isActive, true)));
      if (!branch) throw notFound('Branch');
      if (!isOpenNow(branch.hours, tenant.timezone)) {
        throw new AppError(ErrorCode.BRANCH_CLOSED, `${branch.name} is closed right now`, 403);
      }

      // Price every line from the menu.
      const ids = [...new Set(input.items.map((i) => i.menuItemId))];
      const menu = await tx
        .select()
        .from(menuItems)
        .where(and(inArray(menuItems.id, ids), isNull(menuItems.archivedAt)));
      const byId = new Map(menu.map((m) => [m.id, m]));
      const unavailable = ids.filter((id) => {
        const m = byId.get(id);
        return !m || !m.isAvailable || (m.branchId !== null && m.branchId !== branch.id);
      });
      if (unavailable.length) {
        throw new AppError(ErrorCode.ITEM_UNAVAILABLE, 'Some items are no longer available', 409, {
          menuItemIds: unavailable,
        });
      }

      const lines = input.items.map((i) => {
        const m = byId.get(i.menuItemId)!;
        return { menuItemId: m.id, name: m.name, unitPriceMinor: m.priceMinor, quantity: i.quantity, note: i.note ?? null };
      });
      const priced = priceCart(
        lines.map((l) => ({ priceMinor: l.unitPriceMinor, quantity: l.quantity })),
        { fulfilment: input.fulfilment, deliveryFeeMinor: settings.deliveryFeeMinor, taxRateBps: settings.taxRateBps },
      );
      const { subtotalMinor: subtotal, deliveryFeeMinor: deliveryFee, taxMinor: tax, totalMinor: total } = priced;

      if (input.fulfilment === 'delivery' && !input.deliveryAddress?.trim()) {
        throw new AppError(ErrorCode.VALIDATION, 'Add a delivery address', 400);
      }
      if (input.paymentMethod === 'pay_on_delivery' && !settings.payOnDeliveryEnabled) {
        throw new AppError(ErrorCode.PAYMENT_UNAVAILABLE, 'Pay on delivery is not available', 400);
      }
      if (input.paymentMethod === 'paystack' && !settings.paystackSecretKeyEnc) {
        throw new AppError(ErrorCode.PAYMENT_UNAVAILABLE, 'Card payment is not set up for this restaurant yet', 400);
      }

      // Cap check last, so a rejected cart never uses up a slot.
      await this.entitlements.consumeOrderSlot(tx, tenant.id, tenant.timezone);

      const [customer] = await tx
        .insert(customers)
        .values({
          tenantId: tenant.id,
          phone: input.customer.phone,
          name: input.customer.name,
          email: input.customer.email ?? null,
          addresses: input.deliveryAddress ? [input.deliveryAddress] : [],
        })
        .onConflictDoUpdate({
          target: [customers.tenantId, customers.phone],
          set: {
            name: sql`excluded.name`,
            email: sql`coalesce(excluded.email, ${customers.email})`,
          },
        })
        .returning();

      const [{ seq }] = await tx
        .update(tenantSettings)
        .set({ orderSeq: sql`${tenantSettings.orderSeq} + 1` })
        .where(eq(tenantSettings.tenantId, tenant.id))
        .returning({ seq: tenantSettings.orderSeq });

      const [order] = await tx
        .insert(orders)
        .values({
          tenantId: tenant.id,
          branchId: branch.id,
          customerId: customer.id,
          number: seq,
          fulfilment: input.fulfilment,
          channel: 'app',
          paymentMethod: input.paymentMethod,
          paymentStatus: input.paymentMethod === 'paystack' ? 'pending' : 'not_required',
          subtotalMinor: subtotal,
          deliveryFeeMinor: deliveryFee,
          taxMinor: tax,
          totalMinor: total,
          deliveryAddress: input.fulfilment === 'delivery' ? input.deliveryAddress!.trim() : null,
          note: input.note ?? null,
          trackingToken: randomToken(18),
          pushToken: input.pushToken ?? null,
        })
        .returning();
      await tx.insert(orderItems).values(lines.map((l) => ({ ...l, tenantId: tenant.id, orderId: order.id })));

      let reference: string | null = null;
      if (input.paymentMethod === 'paystack') {
        reference = `CUL-${tenant.slug.slice(0, 12).toUpperCase()}-${seq}-${randomToken(4)}`;
        await tx.insert(payments).values({
          tenantId: tenant.id,
          orderId: order.id,
          provider: 'paystack',
          amountMinor: total,
          status: 'pending',
          reference,
          returnUrl: input.returnUrl ?? null,
        });
      }

      return { order, reference, secretEnc: settings.paystackSecretKeyEnc, publicKey: settings.paystackPublicKey };
    });

    const { order, reference } = placed;
    let payment: { authorizationUrl: string; accessCode: string; reference: string; publicKey: string | null } | null = null;

    if (reference) {
      try {
        const secret = decryptSecret(placed.secretEnc!, this.config.DATA_KEY);
        const init = await this.paystack.initialize(secret, {
          email: input.customer.email || `${input.customer.phone.replace(/\D/g, '')}@customers.cullinari.com`,
          amountMinor: order.totalMinor,
          currency: tenant.currency,
          reference,
          // Paystack sends the customer here; the API confirms payment and redirects into the app.
          callbackUrl: `${this.config.PUBLIC_API_URL}/public/${tenant.slug}/payments/return`,
          metadata: { tenant: tenant.slug, orderNumber: order.number },
        });
        payment = { ...init, publicKey: placed.publicKey };
      } catch (err) {
        this.logger.warn(`Payment could not start for order ${order.id}: ${String(err)}`);
        await this.db.tenant(tenant.id, async (tx) => {
          await tx
            .update(orders)
            .set({ status: 'cancelled', paymentStatus: 'failed', cancelReason: 'Card payment could not be started' })
            .where(eq(orders.id, order.id));
          await tx.update(payments).set({ status: 'failed' }).where(eq(payments.reference, reference));
          await this.entitlements.releaseOrderSlot(tx, tenant.id, order.placedAt, tenant.timezone);
        });
        throw new AppError(ErrorCode.PAYMENT_UNAVAILABLE, 'Card payment could not be started. Try again or pay on delivery.', 502);
      }
    }

    await this.broadcast(tenant.id, order.id, 'created');
    void this.entitlements
      .usage(tenant.id, tenant.timezone)
      .then((u) => this.events.usageUpdated(tenant.id, u))
      .catch(() => undefined);

    return {
      orderId: order.id,
      number: order.number,
      status: order.status as OrderStatus,
      trackingToken: order.trackingToken,
      subtotalMinor: order.subtotalMinor,
      deliveryFeeMinor: order.deliveryFeeMinor,
      taxMinor: order.taxMinor,
      totalMinor: order.totalMinor,
      currency: tenant.currency,
      payment,
    };
  }

  async transition(auth: AuthContext, orderId: string, to: OrderStatus, reason?: string) {
    const result = await this.db.tenant(auth.tenantId, async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
      if (!order) throw notFound('Order');
      assertBranchAccess(auth, order.branchId);

      const from = order.status as OrderStatus;
      if (!allowedNextStatuses(from, order.fulfilment as FulfilmentType).includes(to)) {
        throw new AppError(ErrorCode.INVALID_TRANSITION, `An order that is ${from} cannot be moved to ${to}`, 409, {
          from,
          to,
        });
      }
      if (!STATUS_ROLES[to].includes(auth.role)) {
        throw new AppError(ErrorCode.FORBIDDEN, 'Your role cannot make this change', 403);
      }
      if (to === 'accepted' && order.paymentMethod === 'paystack' && order.paymentStatus !== 'paid') {
        throw new AppError(ErrorCode.PAYMENT_PENDING, 'Wait until the card payment is confirmed', 409);
      }

      const patch: Partial<typeof orders.$inferInsert> = { status: to };
      if (to === 'completed') {
        patch.completedAt = new Date();
        // Pay-on-delivery orders are settled when they're completed.
        if (order.paymentMethod === 'pay_on_delivery') patch.paymentStatus = 'paid';
      }
      if (to === 'cancelled') patch.cancelReason = reason ?? null;

      await tx.update(orders).set(patch).where(eq(orders.id, orderId));
      if (to === 'cancelled') {
        await this.audit.record(tx, {
          tenantId: auth.tenantId,
          actorId: auth.userId,
          action: 'order.cancel',
          entity: 'order',
          entityId: orderId,
          before: { status: from },
          after: { status: to, reason, paymentStatus: order.paymentStatus },
        });
      }
      const [tenant] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, auth.tenantId));
      return { order, tenantName: tenant.name };
    });

    this.push.orderStatus(result.order.pushToken, result.tenantName, result.order.number, to, result.order.trackingToken);
    return this.broadcast(auth.tenantId, orderId, 'updated');
  }

  /**
   * Marks a card payment as paid. Called by the webhook and the app's verify call; safe to
   * call more than once for the same reference.
   */
  async confirmPayment(tenantId: string, reference: string, verified: { status: string; amountMinor: number; raw: unknown }) {
    const outcome = await this.db.tenant(tenantId, async (tx) => {
      const [payment] = await tx.select().from(payments).where(eq(payments.reference, reference)).for('update');
      if (!payment) throw notFound('Payment');
      if (payment.status === 'paid') return { orderId: payment.orderId, changed: false, status: 'paid' };

      let status: 'paid' | 'failed' | 'pending' = 'pending';
      if (verified.status === 'success') {
        status = verified.amountMinor === payment.amountMinor ? 'paid' : 'failed';
        if (status === 'failed') this.logger.error(`Amount mismatch on ${reference}: got ${verified.amountMinor}, expected ${payment.amountMinor}`);
      } else if (['failed', 'reversed'].includes(verified.status)) {
        status = 'failed';
      }
      if (status === 'pending') return { orderId: payment.orderId, changed: false, status };

      await tx.update(payments).set({ status, raw: verified.raw as never }).where(eq(payments.id, payment.id));
      await tx.update(orders).set({ paymentStatus: status }).where(eq(orders.id, payment.orderId));
      await this.audit.record(tx, {
        tenantId,
        actorId: null,
        action: `payment.${status}`,
        entity: 'payment',
        entityId: payment.id,
        after: { reference, amountMinor: verified.amountMinor },
      });
      return { orderId: payment.orderId, changed: true, status };
    });
    if (outcome.changed) await this.broadcast(tenantId, outcome.orderId, 'updated');
    return outcome;
  }

  async list(
    auth: AuthContext,
    q: { view: 'active' | 'history'; branchId?: string; from?: Date; to?: Date; limit: number; offset: number },
  ): Promise<OrderView[]> {
    return this.db.tenant(auth.tenantId, async (tx) => {
      const done = ['completed', 'cancelled'];
      const rows = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(
          and(
            q.branchId ? eq(orders.branchId, q.branchId) : undefined,
            q.view === 'active' ? notInArray(orders.status, done) : inArray(orders.status, done),
            q.from ? gte(orders.placedAt, q.from) : undefined,
            q.to ? lt(orders.placedAt, q.to) : undefined,
          ),
        )
        .orderBy(q.view === 'active' ? orders.placedAt : desc(orders.placedAt))
        .limit(q.limit)
        .offset(q.offset);
      return this.views(tx, rows.map((r) => r.id));
    });
  }

  async get(auth: AuthContext, id: string): Promise<OrderView> {
    return this.db.tenant(auth.tenantId, async (tx) => {
      const [view] = await this.views(tx, [id]);
      if (!view) throw notFound('Order');
      assertBranchAccess(auth, view.branchId);
      return view;
    });
  }

  /** Loads orders with their items, customer and branch name, in the given id order. */
  async views(tx: Tx, ids: string[]): Promise<OrderView[]> {
    if (!ids.length) return [];
    const rows = await tx
      .select({ o: orders, branchName: branches.name, c: { id: customers.id, name: customers.name, phone: customers.phone } })
      .from(orders)
      .innerJoin(branches, eq(branches.id, orders.branchId))
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .where(inArray(orders.id, ids));
    const items = await tx.select().from(orderItems).where(inArray(orderItems.orderId, ids));
    const byOrder = new Map<string, OrderView['items']>();
    for (const i of items) {
      const list = byOrder.get(i.orderId) ?? [];
      list.push({ id: i.id, name: i.name, quantity: i.quantity, unitPriceMinor: i.unitPriceMinor, note: i.note });
      byOrder.set(i.orderId, list);
    }
    const map = new Map(
      rows.map(({ o, branchName, c }) => [
        o.id,
        {
          id: o.id,
          number: o.number,
          branchId: o.branchId,
          branchName,
          status: o.status as OrderView['status'],
          fulfilment: o.fulfilment as OrderView['fulfilment'],
          channel: o.channel,
          paymentMethod: o.paymentMethod as OrderView['paymentMethod'],
          paymentStatus: o.paymentStatus as OrderView['paymentStatus'],
          subtotalMinor: o.subtotalMinor,
          deliveryFeeMinor: o.deliveryFeeMinor,
          taxMinor: o.taxMinor,
          totalMinor: o.totalMinor,
          deliveryAddress: o.deliveryAddress,
          note: o.note,
          cancelReason: o.cancelReason,
          customer: c?.id ? { id: c.id, name: c.name, phone: c.phone } : null,
          items: byOrder.get(o.id) ?? [],
          placedAt: o.placedAt.toISOString(),
          updatedAt: o.updatedAt.toISOString(),
          completedAt: o.completedAt?.toISOString() ?? null,
        } satisfies OrderView,
      ]),
    );
    return ids.map((id) => map.get(id)).filter((v): v is OrderView => !!v);
  }

  private async broadcast(tenantId: string, orderId: string, kind: 'created' | 'updated'): Promise<OrderView> {
    const [view] = await this.db.tenant(tenantId, (tx) => this.views(tx, [orderId]));
    if (kind === 'created') this.events.orderCreated(tenantId, view.branchId, view);
    else this.events.orderUpdated(tenantId, view.branchId, view);
    return view;
  }
}
