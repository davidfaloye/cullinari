import 'dotenv/config';
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/main';
import { TenantsService } from '../src/internal/tenants.service';
import { Db } from '../src/db/db.service';

/**
 * End-to-end tests run against a real Postgres (DATABASE_URL, migrated and seeded with plans),
 * because the things worth testing here (row-level security, concurrent cap checks) only
 * exist in the database.
 */
export async function startApp(): Promise<INestApplication> {
  const app = await createApp();
  await app.init();
  return app;
}

export const STAFF = { 'x-staff-key': process.env.STAFF_API_KEY ?? '' };

export interface TestTenant {
  id: string;
  slug: string;
  branchId: string;
  token: string;
  ownerEmail: string;
}

export async function makeTenant(app: INestApplication, plan: 'starter' | 'growth' | 'pro' = 'starter'): Promise<TestTenant> {
  const slug = `t-${randomBytes(4).toString('hex')}`;
  const ownerEmail = `${slug}@test.local`;
  const res = await app.get(TenantsService).create({
    name: `Test ${slug}`,
    slug,
    planCode: plan,
    owner: { email: ownerEmail, name: 'Owner', password: 'password123' },
  });
  await app.get(TenantsService).update(res.tenant.id, { status: 'active' });
  const login = await request(app.getHttpServer()).post('/auth/login').send({ email: ownerEmail, password: 'password123' });
  return { id: res.tenant.id, slug, branchId: res.branch.id, token: login.body.token, ownerEmail };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function addMenuItem(app: INestApplication, t: TestTenant, priceMinor = 250000) {
  const res = await request(app.getHttpServer())
    .post('/menu/items')
    .set(bearer(t.token))
    .send({ name: `Dish ${randomBytes(2).toString('hex')}`, priceMinor });
  expect(res.status).toBe(201);
  return res.body as { id: string; priceMinor: number };
}

export function orderBody(t: TestTenant, menuItemId: string, extra: Record<string, unknown> = {}) {
  return {
    branchId: t.branchId,
    fulfilment: 'pickup',
    paymentMethod: 'pay_on_delivery',
    items: [{ menuItemId, quantity: 2 }],
    customer: { name: 'Test Customer', phone: `+23480${Math.floor(10000000 + Math.random() * 89999999)}` },
    ...extra,
  };
}

export async function cleanup(app: INestApplication) {
  await app.get(Db).pool.end().catch(() => undefined);
}
