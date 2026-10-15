import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { and, eq } from 'drizzle-orm';
import { ErrorCode, type Role } from '@cullinari/shared';
import { AppError, forbidden } from '../common/errors';
import { Db } from '../db/db.service';
import { memberships, tenants } from '../db/schema';
import { ALLOW_RESTRICTED, AuthContext, IS_PUBLIC, JwtPayload, ROLES_KEY } from './auth.context';

const unauthenticated = () => new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in to continue', 401);

/**
 * Global guard. Verifies the session token, then reloads the membership on every request so
 * a removed staff member or changed role takes effect immediately, not when the token expires.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly db: Db,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthenticated();

    const auth = await this.resolve(header.slice(7));
    if (!auth) throw unauthenticated();

    const allowRestricted = this.reflector.getAllAndOverride<boolean>(ALLOW_RESTRICTED, targets);
    if (!allowRestricted) {
      if (auth.tenantStatus === 'suspended') {
        throw new AppError(ErrorCode.TENANT_RESTRICTED, 'This account is suspended. Renew your plan to continue.', 403);
      }
      if (auth.tenantStatus === 'restricted' && req.method !== 'GET') {
        throw new AppError(
          ErrorCode.TENANT_RESTRICTED,
          'Your subscription payment is overdue, so the dashboard is read-only until it is paid.',
          403,
        );
      }
    }

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (roles?.length && !roles.includes(auth.role)) throw forbidden('Your role does not allow this');

    req.auth = auth;
    return true;
  }

  /** Shared with the WebSocket gateway. Returns null for any invalid or revoked session. */
  async resolve(token: string): Promise<AuthContext | null> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      return null;
    }
    return this.db.tenant(payload.tid, async (tx) => {
      const [row] = await tx
        .select({
          role: memberships.role,
          branchId: memberships.branchId,
          status: tenants.status,
          planCode: tenants.planCode,
          timezone: tenants.timezone,
          currency: tenants.currency,
        })
        .from(memberships)
        .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
        .where(and(eq(memberships.userId, payload.sub), eq(memberships.tenantId, payload.tid)));
      if (!row) return null;
      return {
        userId: payload.sub,
        tenantId: payload.tid,
        role: row.role as Role,
        branchId: row.branchId,
        tenantStatus: row.status as AuthContext['tenantStatus'],
        planCode: row.planCode as AuthContext['planCode'],
        timezone: row.timezone,
        currency: row.currency,
      };
    });
  }
}
