/// <reference types="node" />
// One codebase, one app per restaurant. Which restaurant this build is for comes from
// CULLINARI_TENANT, else tenants/current (written by `tenant:pull <slug> --select`, and
// uploaded with the EAS build), else the demo restaurant. Its settings live in
// tenants/<slug>.json, written by `pnpm --filter @cullinari/ordering tenant:pull <slug>`.
import fs from 'node:fs';
import path from 'node:path';
import type { ConfigContext, ExpoConfig } from 'expo/config';

export interface TenantBuildConfig {
  slug: string;
  appName: string;
  bundleId: string;
  scheme: string;
  apiUrl: string;
  plan: 'starter' | 'growth' | 'pro';
  configVersion: number;
  /** Store version shown to users; bump for each store release. */
  appVersion: string;
  /** iOS buildNumber / Android versionCode; must increase with every store build. */
  buildNumber: number;
  theme: { primary: string; accent: string; logoUrl?: string; iconUrl?: string };
  splash: { imageUrl?: string; background?: string } | null;
  layout: 'list' | 'grid' | 'featured';
  domain: string | null;
  /** EAS project for this restaurant's app (each store app is its own EAS project). */
  eas?: { projectId?: string; owner?: string };
}

const DEFAULT_ASSETS = './assets';

export default ({ config }: ConfigContext): ExpoConfig => {
  const currentFile = path.join(__dirname, 'tenants', 'current');
  const slug =
    process.env.CULLINARI_TENANT ??
    (fs.existsSync(currentFile) ? fs.readFileSync(currentFile, 'utf8').trim() : undefined) ??
    'olaskitchen';
  const file = path.join(__dirname, 'tenants', `${slug}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`No build config for "${slug}". Run: pnpm --filter @cullinari/ordering tenant:pull ${slug}`);
  }
  const t = JSON.parse(fs.readFileSync(file, 'utf8')) as TenantBuildConfig;
  // API URL can be overridden for local development (e.g. your machine's LAN IP).
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? t.apiUrl;

  // Downloaded by tenant:pull when the restaurant has its own icon/splash art.
  const tenantAsset = (name: string) => {
    const p = path.join('tenants', slug, name);
    return fs.existsSync(path.join(__dirname, p)) ? `./${p}` : undefined;
  };
  const icon = tenantAsset('icon.png') ?? `${DEFAULT_ASSETS}/icon.png`;
  // Starter gets the default splash (brand colour + icon); Growth/Pro can supply their own art.
  const splashImage = (t.splash && tenantAsset('splash.png')) ?? icon;
  const splashBackground = t.splash?.background ?? t.theme.primary;
  const projectId = t.eas?.projectId;

  return {
    ...config,
    name: t.appName,
    slug: `cullinari-${t.slug}`,
    owner: t.eas?.owner,
    scheme: t.scheme,
    version: t.appVersion,
    orientation: 'portrait',
    icon,
    userInterfaceStyle: 'light',
    ios: {
      bundleIdentifier: t.bundleId,
      buildNumber: String(t.buildNumber),
      supportsTablet: false,
      infoPlist: { ITSAppUsesNonExemptEncryption: false },
      ...(t.domain ? { associatedDomains: [`applinks:${t.domain}`] } : {}),
    },
    android: {
      package: t.bundleId,
      versionCode: t.buildNumber,
      adaptiveIcon: {
        backgroundColor: t.theme.primary,
        foregroundImage: tenantAsset('icon-foreground.png') ?? `${DEFAULT_ASSETS}/android-icon-foreground.png`,
      },
      predictiveBackGestureEnabled: false,
      // Pro custom domains: https://mamaskitchen.ng/order/... opens the app.
      ...(t.domain
        ? {
            intentFilters: [
              {
                action: 'VIEW',
                autoVerify: true,
                data: [{ scheme: 'https', host: t.domain, pathPrefix: '/order' }],
                category: ['BROWSABLE', 'DEFAULT'],
              },
            ],
          }
        : {}),
    },
    web: { favicon: `${DEFAULT_ASSETS}/favicon.png`, bundler: 'metro' },
    plugins: [
      'expo-router',
      'expo-web-browser',
      ['expo-splash-screen', { image: splashImage, backgroundColor: splashBackground, imageWidth: 160, resizeMode: 'contain' }],
      ['expo-notifications', { color: t.theme.primary }],
    ],
    experiments: { typedRoutes: true },
    // Over-the-air updates: JS fixes ship to every restaurant's app without a store release.
    runtimeVersion: { policy: 'appVersion' },
    ...(projectId ? { updates: { url: `https://u.expo.dev/${projectId}` } } : {}),
    extra: {
      tenant: {
        slug: t.slug,
        apiUrl,
        appName: t.appName,
        theme: t.theme,
        layout: t.layout,
        configVersion: t.configVersion,
      },
      ...(projectId ? { eas: { projectId } } : {}),
    },
  };
};
