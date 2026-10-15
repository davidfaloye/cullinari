import { Body, Controller, Get, HttpCode, Ip, Post } from '@nestjs/common';
import { z } from 'zod';
import { RateLimiter } from '../common/rate-limit';
import { parse } from '../common/validate';
import { AllowWhenRestricted, Auth, AuthContext, Public } from './auth.context';
import { AuthService } from './auth.service';

const loginLimiter = new RateLimiter(8, 60_000);

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: unknown, @Ip() ip: string) {
    const input = parse(
      z.object({ email: z.string().email(), password: z.string().min(1), tenantId: z.string().uuid().optional() }),
      body,
    );
    loginLimiter.check(`${ip}:${input.email.toLowerCase()}`);
    return this.auth.login(input.email, input.password, input.tenantId);
  }

  @AllowWhenRestricted()
  @Get('me')
  me(@Auth() auth: AuthContext) {
    return this.auth.me(auth);
  }

  @AllowWhenRestricted()
  @Post('switch')
  @HttpCode(200)
  switch(@Auth() auth: AuthContext, @Body() body: unknown) {
    const { tenantId } = parse(z.object({ tenantId: z.string().uuid() }), body);
    return this.auth.switchTenant(auth.userId, tenantId);
  }

  @AllowWhenRestricted()
  @Post('password')
  @HttpCode(204)
  async password(@Auth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(z.object({ current: z.string().min(1), next: z.string().min(8, 'Use at least 8 characters') }), body);
    await this.auth.changePassword(auth.userId, input.current, input.next);
  }
}
