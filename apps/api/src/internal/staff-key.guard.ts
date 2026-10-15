import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { safeEqual } from '../common/crypto';
import { forbidden } from '../common/errors';
import { AppConfig, CONFIG } from '../config';

/** Protects /internal/* with STAFF_API_KEY until the staff console has its own login and 2FA. */
@Injectable()
export class StaffKeyGuard implements CanActivate {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}
  canActivate(ctx: ExecutionContext) {
    const key = ctx.switchToHttp().getRequest().headers['x-staff-key'];
    if (typeof key !== 'string' || !safeEqual(key, this.config.STAFF_API_KEY)) throw forbidden('Staff key required');
    return true;
  }
}
