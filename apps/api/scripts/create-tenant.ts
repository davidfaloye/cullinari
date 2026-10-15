// Manual onboarding from the command line (Phase 1).
// Usage:
//   pnpm --filter @cullinari/api tenant:create -- --name "Mama's Kitchen" --slug mamaskitchen \
//     --plan starter --owner-email owner@mamaskitchen.ng --owner-name "Funmi Bello"
import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { TenantsService } from '../src/internal/tenants.service';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const name = arg('name');
  const slug = arg('slug');
  const plan = (arg('plan') ?? 'starter') as 'starter' | 'growth' | 'pro';
  const email = arg('owner-email');
  const ownerName = arg('owner-name');
  if (!name || !slug || !email || !ownerName) {
    console.error('Required: --name --slug --owner-email --owner-name (optional: --plan --branch --timezone)');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const result = await app.get(TenantsService).create({
    name,
    slug,
    planCode: plan,
    branchName: arg('branch'),
    timezone: arg('timezone'),
    owner: { email, name: ownerName },
  });
  await app.close();

  console.log(`Created ${result.tenant.name} (${result.tenant.slug}) on ${plan}.`);
  console.log(`Owner: ${result.owner.email}`);
  if (result.owner.temporaryPassword) console.log(`Temporary password: ${result.owner.temporaryPassword}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
