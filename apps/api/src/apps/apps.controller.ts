import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { APP_LAYOUTS, APP_OPTIONS } from '@cullinari/shared';
import { Public } from '../auth/auth.context';
import { parse } from '../common/validate';
import { StaffKeyGuard } from '../internal/staff-key.guard';
import { AppConfigService } from './app-config.service';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #0f6b4f');

const configSchema = z.object({
  appName: z.string().trim().min(1).max(30),
  theme: z.object({ primary: hex, accent: hex, logoUrl: z.string().url().optional(), iconUrl: z.string().url().optional() }),
  splash: z.object({ imageUrl: z.string().url().optional(), background: hex.optional() }).nullable().optional(),
  layout: z.enum(APP_LAYOUTS).optional(),
  options: z.record(z.enum(APP_OPTIONS), z.boolean()).optional(),
  promoText: z.string().trim().max(80).nullable().optional(),
  domain: z.string().trim().toLowerCase().regex(/^([a-z0-9-]+\.)+[a-z]{2,}$/, 'Enter a domain like mamaskitchen.ng').nullable().optional(),
});

/**
 * Staff endpoints behind the app builder: the setup form creates versions, the build
 * pipeline reads the build config. Protected by STAFF_API_KEY until the console exists.
 */
@Public()
@UseGuards(StaffKeyGuard)
@Controller('internal/apps')
export class AppsController {
  constructor(private readonly apps: AppConfigService) {}

  @Get(':slug/build-config')
  buildConfig(@Param('slug') slug: string) {
    return this.apps.buildConfig(slug);
  }

  @Post(':slug/configs')
  create(@Param('slug') slug: string, @Body() body: unknown) {
    return this.apps.createVersion(slug, parse(configSchema, body));
  }

  @Post(':slug/configs/:version/publish')
  publish(@Param('slug') slug: string, @Param('version', ParseIntPipe) version: number) {
    return this.apps.publish(slug, version);
  }
}
