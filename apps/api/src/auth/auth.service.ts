import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { ErrorCode } from '@cullinari/shared';
import { AppError } from '../common/errors';
import { Db } from '../db/db.service';
import { memberships, tenants, users } from '../db/schema';
import type { AuthContext, JwtPayload } from './auth.context';

const badLogin = () => new AppError(ErrorCode.UNAUTHENTICATED, 'Email or password is incorrect', 401);

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

@Injectable()
export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string, tenantId?: string) {
    const [user] = await this.db.global((tx) =>
      tx.select().from(users).where(eq(users.email, email.trim().toLowerCase())),
    );
    // Compare against a dummy hash when the user doesn't exist so timing doesn't reveal it.
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw badLogin();

    const tenantList = await this.tenantsFor(user.id);
    if (!tenantList.length) throw new AppError(ErrorCode.FORBIDDEN, 'This login is not linked to a restaurant yet', 403);

    const active = tenantId ? tenantList.find((t) => t.id === tenantId) : tenantList[0];
    if (!active) throw new AppError(ErrorCode.FORBIDDEN, 'You are not a member of that restaurant', 403);

    return {
      token: await this.issue(user.id, active.id),
      user: { id: user.id, name: user.name, email: user.email, mustResetPassword: user.mustResetPassword },
      tenants: tenantList,
      tenantId: active.id,
    };
  }

  async switchTenant(userId: string, tenantId: string) {
    const list = await this.tenantsFor(userId);
    if (!list.some((t) => t.id === tenantId)) {
      throw new AppError(ErrorCode.FORBIDDEN, 'You are not a member of that restaurant', 403);
    }
    return { token: await this.issue(userId, tenantId), tenantId };
  }

  async me(auth: AuthContext) {
    const [user] = await this.db.global((tx) => tx.select().from(users).where(eq(users.id, auth.userId)));
    const [tenant] = await this.db.global((tx) => tx.select().from(tenants).where(eq(tenants.id, auth.tenantId)));
    return {
      user: { id: user.id, name: user.name, email: user.email, mustResetPassword: user.mustResetPassword },
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        plan: tenant.planCode,
        status: tenant.status,
        timezone: tenant.timezone,
        currency: tenant.currency,
      },
      role: auth.role,
      branchId: auth.branchId,
      tenants: await this.tenantsFor(auth.userId),
    };
  }

  async changePassword(userId: string, current: string, next: string) {
    const [user] = await this.db.global((tx) => tx.select().from(users).where(eq(users.id, userId)));
    if (!user || !(await bcrypt.compare(current, user.passwordHash))) {
      throw new AppError(ErrorCode.VALIDATION, 'Your current password is incorrect', 400);
    }
    const passwordHash = await hashPassword(next);
    await this.db.global((tx) =>
      tx.update(users).set({ passwordHash, mustResetPassword: false }).where(eq(users.id, userId)),
    );
  }

  private tenantsFor(userId: string) {
    return this.db.asUser(userId, (tx) =>
      tx
        .select({ id: tenants.id, name: tenants.name, slug: tenants.slug, role: memberships.role })
        .from(memberships)
        .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
        .where(eq(memberships.userId, userId))
        .orderBy(tenants.name),
    );
  }

  private issue(userId: string, tenantId: string) {
    const payload: JwtPayload = { sub: userId, tid: tenantId };
    return this.jwt.signAsync(payload);
  }
}
