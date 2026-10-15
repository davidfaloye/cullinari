import Constants from 'expo-constants';
import type { AppLayout, AppTheme } from '@cullinari/shared';

interface BakedTenant {
  slug: string;
  apiUrl: string;
  appName: string;
  theme: AppTheme;
  layout: AppLayout;
  configVersion: number;
}

/** Settings baked in at build time from tenants/<slug>.json (see app.config.ts). */
export const TENANT = Constants.expoConfig?.extra?.tenant as BakedTenant;

if (!TENANT?.slug) {
  throw new Error('Missing tenant config. Build with CULLINARI_TENANT set.');
}

export const API_URL = TENANT.apiUrl.replace(/\/$/, '');
export const EAS_PROJECT_ID = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
