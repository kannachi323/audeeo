# Audeeo website

Separate Vite/React website deployed as Cloudflare Worker Static Assets. The
landing page uses a static product preview and works without backend
configuration. Website account access uses the same Supabase and RevenueCat
projects as the desktop app.

## Account configuration

Set these public build variables in the repository-root `.env`, the build
environment, or a local `website/.env` file:

```sh
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
RELAY_URL=
REVENUECAT_WEB_KEY=
```

Only these explicitly allowlisted values enter the website bundle. Add every
deployed website origin and local development origin to the Supabase Auth
redirect allow list. Google and Apple must already be enabled in Supabase;
Apple web OAuth also requires its Services ID to be the first configured client
ID. Never add a Supabase secret/service-role key or RevenueCat secret key to the
website environment.

Production builds ignore RevenueCat Test Store (`test_`) keys so fake purchases
cannot grant access on the public site. Set a live web public key to enable the
checkout buttons; development builds may continue using Test Store.

`RELAY_URL` is the public HTTPS origin of the deployed session relay. The website
posts to `/v1/purchases/restore` after checkout and when the customer refreshes
their account so the server-side allowance is reconciled from RevenueCat. Add the
website origin to the relay's `ALLOWED_ORIGINS` binding.

## Development

```sh
npm ci
npm run dev
npm run build
```

## Cloudflare deployment

Wrangler is pinned in this subproject. From the repository root:

```sh
npm --prefix website run deploy:dry
npm --prefix website run deploy
```

Or from `website/` itself, run `npm run deploy`. The Worker serves `dist/` as
static assets, falls back to `index.html` for React Router paths, and owns the
zone routes `audeeo.app/*` and `www.audeeo.app/*`.

The optional media rendering scripts are documented in
[the demo asset directory](video/three-pigs/README.md).
