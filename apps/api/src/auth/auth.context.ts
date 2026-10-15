import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { PlanCode, Role, TenantStatus } from '@cullinari/shared';
import { forbidden } from '../common/errors';

export interface AuthContext {
  userId: string;
  tenantId: string;
  role: Role;
  /** null = all branches (owners, and managers not tied to one branch) */
  branchId: string | null;
  tenantStatus: TenantStatus;
  planCode: PlanCode;
  timezone: string;
  currency: string;
}

export interface JwtPayload {
  sub: string;
  tid: string;
}

export const IS_PUBLIC = 'isPublic';
/** No admin session needed (ordering app, webhooks, login). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const ALLOW_RESTRICTED = 'allowRestricted';
/** Still reachable when the subscription is restricted or suspended (billing, session). */
export const AllowWhenRestricted = () => SetMetadata(ALLOW_RESTRICTED, true);

export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  return ctx.switchToHttp().getRequest().auth;
});

/**
 * Branch scoping. Staff tied to a branch only ever see that branch; staff with access to all
 * branches may filter by one (or pass nothing for all).
 */
export function scopeBranch(auth: AuthContext, requested?: string | null): string | undefined {
  if (auth.branchId) {
    if (requested && requested !== auth.branchId) throw forbidden('You can only access your own branch');
    return auth.branchId;
  }
  return requested || undefined;
}

export function assertBranchAccess(auth: AuthContext, branchId: string) {
  if (auth.branchId && auth.branchId !== branchId) throw forbidden('You can only access your own branch');
}
