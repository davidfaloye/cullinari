import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { and, asc, count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { ErrorCode } from '@cullinari/shared';
import { Auth, AuthContext, Roles } from '../auth/auth.context';
import { AppError, notFound } from '../common/errors';
import { parse } from '../common/validate';
import { AuditService } from '../common/audit.service';
import { Db } from '../db/db.service';
import { branches } from '../db/schema';
import { EntitlementsService } from '../entitlements/entitlements.service';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const hoursSchema = z
  .record(z.enum(['0', '1', '2', '3', '4', '5', '6']), z.object({ open: time, close: time }).nullable())
  .nullable()
  .optional();

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  address: z.string().trim().max(300).optional(),
  phone: z.string().trim().max(30).optional(),
  hours: hoursSchema,
});
const updateSchema = createSchema.partial().extend({ isActive: z.boolean().optional() });

@Controller('branches')
export class BranchesController {
  constructor(
    private readonly db: Db,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@Auth() auth: AuthContext) {
    return this.db.tenant(auth.tenantId, (tx) =>
      tx
        .select()
        .from(branches)
        .where(auth.branchId ? eq(branches.id, auth.branchId) : undefined)
        .orderBy(asc(branches.createdAt)),
    );
  }

  @Roles('owner')
  @Post()
  create(@Auth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(createSchema, body);
    return this.db.tenant(auth.tenantId, async (tx) => {
      await this.entitlements.assertCanAddBranch(tx, auth.tenantId);
      const [row] = await tx
        .insert(branches)
        .values({ ...input, hours: input.hours ?? null, tenantId: auth.tenantId })
        .returning();
      await this.audit.record(tx, { tenantId: auth.tenantId, actorId: auth.userId, action: 'branch.create', entity: 'branch', entityId: row.id, after: row });
      return row;
    });
  }

  @Roles('owner')
  @Patch(':id')
  update(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(updateSchema, body);
    return this.db.tenant(auth.tenantId, async (tx) => {
      const [current] = await tx.select().from(branches).where(eq(branches.id, id)).for('update');
      if (!current) throw notFound('Branch');

      if (input.isActive === true && !current.isActive) {
        // Reactivating counts against the plan exactly like adding a new branch.
        await this.entitlements.assertCanAddBranch(tx, auth.tenantId);
      }
      if (input.isActive === false && current.isActive) {
        const [{ n }] = await tx
          .select({ n: count() })
          .from(branches)
          .where(and(eq(branches.tenantId, auth.tenantId), eq(branches.isActive, true)));
        if (n <= 1) throw new AppError(ErrorCode.CONFLICT, 'You need at least one active branch', 409);
      }

      const [row] = await tx.update(branches).set(input).where(eq(branches.id, id)).returning();
      await this.audit.record(tx, { tenantId: auth.tenantId, actorId: auth.userId, action: 'branch.update', entity: 'branch', entityId: id, before: current, after: row });
      return row;
    });
  }
}
