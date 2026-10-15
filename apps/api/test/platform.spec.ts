import { INestApplication } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { ErrorCode } from '@cullinari/shared';
import { Db } from '../src/db/db.service';
import { orders } from '../src/db/schema';
import { addMenuItem, bearer, makeTenant, orderBody, STAFF, startApp, TestTenant } from './helpers';

let app: INestApplication;
let http: ReturnType<INestApplication['getHttpServer']>;

beforeAll(async () => {
  app = await startApp();
  http = app.getHttpServer();
});
afterAll(async () => {
  await app.close();
});

describe('tenant isolation', () => {
  let a: TestTenant;
  let b: TestTenant;
  let bOrderId: string;

  beforeAll(async () => {
    a = await makeTenant(app);
    b = await makeTenant(app);
    const item = await addMenuItem(app, b);
    const placed = await request(http).post(`/public/${b.slug}/orders`).send(orderBody(b, item.id));
    expect(placed.status).toBe(201);
    bOrderId = placed.body.orderId;
  });

  it("an owner cannot read another restaurant's order through the API", async () => {
    const res = await request(http).get(`/orders/${bOrderId}`).set(bearer(a.token));
    expect(res.status).toBe(404);
    const list = await request(http).get('/orders').set(bearer(a.token));
    expect(list.body).toEqual([]);
  });

  it('row-level security hides other tenants even when a query has no tenant filter', async () => {
    const db = app.get(Db);
    const seenByA = await db.tenant(a.id, (tx) => tx.select().from(orders));
    expect(seenByA.find((o) => o.id === bOrderId)).toBeUndefined();
    const seenByB = await db.tenant(b.id, (tx) => tx.select().from(orders));
    expect(seenByB.map((o) => o.id)).toContain(bOrderId);
    // With no tenant set at all, nothing is visible.
    const none = await db.global((tx) => tx.select().from(orders));
    expect(none).toEqual([]);
  });

  it("cannot write a row into another tenant's data", async () => {
    const db = app.get(Db);
    await expect(
      db.tenant(a.id, (tx) => tx.execute(sql`insert into menu_categories (tenant_id, name) values (${b.id}, 'sneaky')`)),
    ).rejects.toMatchObject({ cause: expect.objectContaining({ message: expect.stringMatching(/row-level security/) }) });
  });
});

describe('daily order cap', () => {
  it('lets exactly the cap through when orders arrive at the same time', async () => {
    const t = await makeTenant(app, 'starter');
    await request(http)
      .post(`/internal/tenants/${t.id}/overrides`)
      .set(STAFF)
      .send({ key: 'max_orders_per_day', value: 5, reason: 'test' })
      .expect(201);
    const item = await addMenuItem(app, t);

    const results = await Promise.all(
      Array.from({ length: 12 }, () => request(http).post(`/public/${t.slug}/orders`).send(orderBody(t, item.id))),
    );
    const ok = results.filter((r) => r.status === 201);
    const capped = results.filter((r) => r.status === 403);
    expect(ok).toHaveLength(5);
    expect(capped).toHaveLength(7);
    expect(capped[0].body.code).toBe(ErrorCode.PLAN_LIMIT_ORDERS);

    const usage = await request(http).get('/usage').set(bearer(t.token));
    expect(usage.body.orders_today).toMatchObject({ used: 5, limit: 5, state: 'reached' });

    const config = await request(http).get(`/public/${t.slug}`);
    expect(config.body.ordering).toEqual({ open: false, reason: 'daily_limit' });

    // An upgrade applies at once.
    await request(http).patch(`/internal/tenants/${t.id}`).set(STAFF).send({ planCode: 'pro' }).expect(200);
    await request(http)
      .post(`/internal/tenants/${t.id}/overrides`)
      .set(STAFF)
      .send({ key: 'max_orders_per_day', value: null, reason: 'pro is unlimited' })
      .expect(201);
    const after = await request(http).post(`/public/${t.slug}/orders`).send(orderBody(t, item.id));
    expect(after.status).toBe(201);
  });

  it('does not use up a slot when the cart is rejected', async () => {
    const t = await makeTenant(app);
    const bad = await request(http)
      .post(`/public/${t.slug}/orders`)
      .send(orderBody(t, '00000000-0000-4000-8000-000000000000'));
    expect(bad.status).toBe(409);
    expect(bad.body.code).toBe(ErrorCode.ITEM_UNAVAILABLE);
    const usage = await request(http).get('/usage').set(bearer(t.token));
    expect(usage.body.orders_today.used).toBe(0);
  });
});

describe('inventory and branch caps', () => {
  it('holds the inventory cap under concurrent creates, and editing still works at the cap', async () => {
    const t = await makeTenant(app);
    await request(http)
      .post(`/internal/tenants/${t.id}/overrides`)
      .set(STAFF)
      .send({ key: 'max_inventory_items', value: 3, reason: 'test' })
      .expect(201);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        request(http).post('/inventory').set(bearer(t.token)).send({ name: `Item ${i}`, unit: 'kg', qty: 1 }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    const refused = results.find((r) => r.status === 403)!;
    expect(refused.body.code).toBe(ErrorCode.PLAN_LIMIT_ITEMS);

    const first = results.find((r) => r.status === 201)!.body;
    await request(http).patch(`/inventory/${first.id}`).set(bearer(t.token)).send({ reorderLevel: 2 }).expect(200);

    // Archiving frees a slot; unarchiving needs one.
    await request(http).post(`/inventory/${first.id}/archive`).set(bearer(t.token)).expect(201);
    await request(http).post('/inventory').set(bearer(t.token)).send({ name: 'New', unit: 'kg' }).expect(201);
    const unarchive = await request(http).post(`/inventory/${first.id}/unarchive`).set(bearer(t.token));
    expect(unarchive.status).toBe(403);
  });

  it('Starter allows one branch; Growth allows three', async () => {
    const t = await makeTenant(app, 'starter');
    const denied = await request(http).post('/branches').set(bearer(t.token)).send({ name: 'Second' });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe(ErrorCode.PLAN_LIMIT_BRANCHES);

    await request(http).patch(`/internal/tenants/${t.id}`).set(STAFF).send({ planCode: 'growth' }).expect(200);
    await request(http).post('/branches').set(bearer(t.token)).send({ name: 'Second' }).expect(201);
    await request(http).post('/branches').set(bearer(t.token)).send({ name: 'Third' }).expect(201);
    await request(http).post('/branches').set(bearer(t.token)).send({ name: 'Fourth' }).expect(403);
  });
});

describe('orders', () => {
  let t: TestTenant;
  let item: { id: string; priceMinor: number };

  beforeAll(async () => {
    t = await makeTenant(app);
    item = await addMenuItem(app, t, 350000);
    await request(http).patch('/settings').set(bearer(t.token)).send({ deliveryFeeMinor: 150000 }).expect(200);
  });

  it('prices orders from the menu, not from the client', async () => {
    const res = await request(http)
      .post(`/public/${t.slug}/orders`)
      .send({ ...orderBody(t, item.id, { fulfilment: 'delivery', deliveryAddress: '5 Jabi Road' }), totalMinor: 1 });
    expect(res.status).toBe(201);
    expect(res.body.subtotalMinor).toBe(700000);
    expect(res.body.totalMinor).toBe(850000);

    const track = await request(http).get(`/public/${t.slug}/orders/${res.body.trackingToken}`);
    expect(track.body).toMatchObject({ status: 'placed', totalMinor: 850000 });
    expect(track.body.id).toBeUndefined();
  });

  it('enforces the status flow and who may move an order', async () => {
    const placed = await request(http).post(`/public/${t.slug}/orders`).send(orderBody(t, item.id));
    const id = placed.body.orderId;

    const jump = await request(http).patch(`/orders/${id}/status`).set(bearer(t.token)).send({ status: 'completed' });
    expect(jump.status).toBe(409);
    expect(jump.body.code).toBe(ErrorCode.INVALID_TRANSITION);

    // A kitchen user can't accept, but can mark preparing/ready.
    const invite = await request(http).post('/team').set(bearer(t.token)).send({ email: `k-${t.slug}@test.local`, name: 'Kitchen', role: 'kitchen' });
    expect(invite.status).toBe(201);
    const kLogin = await request(http).post('/auth/login').send({ email: `k-${t.slug}@test.local`, password: invite.body.temporaryPassword });
    const kitchen = kLogin.body.token;
    expect((await request(http).patch(`/orders/${id}/status`).set(bearer(kitchen)).send({ status: 'accepted' })).status).toBe(403);

    for (const status of ['accepted']) await request(http).patch(`/orders/${id}/status`).set(bearer(t.token)).send({ status }).expect(200);
    for (const status of ['preparing', 'ready']) await request(http).patch(`/orders/${id}/status`).set(bearer(kitchen)).send({ status }).expect(200);
    const done = await request(http).patch(`/orders/${id}/status`).set(bearer(t.token)).send({ status: 'completed' });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: 'completed', paymentStatus: 'paid' });

    // Kitchen staff can't open the menu editor or settings.
    await request(http).post('/menu/items').set(bearer(kitchen)).send({ name: 'x', priceMinor: 1 }).expect(403);
    await request(http).get('/settings').set(bearer(kitchen)).expect(403);
  });

  it('restricted subscriptions make the admin read-only', async () => {
    const r = await makeTenant(app);
    await request(http).patch(`/internal/tenants/${r.id}`).set(STAFF).send({ status: 'restricted' }).expect(200);
    await request(http).get('/branches').set(bearer(r.token)).expect(200);
    const write = await request(http).post('/menu/categories').set(bearer(r.token)).send({ name: 'Rice' });
    expect(write.status).toBe(403);
    expect(write.body.code).toBe(ErrorCode.TENANT_RESTRICTED);
  });
});

describe('Paystack', () => {
  const secret = 'sk_test_abc123';
  let t: TestTenant;
  let item: { id: string };
  let realFetch: typeof fetch;

  beforeAll(async () => {
    t = await makeTenant(app);
    item = await addMenuItem(app, t, 200000);
    await request(http).patch('/settings').set(bearer(t.token)).send({ paystackSecretKey: secret, paystackPublicKey: 'pk_test_abc123' }).expect(200);
    realFetch = global.fetch;
    global.fetch = (async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes('/transaction/initialize')) {
        const body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ status: true, data: { authorization_url: 'https://checkout.paystack.com/x', access_code: 'ac_1', reference: body.reference } }));
      }
      return realFetch(url, init);
    }) as typeof fetch;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  it('never stores or returns the secret key in plain text', async () => {
    const s = await request(http).get('/settings').set(bearer(t.token));
    expect(s.body.paystackSecretKeySet).toBe(true);
    expect(JSON.stringify(s.body)).not.toContain(secret);
  });

  it('holds card orders until a correctly signed webhook confirms payment, once', async () => {
    const placed = await request(http).post(`/public/${t.slug}/orders`).send(orderBody(t, item.id, { paymentMethod: 'paystack' }));
    expect(placed.status).toBe(201);
    const { reference } = placed.body.payment;

    const early = await request(http).patch(`/orders/${placed.body.orderId}/status`).set(bearer(t.token)).send({ status: 'accepted' });
    expect(early.body.code).toBe(ErrorCode.PAYMENT_PENDING);

    const event = JSON.stringify({ event: 'charge.success', data: { reference, status: 'success', amount: placed.body.totalMinor } });
    await request(http).post(`/webhooks/paystack/${t.slug}`).set('x-paystack-signature', 'bad').set('content-type', 'application/json').send(event).expect(403);

    const sig = createHmac('sha512', secret).update(event).digest('hex');
    for (let i = 0; i < 2; i++) {
      await request(http).post(`/webhooks/paystack/${t.slug}`).set('x-paystack-signature', sig).set('content-type', 'application/json').send(event).expect(200);
    }
    const order = await request(http).get(`/orders/${placed.body.orderId}`).set(bearer(t.token));
    expect(order.body.paymentStatus).toBe('paid');
    await request(http).patch(`/orders/${placed.body.orderId}/status`).set(bearer(t.token)).send({ status: 'accepted' }).expect(200);
  });
});
