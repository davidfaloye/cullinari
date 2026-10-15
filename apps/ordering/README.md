# Cullinari ordering app

One Expo (React Native) codebase that becomes each restaurant's own app on Google Play and the App Store. Nothing is forked per restaurant: the restaurant's name, bundle ID, colours, icon and splash come from `tenants/<slug>.json` at build time, and the menu, prices, availability, branches and plan-gated options (layout, promo banner, etc.) come live from the API.

Customer flow: menu → item → cart → checkout (delivery or pickup, branch, details, payment) → Paystack checkout in an in-app browser, or pay on delivery → live order tracking with push notifications.

## What each plan gets

| | Starter | Growth | Pro |
| --- | --- | --- | --- |
| Name, icon, brand colours, live menu | ✓ | ✓ | ✓ |
| Push notifications on order status | ✓ | ✓ | ✓ |
| Splash screen | Default (brand colour + icon) | Custom | Custom |
| Menu layout | List | List, grid or featured | Any |
| Branch picker | — | ✓ | ✓ |
| Extra options: promo banner, pickup only / delivery only, per-item notes, order again | — | Up to 3 | All |
| Custom domain links (`mamaskitchen.ng/order` opens the app) | — | — | ✓ (app side done; the domain's download page and link-verification files come in Phase 4) |

The API enforces this: values a plan doesn't include are rejected when an app config version is created, and masked when served, so a downgrade takes effect without a new build.

## Run it locally

```bash
pnpm install
pnpm --filter @cullinari/shared build
pnpm dev:api                            # API on :4000, with the demo restaurant seeded
cd apps/ordering
npx expo start                          # builds the demo restaurant (tenants/olaskitchen.json)
```

- **Web** (press `w`): fastest for UI work. Add `http://localhost:8081` to the API's `CORS_ORIGINS`.
- **Phone**: the phone can't reach `localhost`, so point it at your computer:
  `EXPO_PUBLIC_API_URL=http://192.168.x.x:4000 npx expo start`.
  Push notifications need a development build (`npx eas-cli build --profile development`), not Expo Go.
- **Another restaurant**: `CULLINARI_TENANT=mamaskitchen npx expo start` after pulling its config (below).

Checks: `pnpm typecheck`, `pnpm test` (cart and pricing rules), and `npx expo export --platform android --platform ios` to confirm the native bundles compile.

## Producing a restaurant's app

### 1. App settings (staff)

Create and publish the app config version (the setup form in the staff console will call these):

```bash
curl -X POST $API/internal/apps/mamaskitchen/configs -H "x-staff-key: $KEY" -H 'content-type: application/json' -d '{
  "appName": "Mama'\''s Kitchen",
  "theme": { "primary": "#9b2c1f", "accent": "#f2b632", "iconUrl": "https://…/icon-1024.png" },
  "layout": "list"
}'
curl -X POST $API/internal/apps/mamaskitchen/configs/2/publish -H "x-staff-key: $KEY"
```

The icon must be a 1024×1024 PNG. Growth and Pro can add `splash: { imageUrl, background }`, `layout: "grid" | "featured"`, `options` and `promoText`.

### 2. First build for a restaurant (once)

Store rules expect apps generated from a template service to be published under the restaurant's own developer account. Before the first build:

1. The restaurant creates an **Apple Developer** account ($99/year) and ideally its own **Google Play** developer account ($25 once), and adds Cullinari as an admin.
2. Pull the config and create the restaurant's EAS project:
   ```bash
   CULLINARI_API_URL=$API CULLINARI_STAFF_KEY=$KEY pnpm --filter @cullinari/ordering tenant:pull mamaskitchen --select
   cd apps/ordering && npx eas-cli@latest init
   ```
   Copy the project ID it prints into `tenants/mamaskitchen.json` as `"eas": { "projectId": "…", "owner": "<expo account>" }` and commit the file.
3. Set up signing once, interactively: `npx eas-cli@latest credentials` (log in with the restaurant's Apple account for iOS; let EAS create the Android keystore). For Play submissions, add a Google service account key with `eas credentials`.
4. In Google Play Console, create the app with package `com.cullinari.mamaskitchen`. The first Android upload must be done by hand in Play Console; after that, submissions are automatic.

### 3. Every store build

Run **Actions → Build restaurant app** with the slug. It pulls the latest config, bumps the build number, starts the EAS build (optionally auto-submitting to the stores) and commits the new build number. Store review usually takes 1–3 days.

Repository settings it needs: secret `EXPO_TOKEN` (an Expo access token), secret `CULLINARI_STAFF_KEY`, and variable `CULLINARI_API_URL`.

### 4. Updates without a store release

Code fixes and small UI changes ship to every restaurant at once with **Actions → Update restaurant apps (OTA)** (EAS Update). Changes to native code, permissions, the SDK, the app name or icon need a new store build. Menu and price changes need neither: they're live from the API.

## Payments

Card payments use the restaurant's own Paystack account (configured in the admin's Settings). Checkout opens Paystack in an in-app browser; Paystack returns to the API, which confirms the payment and redirects back into the app at `<scheme>://payment`. The app also verifies the payment itself and the tracking screen shows "waiting for payment" until it's confirmed. Food is a physical good, so this is allowed outside Apple/Google in-app purchase.

## Layout

```
app.config.ts          Per-restaurant Expo config (reads tenants/<slug>.json)
tenants/               One JSON per restaurant (+ downloaded icon/splash art)
scripts/tenant-pull.mjs  Writes tenants/<slug>.json from the API
src/app/               Screens (Expo Router): menu, item, cart, checkout, order tracking, past orders
src/lib/               API client, store (config, menu, cart, saved details), cart rules, push
src/components/        Buttons, steppers, banners, menu item layouts
```
