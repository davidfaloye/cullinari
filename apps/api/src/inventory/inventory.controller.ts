import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { and, asc, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ErrorCode } from '@cullinari/shared';
import { Auth, AuthContext, assertBranchAccess, Roles, scopeBranch } from '../auth/auth.context';
import { AppError, notFound } from '../common/errors';
import { parse } from '../common/validate';
import { Db, type Tx } from '../db/db.service';
import { branches, inventoryItems, stockMovements, users } from '../db/schema';
import { EntitlementsService } from '../entitlements/entitlements.service';

const quantity = z.number().finite().nonnegative().max(1_000_000);

const createSchema = z.object({
  branchId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120),
  unit: z.string().trim().min(1).max(20),
  qty: quantity.optional(),
  reorderLevel: quantity.optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  unit: z.string().trim().min(1).max(20).optional(),
  reorderLevel: quantity.optional(),
});

/** stock_in adds, waste removes, count sets the shelf count and records the difference. */
const movementSchema = z.object({
  type: z.enum(['stock_in', 'waste', 'count']),
  qty: quantity,
  note: z.string().trim().max(300).optional(),
});

@Roles('owner', 'manager')
@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly db: Db,
    private readonly entitlements: EntitlementsService,
  ) {}

  @Get()
  list(
    @Auth() auth: AuthContext,
    @Query('branchId') branchId?: string,
    @Query('archived') archived?: string,
    @Query('lowOnly') lowOnly?: string,
  ) {
    const scoped = scopeBranch(auth, branchId);
    return this.db.tenant(auth.tenantId, (tx) =>
      tx
        .select({
          id: inventoryItems.id,
          branchId: inventoryItems.branchId,
          branchName: branches.name,
          name: inventoryItems.name,
          unit: inventoryItems.unit,
          qty: inventoryItems.qty,
          reorderLevel: inventoryItems.reorderLevel,
          archivedAt: inventoryItems.archivedAt,
          archivedReason: inventoryItems.archivedReason,
          isLow: sql<boolean>`${inventoryItems.qty} <= ${inventoryItems.reorderLevel}`,
          updatedAt: inventoryItems.updatedAt,
        })
        .from(inventoryItems)
        .innerJoin(branches, eq(branches.id, inventoryItems.branchId))
        .where(
          and(
            scoped ? eq(inventoryItems.branchId, scoped) : undefined,
            archived === 'true' ? isNotNull(inventoryItems.archivedAt) : isNull(inventoryItems.archivedAt),
            lowOnly === 'true' ? sql`${inventoryItems.qty} <= ${inventoryItems.reorderLevel}` : undefined,
          ),
        )
        .orderBy(asc(inventoryItems.name)),
    );
  }

  @Post()
  create(@Auth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(createSchema, body);
    return this.db.tenant(auth.tenantId, async (tx) => {
      const branchId = await this.resolveBranch(tx, auth, input.branchId);
      await this.entitlements.assertCanAddInventoryItem(tx, auth.tenantId);
      const [row] = await tx
        .insert(inventoryItems)
        .values({
          tenantId: auth.tenantId,
          branchId,
          name: input.name,
          unit: input.unit,
          qty: input.qty ?? 0,
          reorderLevel: input.reorderLevel ?? 0,
        })
        .returning();
      if (input.qty) {
        await tx.insert(stockMovements).values({
          tenantId: auth.tenantId,
          inventoryItemId: row.id,
          change: input.qty,
          reason: 'purchase',
          note: 'Opening stock',
          userId: auth.userId,
        });
      }
      return row;
    });
  }

  @Patch(':id')
  update(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(updateSchema, body);
    return this.db.tenant(auth.tenantId, async (tx) => {
      await this.loadActive(tx, auth, id);
      const [row] = await tx.update(inventoryItems).set(input).where(eq(inventoryItems.id, id)).returning();
      return row;
    });
  }

  @Post(':id/archive')
  archive(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.tenant(auth.tenantId, async (tx) => {
      await this.loadActive(tx, auth, id);
      const [row] = await tx
        .update(inventoryItems)
        .set({ archivedAt: new Date(), archivedReason: 'user' })
        .where(eq(inventoryItems.id, id))
        .returning();
      return row;
    });
  }

  /** Unarchiving counts against the plan just like creating an item. */
  @Post(':id/unarchive')
  unarchive(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.tenant(auth.tenantId, async (tx) => {
      const [item] = await tx.select().from(inventoryItems).where(eq(inventoryItems.id, id));
      if (!item) throw notFound('Inventory item');
      assertBranchAccess(auth, item.branchId);
      if (!item.archivedAt) return item;
      await this.entitlements.assertCanAddInventoryItem(tx, auth.tenantId);
      const [row] = await tx
        .update(inventoryItems)
        .set({ archivedAt: null, archivedReason: null })
        .where(eq(inventoryItems.id, id))
        .returning();
      return row;
    });
  }

  @Post(':id/movements')
  move(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(movementSchema, body);
    return this.db.tenant(auth.tenantId, async (tx) => {
      const item = await this.loadActive(tx, auth, id, true);
      const change =
        input.type === 'stock_in' ? input.qty : input.type === 'waste' ? -input.qty : input.qty - Number(item.qty);
      if (Number(item.qty) + change < 0) {
        throw new AppError(ErrorCode.VALIDATION, `Only ${item.qty} ${item.unit} in stock`, 400);
      }
      const reason = input.type === 'stock_in' ? 'purchase' : input.type === 'waste' ? 'waste' : 'adjustment';
      await tx.insert(stockMovements).values({
        tenantId: auth.tenantId,
        inventoryItemId: id,
        change,
        reason,
        note: input.note,
        userId: auth.userId,
      });
      const [row] = await tx
        .update(inventoryItems)
        .set({ qty: sql`${inventoryItems.qty} + ${change}` })
        .where(eq(inventoryItems.id, id))
        .returning();
      return row;
    });
  }

  @Get(':id/movements')
  movements(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.tenant(auth.tenantId, async (tx) => {
      const [item] = await tx.select().from(inventoryItems).where(eq(inventoryItems.id, id));
      if (!item) throw notFound('Inventory item');
      assertBranchAccess(auth, item.branchId);
      return tx
        .select({
          id: stockMovements.id,
          change: stockMovements.change,
          reason: stockMovements.reason,
          note: stockMovements.note,
          orderId: stockMovements.orderId,
          createdAt: stockMovements.createdAt,
          userName: users.name,
        })
        .from(stockMovements)
        .leftJoin(users, eq(users.id, stockMovements.userId))
        .where(eq(stockMovements.inventoryItemId, id))
        .orderBy(desc(stockMovements.createdAt))
        .limit(200);
    });
  }

  private async resolveBranch(tx: Tx, auth: AuthContext, requested?: string) {
    const scoped = scopeBranch(auth, requested);
    if (scoped) {
      const [b] = await tx.select({ id: branches.id }).from(branches).where(eq(branches.id, scoped));
      if (!b) throw notFound('Branch');
      return scoped;
    }
    // Owners on a one-branch plan don't need to pick.
    const active = await tx.select({ id: branches.id }).from(branches).where(eq(branches.isActive, true)).limit(2);
    if (active.length === 1) return active[0].id;
    throw new AppError(ErrorCode.VALIDATION, 'Choose which branch this item belongs to', 400);
  }

  /** Archived items (including those archived by a plan downgrade) are read-only. */
  private async loadActive(tx: Tx, auth: AuthContext, id: string, lock = false) {
    const q = tx.select().from(inventoryItems).where(eq(inventoryItems.id, id));
    const [item] = lock ? await q.for('update') : await q;
    if (!item) throw notFound('Inventory item');
    assertBranchAccess(auth, item.branchId);
    if (item.archivedAt) {
      throw new AppError(
        item.archivedReason === 'plan' ? ErrorCode.PLAN_LIMIT_ITEMS : ErrorCode.CONFLICT,
        item.archivedReason === 'plan'
          ? 'This item was archived when your plan changed. Unarchive it to edit.'
          : 'Unarchive this item to edit it',
        409,
      );
    }
    return item;
  }
}
