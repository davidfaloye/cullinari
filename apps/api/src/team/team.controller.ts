import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { and, asc, count, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { ErrorCode, ROLES } from '@cullinari/shared';
import { Auth, AuthContext, Roles } from '../auth/auth.context';
import { hashPassword } from '../auth/auth.service';
import { AuditService } from '../common/audit.service';
import { tempPassword } from '../common/crypto';
import { AppError, notFound } from '../common/errors';
import { parse } from '../common/validate';
import { Db, type Tx } from '../db/db.service';
import { branches, memberships, users } from '../db/schema';

const inviteSchema = z.object({
  email: z.string().email().transform((e) => e.trim().toLowerCase()),
  name: z.string().trim().min(1).max(80),
  role: z.enum(ROLES),
  branchId: z.string().uuid().nullable().optional(),
});

const updateSchema = z.object({
  role: z.enum(ROLES).optional(),
  branchId: z.string().uuid().nullable().optional(),
});

@Roles('owner')
@Controller('team')
export class TeamController {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@Auth() auth: AuthContext) {
    return this.db.tenant(auth.tenantId, (tx) =>
      tx
        .select({
          id: memberships.id,
          userId: users.id,
          name: users.name,
          email: users.email,
          role: memberships.role,
          branchId: memberships.branchId,
          branchName: branches.name,
          createdAt: memberships.createdAt,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .leftJoin(branches, eq(branches.id, memberships.branchId))
        .where(eq(memberships.tenantId, auth.tenantId))
        .orderBy(asc(users.name)),
    );
  }

  /**
   * Adds a staff member. New people get a temporary password, returned once, which the
   * owner passes on; they're asked to change it at first sign-in. (Email invites come later.)
   */
  @Post()
  invite(@Auth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(inviteSchema, body);
    if (input.role === 'owner') input.branchId = null;
    return this.db.tenant(auth.tenantId, async (tx) => {
      await this.assertBranch(tx, input.branchId);

      const [existing] = await tx.select().from(users).where(eq(users.email, input.email));
      let userId = existing?.id;
      let temporaryPassword: string | null = null;
      if (!existing) {
        temporaryPassword = tempPassword();
        const [u] = await tx
          .insert(users)
          .values({ email: input.email, name: input.name, passwordHash: await hashPassword(temporaryPassword), mustResetPassword: true })
          .returning();
        userId = u.id;
      }

      const [m] = await tx
        .insert(memberships)
        .values({ userId: userId!, tenantId: auth.tenantId, role: input.role, branchId: input.branchId ?? null })
        .returning();
      await this.audit.record(tx, { tenantId: auth.tenantId, actorId: auth.userId, action: 'team.add', entity: 'membership', entityId: m.id, after: { email: input.email, role: input.role, branchId: m.branchId } });
      return { membershipId: m.id, userId, email: input.email, temporaryPassword };
    });
  }

  @Patch(':membershipId')
  update(@Auth() auth: AuthContext, @Param('membershipId', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(updateSchema, body);
    return this.db.tenant(auth.tenantId, async (tx) => {
      const [current] = await tx.select().from(memberships).where(eq(memberships.id, id));
      if (!current) throw notFound('Team member');
      if (current.role === 'owner' && input.role && input.role !== 'owner') await this.assertAnotherOwner(tx, auth.tenantId, id);
      await this.assertBranch(tx, input.branchId);
      const patch = { ...input };
      if ((input.role ?? current.role) === 'owner') patch.branchId = null;
      const [row] = await tx.update(memberships).set(patch).where(eq(memberships.id, id)).returning();
      await this.audit.record(tx, { tenantId: auth.tenantId, actorId: auth.userId, action: 'team.update', entity: 'membership', entityId: id, before: { role: current.role, branchId: current.branchId }, after: { role: row.role, branchId: row.branchId } });
      return row;
    });
  }

  @Delete(':membershipId')
  @HttpCode(204)
  async remove(@Auth() auth: AuthContext, @Param('membershipId', ParseUUIDPipe) id: string) {
    await this.db.tenant(auth.tenantId, async (tx) => {
      const [current] = await tx.select().from(memberships).where(eq(memberships.id, id));
      if (!current) throw notFound('Team member');
      if (current.userId === auth.userId) throw new AppError(ErrorCode.CONFLICT, "You can't remove yourself", 409);
      if (current.role === 'owner') await this.assertAnotherOwner(tx, auth.tenantId, id);
      await tx.delete(memberships).where(eq(memberships.id, id));
      await this.audit.record(tx, { tenantId: auth.tenantId, actorId: auth.userId, action: 'team.remove', entity: 'membership', entityId: id, before: { userId: current.userId, role: current.role } });
    });
  }

  private async assertBranch(tx: Tx, branchId: string | null | undefined) {
    if (!branchId) return;
    const [b] = await tx.select({ id: branches.id }).from(branches).where(eq(branches.id, branchId));
    if (!b) throw notFound('Branch');
  }

  private async assertAnotherOwner(tx: Tx, tenantId: string, excludingMembershipId: string) {
    const [{ n }] = await tx
      .select({ n: count() })
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, 'owner'), ne(memberships.id, excludingMembershipId)));
    if (n === 0) throw new AppError(ErrorCode.CONFLICT, 'A restaurant needs at least one owner', 409);
  }
}
