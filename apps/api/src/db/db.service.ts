import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { AppConfig, CONFIG } from '../config';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * All tenant data goes through `tenant(tenantId, fn)`, which opens a transaction and sets
 * `app.tenant_id` for that transaction only. Row-level security does the rest: queries
 * inside `fn` can only see and write that restaurant's rows.
 */
@Injectable()
export class Db implements OnModuleDestroy {
  readonly pool: Pool;
  readonly db: Database;

  constructor(@Inject(CONFIG) config: AppConfig) {
    this.pool = new Pool({ connectionString: config.DATABASE_URL, max: 20 });
    this.db = drizzle(this.pool, { schema });
  }

  tenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
      return fn(tx);
    });
  }

  /** For login: lets a user read their own memberships before a tenant is chosen. */
  asUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
      return fn(tx);
    });
  }

  /** Only the non-tenant tables (plans, tenants, users) are readable without a tenant. */
  global<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(fn);
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
