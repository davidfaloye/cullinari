-- Row-level security: one restaurant's rows are invisible to another, even if an API bug
-- forgets a WHERE clause. The API connects as cullinari_app (NOBYPASSRLS) and sets
-- `app.tenant_id` (and `app.user_id` during login) with set_config(..., true), which lasts
-- only for the current transaction, so a pooled connection never carries a stale tenant.
--
-- Not tenant-scoped on purpose: plans (public price list), tenants (name, slug, plan, status;
-- needed to resolve a slug before a tenant is known) and users (global identities).

CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'subscriptions', 'tenant_overrides', 'tenant_settings', 'branches', 'memberships',
    'menu_categories', 'menu_items', 'inventory_items', 'recipes', 'stock_movements',
    'customers', 'orders', 'order_items', 'payments', 'usage_daily', 'app_configs', 'audit_log'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t
    );
  END LOOP;
END
$$;
--> statement-breakpoint
-- At login, before a tenant is chosen, a user may read their own memberships across tenants.
CREATE POLICY own_memberships ON memberships FOR SELECT USING (user_id = app_current_user());
--> statement-breakpoint
-- The owner role runs migrations and seeds; it must still be able to write any tenant's rows.
-- FORCE above applies RLS to the owner too, so give it an explicit bypass policy per table.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'subscriptions', 'tenant_overrides', 'tenant_settings', 'branches', 'memberships',
    'menu_categories', 'menu_items', 'inventory_items', 'recipes', 'stock_movements',
    'customers', 'orders', 'order_items', 'payments', 'usage_daily', 'app_configs', 'audit_log'
  ]
  LOOP
    EXECUTE format('CREATE POLICY owner_all ON %I TO cullinari_owner USING (true) WITH CHECK (true)', t);
  END LOOP;
END
$$;
