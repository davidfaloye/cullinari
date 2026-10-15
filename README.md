# Cullinari

Restaurant admin platform and white-label ordering apps. One multi-tenant API serves the restaurant admin (`apps/admin`), each restaurant's own ordering app on Google Play and the App Store (`apps/ordering`), and later the Cullinari staff console.

| Plan | Monthly | App setup | Orders / day | Inventory items | Branches |
| --- | --- | --- | --- | --- | --- |
| Starter | $20 | $75 | 50 | 100 | 1 |
| Growth | $45 | $200 | 200 | 500 | 3 |
| Pro | $100 | $400 | Unlimited | Unlimited | Many |

## Repository layout

```
apps/
  api/      NestJS API, Postgres via Drizzle ORM, Socket.IO for live orders
  admin/    React + Vite admin dashboard (admin.cullinari.com)
  ordering/ Expo (React Native) ordering app, built per restaurant (see apps/ordering/README.md)
packages/
  shared/   Plan entitlements, error codes, order statuses and types used by every app
scripts/    Database role setup
```

## Quick start

Requires Node 20+, pnpm 10, and Postgres 16 (Docker or local).

```bash
pnpm install
pnpm --filter @cullinari/shared build

# Database: either Docker...
docker compose up -d
# ...or an existing Postgres, as a superuser:
PGHOST=localhost PGUSER=postgres pnpm db:setup

cp apps/api/.env.example apps/api/.env   # then set JWT_SECRET, DATA_KEY, STAFF_API_KEY
pnpm db:migrate
pnpm db:seed

pnpm dev:api      # http://localhost:4000
pnpm dev:admin    # http://localhost:5173
```

The seed creates a demo restaurant, **Ola's Kitchen** (Growth plan, branches Wuse 2 and Garki):

- Owner: `owner@olaskitchen.demo` / `cullinari-demo`
- Kitchen, Wuse 2 only: `kitchen@olaskitchen.demo` / `cullinari-demo`

Run the API tests (they use the database in `DATABASE_URL`, migrated and seeded):

```bash
pnpm --filter @cullinari/api test
```

## How plan limits are enforced

All caps are decided on the server in `apps/api/src/entitlements/entitlements.service.ts`, never only in the UI.

- **Entitlements** = the plan's JSON in `plans.entitlements` merged with any `tenant_overrides` (e.g. a 4th branch on Growth), cached per tenant for 60 seconds and cleared immediately on a plan change.
- **Orders per day**: an upsert on `usage_daily` that only increments while `orders_count < cap`, inside the same transaction as the order insert. Concurrent checkouts queue on the row lock, so exactly `cap` orders get through. The day is midnight-to-midnight in the restaurant's timezone. Accepted orders are never cancelled by a cap; only new checkouts are refused.
- **Inventory items and branches**: counted under a per-tenant advisory lock in the same transaction as the insert, so simultaneous creates can't overshoot. Editing existing items still works at the cap; archiving frees a slot.
- Errors use stable codes (`PLAN_LIMIT_ORDERS`, `PLAN_LIMIT_ITEMS`, `PLAN_LIMIT_BRANCHES`) that the admin turns into upgrade prompts and the app turns into "We're not taking online orders right now".

## Tenant isolation

Every business table has `tenant_id`, and Postgres row-level security (`apps/api/drizzle/0001_row_level_security.sql`) only shows rows matching `app.tenant_id`, which the API sets per transaction. The API connects as `cullinari_app`, a role that cannot bypass RLS, so a query that forgets its tenant filter still returns nothing from other restaurants. Migrations run as `cullinari_owner`.

## API overview

Admin endpoints need `Authorization: Bearer <token>` from `POST /auth/login`. Roles: **owner** (everything), **manager** (menu, inventory, orders), **cashier** (orders, sold-out toggles), **kitchen** (order queue). Staff can be tied to one branch.

| Area | Endpoints |
| --- | --- |
| Session | `POST /auth/login`, `GET /auth/me`, `POST /auth/switch`, `POST /auth/password` |
| Home | `GET /dashboard`, `GET /usage` |
| Orders | `GET /orders?view=active\|history`, `GET /orders/:id`, `PATCH /orders/:id/status` |
| Menu | `GET /menu`, `POST/PATCH/DELETE /menu/categories`, `POST/PATCH/DELETE /menu/items`, `PATCH /menu/items/:id/availability` |
| Inventory | `GET/POST /inventory`, `PATCH /inventory/:id`, `POST /inventory/:id/archive\|unarchive`, `GET/POST /inventory/:id/movements` |
| Branches, team | `GET/POST/PATCH /branches`, `GET/POST/PATCH/DELETE /team` |
| Owner | `GET/PATCH /settings`, `GET /billing` |
| Ordering app (public) | `GET /public/:slug`, `GET /public/:slug/menu`, `POST /public/:slug/orders`, `GET /public/:slug/orders/:trackingToken`, `POST /public/:slug/payments/:reference/verify` |
| Webhooks | `POST /webhooks/paystack/:slug` (signature checked with that restaurant's key, idempotent) |
| Payment return | `GET /public/:slug/payments/return` (Paystack callback; confirms and redirects into the app) |
| Staff (`x-staff-key`) | `GET/POST /internal/tenants`, `PATCH /internal/tenants/:id`, `POST /internal/tenants/:id/overrides`, `POST /internal/apps/:slug/configs`, `POST /internal/apps/:slug/configs/:version/publish`, `GET /internal/apps/:slug/build-config` |

Live events: Socket.IO namespace `/admin`, authenticated with the same token; events `order.created`, `order.updated`, `usage.updated`.

Onboard a restaurant from the command line:

```bash
pnpm --filter @cullinari/api tenant:create -- --name "Mama's Kitchen" --slug mamaskitchen \
  --plan starter --owner-email owner@mamaskitchen.ng --owner-name "Funmi Bello"
```

## Payments

Each restaurant uses its own Paystack account, so customer payments settle directly to them. The owner pastes their keys in Settings (the secret key is stored AES-256-GCM encrypted and never returned) and sets the webhook URL shown there in Paystack. Card orders are created with `payment_status = pending` and can't be accepted until Paystack confirms the payment by webhook or the app's verify call.

## Status against the roadmap (Phase 1: Starter MVP)

Done in this repo:

- Tenants, auth, roles and branch scoping
- Menu, orders with a live queue (sound, kitchen view), inventory basics
- Daily order cap and the other caps, enforced server-side with tests
- Paystack checkout and webhooks; Expo push notifications on order status
- Manual onboarding via CLI and staff-key endpoints
- Expo ordering app, personalised per restaurant from one codebase, with plan-gated layouts and options
- EAS build-and-submit and over-the-air update workflows (GitHub Actions)

Still to build for Phase 1:

- Image uploads to S3-compatible storage (menu items and app art take image URLs for now)
- Expiring unpaid card orders after a timeout, and refunds from the admin
- App settings screen in the admin/console (app configs are created through the staff API for now)

Before running more than one API instance: move the entitlements cache, rate limiter and Socket.IO adapter to Redis.

Later phases (from the architecture plan): self-serve sign-up and USD subscriptions with grace/restricted states driven by billing (Phase 2), recipes that auto-deduct stock and app personalisation for Growth (Phase 3), custom domains and feature flags for Pro (Phase 4).
