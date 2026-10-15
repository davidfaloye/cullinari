import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.MIGRATE_DATABASE_URL ?? 'postgresql://cullinari_owner:owner@localhost:5432/cullinari',
  },
});
