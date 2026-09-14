# Audeeo website

Separate Vite/React website. For Vercel, set the project root to `website`.
The landing page uses a static product preview and works without backend
configuration. Website account access uses the same Supabase and RevenueCat
projects as the desktop app.

## Account configuration

Set these public build variables in Vercel or a local `website/.env` file:

```sh
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
REVENUECAT_WEB_KEY=
```

Only these explicitly allowlisted values enter the website bundle. Add every
deployed website origin and local development origin to the Supabase Auth
redirect allow list. Google and Apple must already be enabled in Supabase;
Apple web OAuth also requires its Services ID to be the first configured client
ID. Never add a Supabase secret/service-role key or RevenueCat secret key to the
website environment.

## Development

```sh
npm ci
npm run dev
npm run build
```

The optional media rendering scripts are documented in
[the demo asset directory](video/three-pigs/README.md).
