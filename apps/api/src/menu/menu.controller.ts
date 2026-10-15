import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { Auth, AuthContext, Roles, scopeBranch } from '../auth/auth.context';
import { AuditService } from '../common/audit.service';
import { forbidden, notFound } from '../common/errors';
import { moneyMinor, parse } from '../common/validate';
import { Db, type Tx } from '../db/db.service';
import { branches, menuCategories, menuItems } from '../db/schema';

const categorySchema = z.object({
  name: z.string().trim().min(1).max(60),
  sortOrder: z.number().int().optional(),
  branchId: z.string().uuid().nullable().optional(),
});

const itemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  priceMinor: moneyMinor,
  categoryId: z.string().uuid().nullable().optional(),
  branchId: z.string().uuid().nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  isAvailable: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

@Roles('owner', 'manager')
@Controller('menu')
export class MenuController {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /** Categories and items visible to this user: shared ones plus their branch (or all, for owners). */
  @Roles('owner', 'manager', 'cashier', 'kitchen')
  @Get()
  list(@Auth() auth: AuthContext, @Query('branchId') branchId?: string) {
    const scoped = scopeBranch(auth, branchId);
    return this.db.tenant(auth.tenantId, async (tx) => {
      const branchFilter = <T extends typeof menuItems | typeof menuCategories>(t: T) =>
        scoped ? or(isNull(t.branchId), eq(t.branchId, scoped)) : undefined;
      const categories = await tx
        .select()
        .from(menuCategories)
        .where(branchFilter(menuCategories))
        .orderBy(asc(menuCategories.sortOrder), asc(menuCategories.name));
      const items = await tx
        .select()
        .from(menuItems)
        .where(and(isNull(menuItems.archivedAt), branchFilter(menuItems)))
        .orderBy(asc(menuItems.sortOrder), asc(menuItems.name));
      return { categories, items };
    });
  }

  @Post('categories')
  createCategory(@Auth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(categorySchema, body);
    return this.db.tenant(auth.tenantId, async (tx) => {
      const branchId = await this.ownedBranch(tx, auth, input.branchId);
      const [row] = await tx
        .insert(menuCategories)
        .values({ name: input.name, sortOrder: input.sortOrder ?? 0, branchId, tenantId: auth.tenantId })
        .returning();
      return row;
    });
  }

  @Patch('categories/:id')
  updateCategory(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(categorySchema.partial().omit({ branchId: true }), body);
    return this.db.tenant(auth.tenantId, async (tx) => {
      const [current] = await tx.select().from(menuCategories).where(eq(menuCategories.id, id));
      if (!current) throw notFound('Category');
      this.assertCanEdit(auth, current.branchId);
      const [row] = await tx.update(menuCategories).set(input).where(eq(menuCategories.id, id)).returning();
      return row;
    });
  }

  @Delete('categories/:id')
  @HttpCode(204)
  async deleteCategory(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.db.tenant(auth.tenantId, async (tx) => {
      const [current] = await tx.select().from(menuCategories).where(eq(menuCategories.id, id));
      if (!current) throw notFound('Category');
      this.assertCanEdit(auth, current.branchId);
      // Items in the category stay on the menu, uncategorised.
      await tx.delete(menuCategories).where(eq(menuCategories.id, id));
    });
  }

  @Post('items')
  createItem(@Auth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(itemSchema, body);
    return this.db.tenant(auth.tenantId, async (tx) => {
      const branchId = await this.ownedBranch(tx, auth, input.branchId);
      await this.assertCategory(tx, input.categoryId);
      const [row] = await tx
        .insert(menuItems)
        .values({ ...input, branchId, tenantId: auth.tenantId })
        .returning();
      await this.audit.record(tx, { tenantId: auth.tenantId, actorId: auth.userId, action: 'menu_item.create', entity: 'menu_item', entityId: row.id, after: { name: row.name, priceMinor: row.priceMinor } });
      return row;
    });
  }

  @Patch('items/:id')
  updateItem(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(itemSchema.partial().omit({ branchId: true }), body);
    return this.db.tenant(auth.tenantId, async (tx) => {
      const [current] = await tx.select().from(menuItems).where(and(eq(menuItems.id, id), isNull(menuItems.archivedAt)));
      if (!current) throw notFound('Menu item');
      this.assertCanEdit(auth, current.branchId);
      if (input.categoryId) await this.assertCategory(tx, input.categoryId);
      const [row] = await tx.update(menuItems).set(input).where(eq(menuItems.id, id)).returning();
      if (input.priceMinor !== undefined && input.priceMinor !== current.priceMinor) {
        await this.audit.record(tx, { tenantId: auth.tenantId, actorId: auth.userId, action: 'menu_item.price_change', entity: 'menu_item', entityId: id, before: { priceMinor: current.priceMinor }, after: { priceMinor: row.priceMinor } });
      }
      return row;
    });
  }

  /** Availability is toggled from the order screen too, so cashiers may do it. */
  @Roles('owner', 'manager', 'cashier')
  @Patch('items/:id/availability')
  setAvailability(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { isAvailable } = parse(z.object({ isAvailable: z.boolean() }), body);
    return this.db.tenant(auth.tenantId, async (tx) => {
      const [current] = await tx.select().from(menuItems).where(eq(menuItems.id, id));
      if (!current) throw notFound('Menu item');
      this.assertCanEdit(auth, current.branchId);
      const [row] = await tx.update(menuItems).set({ isAvailable }).where(eq(menuItems.id, id)).returning();
      return row;
    });
  }

  /** Archived, not deleted: past orders keep pointing at it. */
  @Delete('items/:id')
  @HttpCode(204)
  async archiveItem(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.db.tenant(auth.tenantId, async (tx) => {
      const [current] = await tx.select().from(menuItems).where(eq(menuItems.id, id));
      if (!current) throw notFound('Menu item');
      this.assertCanEdit(auth, current.branchId);
      await tx.update(menuItems).set({ archivedAt: new Date() }).where(eq(menuItems.id, id));
      await this.audit.record(tx, { tenantId: auth.tenantId, actorId: auth.userId, action: 'menu_item.archive', entity: 'menu_item', entityId: id, before: { name: current.name } });
    });
  }

  /** Branch-tied managers can only create items for their own branch; owners choose. */
  private async ownedBranch(tx: Tx, auth: AuthContext, requested: string | null | undefined): Promise<string | null> {
    if (auth.branchId) {
      if (requested && requested !== auth.branchId) throw forbidden('You can only edit your own branch menu');
      return auth.branchId;
    }
    if (!requested) return null;
    const [b] = await tx.select({ id: branches.id }).from(branches).where(eq(branches.id, requested));
    if (!b) throw notFound('Branch');
    return requested;
  }

  private assertCanEdit(auth: AuthContext, itemBranchId: string | null) {
    if (auth.branchId && itemBranchId !== auth.branchId) {
      throw forbidden('Shared menu items can only be changed by someone with access to all branches');
    }
  }

  private async assertCategory(tx: Tx, categoryId: string | null | undefined) {
    if (!categoryId) return;
    const [c] = await tx.select({ id: menuCategories.id }).from(menuCategories).where(eq(menuCategories.id, categoryId));
    if (!c) throw notFound('Category');
  }
}
