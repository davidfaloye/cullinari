// Seeds the plan catalogue (always) and a demo restaurant (unless SEED_DEMO=false).
// Runs as the schema owner, so it can write any tenant's rows.
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { PLAN_DEFINITIONS } from '@cullinari/shared';
import * as s from '../src/db/schema';

const DEMO = {
  slug: 'olaskitchen',
  name: "Ola's Kitchen",
  email: 'owner@olaskitchen.demo',
  password: 'cullinari-demo',
};

async function main() {
  const pool = new Pool({ connectionString: process.env.MIGRATE_DATABASE_URL });
  const db = drizzle(pool, { schema: s });

  for (const p of PLAN_DEFINITIONS) {
    await db
      .insert(s.plans)
      .values({ code: p.code, name: p.name, monthlyUsd: p.monthly_usd, setupUsd: p.setup_usd, entitlements: p.entitlements })
      .onConflictDoUpdate({
        target: s.plans.code,
        set: { name: p.name, monthlyUsd: p.monthly_usd, setupUsd: p.setup_usd, entitlements: p.entitlements },
      });
  }
  console.log(`Plans: ${PLAN_DEFINITIONS.map((p) => p.code).join(', ')}`);

  if (process.env.SEED_DEMO === 'false') return pool.end();

  const [exists] = await db.select().from(s.tenants).where(eq(s.tenants.slug, DEMO.slug));
  if (exists) {
    console.log(`Demo restaurant already exists (${DEMO.slug}).`);
    return pool.end();
  }

  await db.transaction(async (tx) => {
    const [tenant] = await tx
      .insert(s.tenants)
      .values({ name: DEMO.name, slug: DEMO.slug, planCode: 'growth', status: 'active' })
      .returning();
    await tx.insert(s.tenantSettings).values({ tenantId: tenant.id, deliveryFeeMinor: 150000 });
    const [wuse, garki] = await tx
      .insert(s.branches)
      .values([
        { tenantId: tenant.id, name: 'Wuse 2', address: '14 Aminu Kano Crescent, Wuse 2, Abuja', phone: '+234 800 000 0001' },
        { tenantId: tenant.id, name: 'Garki', address: '7 Ahmadu Bello Way, Garki, Abuja', phone: '+234 800 000 0002' },
      ])
      .returning();

    const hash = await bcrypt.hash(DEMO.password, 10);
    const [owner] = await tx
      .insert(s.users)
      .values({ email: DEMO.email, name: 'Ola Adeyemi', passwordHash: hash })
      .onConflictDoUpdate({ target: s.users.email, set: { passwordHash: hash } })
      .returning();
    const [kitchen] = await tx
      .insert(s.users)
      .values({ email: 'kitchen@olaskitchen.demo', name: 'Kitchen, Wuse 2', passwordHash: hash })
      .onConflictDoUpdate({ target: s.users.email, set: { passwordHash: hash } })
      .returning();
    await tx.insert(s.memberships).values([
      { userId: owner.id, tenantId: tenant.id, role: 'owner' },
      { userId: kitchen.id, tenantId: tenant.id, role: 'kitchen', branchId: wuse.id },
    ]);

    await tx.insert(s.appConfigs).values({
      tenantId: tenant.id,
      version: 1,
      appName: DEMO.name,
      bundleId: 'com.cullinari.olaskitchen',
      theme: { primary: '#0f6b4f', accent: '#b9e04c' },
      layout: 'list',
      publishedAt: new Date(),
    });

    const cats = await tx
      .insert(s.menuCategories)
      .values(['Rice', 'Soups', 'Grills', 'Drinks'].map((name, i) => ({ tenantId: tenant.id, name, sortOrder: i })))
      .returning();
    const cat = (n: string) => cats.find((c) => c.name === n)!.id;
    const menu = await tx
      .insert(s.menuItems)
      .values([
        { name: 'Jollof rice', description: 'Smoky party-style', priceMinor: 350000, categoryId: cat('Rice') },
        { name: 'Fried rice', description: 'With mixed vegetables', priceMinor: 350000, categoryId: cat('Rice') },
        { name: 'Egusi and pounded yam', description: 'Served hot', priceMinor: 500000, categoryId: cat('Soups') },
        { name: 'Pepper soup (goat)', description: 'Spicy and light', priceMinor: 450000, categoryId: cat('Soups') },
        { name: 'Suya platter', description: 'With onions and yaji', priceMinor: 450000, categoryId: cat('Grills') },
        { name: 'Grilled chicken', description: 'Quarter, with plantain', priceMinor: 400000, categoryId: cat('Grills') },
        { name: 'Zobo', description: 'Chilled hibiscus drink', priceMinor: 80000, categoryId: cat('Drinks') },
        { name: 'Chapman', description: 'House recipe', priceMinor: 150000, categoryId: cat('Drinks') },
      ].map((m, i) => ({ ...m, tenantId: tenant.id, sortOrder: i })))
      .returning();

    await tx.insert(s.inventoryItems).values([
      { branchId: wuse.id, name: 'Rice, 50 kg bags', unit: 'bag', qty: 6, reorderLevel: 8 },
      { branchId: wuse.id, name: 'Palm oil, 25 L', unit: 'keg', qty: 3, reorderLevel: 4 },
      { branchId: wuse.id, name: 'Beef', unit: 'kg', qty: 42, reorderLevel: 15 },
      { branchId: wuse.id, name: 'Chicken', unit: 'kg', qty: 30, reorderLevel: 10 },
      { branchId: wuse.id, name: 'Hibiscus leaves', unit: 'kg', qty: 5, reorderLevel: 2 },
      { branchId: garki.id, name: 'Rice, 50 kg bags', unit: 'bag', qty: 10, reorderLevel: 6 },
      { branchId: garki.id, name: 'Yam flour', unit: 'kg', qty: 12, reorderLevel: 10 },
    ].map((i) => ({ ...i, tenantId: tenant.id })));

    // A few of today's orders so the dashboard isn't empty.
    const [c1] = await tx
      .insert(s.customers)
      .values({ tenantId: tenant.id, phone: '+2348030000001', name: 'Amaka', addresses: ['Plot 5, Jabi'] })
      .returning();
    const samples: { status: string; fulfilment: string; lines: [number, number][] }[] = [
      { status: 'placed', fulfilment: 'delivery', lines: [[0, 2], [4, 1]] },
      { status: 'preparing', fulfilment: 'pickup', lines: [[2, 1], [6, 2]] },
      { status: 'completed', fulfilment: 'delivery', lines: [[5, 2], [7, 2]] },
    ];
    let seq = 1000;
    for (const o of samples) {
      seq += 1;
      const subtotal = o.lines.reduce((sum, [i, q]) => sum + menu[i].priceMinor * q, 0);
      const fee = o.fulfilment === 'delivery' ? 150000 : 0;
      const [order] = await tx
        .insert(s.orders)
        .values({
          tenantId: tenant.id,
          branchId: wuse.id,
          customerId: c1.id,
          number: seq,
          status: o.status,
          fulfilment: o.fulfilment,
          paymentMethod: 'pay_on_delivery',
          paymentStatus: o.status === 'completed' ? 'paid' : 'not_required',
          subtotalMinor: subtotal,
          deliveryFeeMinor: fee,
          totalMinor: subtotal + fee,
          deliveryAddress: o.fulfilment === 'delivery' ? 'Plot 5, Jabi' : null,
          trackingToken: `demo-${seq}`,
          completedAt: o.status === 'completed' ? new Date() : null,
        })
        .returning();
      await tx.insert(s.orderItems).values(
        o.lines.map(([i, q]) => ({ tenantId: tenant.id, orderId: order.id, menuItemId: menu[i].id, name: menu[i].name, unitPriceMinor: menu[i].priceMinor, quantity: q })),
      );
    }
    await tx.update(s.tenantSettings).set({ orderSeq: seq }).where(eq(s.tenantSettings.tenantId, tenant.id));
    await tx.execute(sql`
      insert into usage_daily (tenant_id, date, orders_count)
      values (${tenant.id}, (now() at time zone 'Africa/Lagos')::date, ${samples.length})`);
  });

  console.log(`Demo restaurant: ${DEMO.name} (${DEMO.slug}), Growth plan, 2 branches`);
  console.log(`  Owner sign-in:   ${DEMO.email} / ${DEMO.password}`);
  console.log(`  Kitchen sign-in: kitchen@olaskitchen.demo / ${DEMO.password} (Wuse 2 only)`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
