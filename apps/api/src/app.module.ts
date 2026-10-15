import { Controller, Get, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth/auth.controller';
import { Public } from './auth/auth.context';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { BillingController } from './billing/billing.controller';
import { BranchesController } from './branches/branches.controller';
import { AuditService } from './common/audit.service';
import { AllExceptionsFilter } from './common/errors';
import { CONFIG, loadConfig } from './config';
import { DashboardController } from './dashboard/dashboard.controller';
import { Db } from './db/db.service';
import { EntitlementsService } from './entitlements/entitlements.service';
import { InternalController } from './internal/internal.controller';
import { TenantsService } from './internal/tenants.service';
import { InventoryController } from './inventory/inventory.controller';
import { MenuController } from './menu/menu.controller';
import { PushService } from './notifications/push.service';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { PaystackService } from './payments/paystack.service';
import { WebhooksController } from './payments/webhooks.controller';
import { PublicController } from './public/public.controller';
import { EventsGateway } from './realtime/events.gateway';
import { SettingsController } from './settings/settings.controller';
import { TeamController } from './team/team.controller';

@Public()
@Controller('health')
class HealthController {
  constructor(private readonly db: Db) {}
  @Get()
  async health() {
    await this.db.pool.query('select 1');
    return { ok: true };
  }
}

const config = loadConfig();

@Module({
  imports: [JwtModule.register({ secret: config.JWT_SECRET, signOptions: { expiresIn: config.JWT_TTL as never } })],
  controllers: [
    HealthController,
    AuthController,
    DashboardController,
    OrdersController,
    MenuController,
    InventoryController,
    BranchesController,
    TeamController,
    SettingsController,
    BillingController,
    PublicController,
    WebhooksController,
    InternalController,
  ],
  providers: [
    { provide: CONFIG, useValue: config },
    Db,
    AuditService,
    EntitlementsService,
    AuthService,
    AuthGuard,
    OrdersService,
    PaystackService,
    PushService,
    TenantsService,
    EventsGateway,
    { provide: APP_GUARD, useExisting: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
