#!/usr/bin/env node
// Pulls a restaurant's app settings from the API and writes tenants/<slug>.json, which
// app.config.ts turns into that restaurant's app (name, bundle ID, colours, icon, splash).
//
//   CULLINARI_API_URL=https://api.cullinari.com CULLINARI_STAFF_KEY=... \
//     pnpm --filter @cullinari/ordering tenant:pull mamaskitchen [--select] [--bump]
//
//   --select   also write tenants/current so the next `eas build` builds this restaurant
//   --bump     increase buildNumber (needed for every new store build)
//
// Release metadata (appVersion, buildNumber, eas.projectId/owner) lives only in the JSON
// file and is kept across pulls; everything else comes from the API.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tenantsDir = path.join(here, '..', 'tenants');

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith('--'));
const select = args.includes('--select');
const bump = args.includes('--bump');
const api = (process.env.CULLINARI_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const key = process.env.CULLINARI_STAFF_KEY;

if (!slug || !/^[a-z0-9-]{3,40}$/.test(slug)) fail('Usage: tenant:pull <slug> [--select] [--bump]');
if (!key) fail('Set CULLINARI_STAFF_KEY (the API STAFF_API_KEY).');

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) fail(`Could not download ${url} (${res.status})`);
  const type = res.headers.get('content-type') ?? '';
  if (!type.startsWith('image/png')) fail(`${url} must be a PNG (got ${type || 'unknown type'}); app icons and splash art must be PNG.`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

const res = await fetch(`${api}/internal/apps/${slug}/build-config`, { headers: { 'x-staff-key': key } });
const body = await res.json().catch(() => ({}));
if (!res.ok) fail(`API returned ${res.status}: ${body.message ?? 'unknown error'}`);

const file = path.join(tenantsDir, `${slug}.json`);
const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};

const config = {
  slug: body.slug,
  appName: body.name,
  bundleId: body.bundleId,
  scheme: body.scheme,
  apiUrl: body.apiUrl,
  plan: body.plan,
  configVersion: body.version,
  appVersion: existing.appVersion ?? '1.0.0',
  buildNumber: (existing.buildNumber ?? 0) + (bump || !existing.buildNumber ? 1 : 0),
  theme: body.theme,
  splash: body.splash,
  layout: body.layout,
  domain: body.domain ?? null,
  ...(existing.eas ? { eas: existing.eas } : {}),
};

// Brand art: the restaurant's icon (all plans) and splash image (Growth and Pro).
const assetDir = path.join(tenantsDir, slug);
fs.rmSync(assetDir, { recursive: true, force: true });
if (body.theme?.iconUrl) await download(body.theme.iconUrl, path.join(assetDir, 'icon.png'));
if (body.splash?.imageUrl) await download(body.splash.imageUrl, path.join(assetDir, 'splash.png'));

fs.mkdirSync(tenantsDir, { recursive: true });
fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
if (select) fs.writeFileSync(path.join(tenantsDir, 'current'), slug + '\n');

console.log(`Wrote tenants/${slug}.json (config v${config.configVersion}, build ${config.buildNumber}, ${config.plan})${select ? ' and selected it' : ''}.`);
if (!config.eas?.projectId) {
  console.log(`No EAS project yet. Create one once with: CULLINARI_TENANT=${slug} npx eas-cli@latest init, then add its id under "eas.projectId" in tenants/${slug}.json.`);
}
