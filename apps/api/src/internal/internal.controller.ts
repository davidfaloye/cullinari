import { Body, CanActivate, Controller, ExecutionContext, Get, Inject, Injectable, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { TENANT_STATUSES } from '@cullinari/shared';
import { Public } from '../auth/auth.context';
import { safeEqual } from '../common/crypto';
import { forbidden } from '../common/errors';
import { parse } from '../common/validate';
import { AppConfig, CONFIG } from '../config';
import { TenantsService } from './tenants.service';

@Injectable()
class StaffKeyGuard implements CanActivate {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}
  canActivate(ctx: ExecutionContext) {
    const key = ctx.switchToHttp().getRequest().headers['x-staff-key'];
    if (typeof key !== 'string' || !safeEqual(key, this.config.STAFF_API_KEY)) throw forbidden('Staff key required');
    return true;
  }
}

const planCode = z.enum(['starter', 'growth', 'pro']);

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, 'Use 3-40 lowercase letters, numbers and dashes'),
  planCode,
  timezone: z.string().optional(),
  branchName: z.string().trim().max(80).optional(),
  owner: z.object({ email: z.string().email(), name: z.string().trim().min(1) }),
  theme: z.object({ primary: z.string(), accent: z.string() }).optional(),
});

/**
 * Cullinari staff operations, protected by STAFF_API_KEY until the staff console
 * (console.cullinari.com, with its own login and 2FA) replaces it.
 */
@Public()
@UseGuards(StaffKeyGuard)
@Controller('internal/tenants')
export class InternalController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  list() {
    return this.tenants.list();
  }

  @Post()
  create(@Body() body: unknown) {
    return this.tenants.create(parse(createSchema, body));
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tenants.update(id, parse(z.object({ planCode: planCode.optional(), status: z.enum(TENANT_STATUSES).optional() }), body));
  }

  @Post(':id/overrides')
  override(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(
      z.object({
        key: z.string().regex(/^(max_orders_per_day|max_inventory_items|max_branches|app\.[a-z_]+|support)$/),
        value: z.union([z.number().int().nonnegative(), z.boolean(), z.string(), z.null()]),
        reason: z.string().trim().min(3),
        expiresAt: z.coerce.date().optional(),
      }),
      body,
    );
    return this.tenants.setOverride(id, input);
  }
}
