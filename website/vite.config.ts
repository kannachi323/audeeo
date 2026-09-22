import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig(({ mode, command }) => {
  const env = {
    ...loadEnv(mode, resolve(process.cwd(), '..'), ''),
    ...loadEnv(mode, process.cwd(), ''),
    ...process.env,
  }
  const billingEnvironment = env.AUDEEO_BILLING_ENVIRONMENT || 'production'
  if (!['production','sandbox'].includes(billingEnvironment)) throw new Error('Invalid AUDEEO_BILLING_ENVIRONMENT in .env.')
  if (command === 'build' && mode === 'production' && billingEnvironment === 'sandbox') throw new Error('Sandbox billing cannot be deployed to the production website. Use npm run build:sandbox for a local test build.')
  const revenueCatWebKey = (billingEnvironment === 'sandbox' ? env.REVENUECAT_WEB_SANDBOX_KEY : env.REVENUECAT_WEB_KEY) || ''
  if (revenueCatWebKey && (billingEnvironment === 'sandbox') !== revenueCatWebKey.startsWith('rcb_sb_')) throw new Error('RevenueCat web key does not match the billing environment.')
  return {
    plugins: [react()],
    envPrefix: [],
    define: {
      __AUDEEO_DEMO_VIDEO__: JSON.stringify(env.VITE_DEMO_VIDEO_URL || ""),
      __AUDEEO_WEB_CONFIG__: JSON.stringify({
        supabaseUrl: env.SUPABASE_URL || '',
        supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY || '',
        relayUrl: env.RELAY_URL || '',
        billingEnvironment,
        // Never expose Test Store checkout on the public production domains.
        revenueCatWebKey: mode === 'production' && (revenueCatWebKey.startsWith('test_') || revenueCatWebKey.startsWith('rcb_sb_')) ? '' : revenueCatWebKey,
      }),
    },
    build: { outDir: mode === 'sandbox' ? 'dist-sandbox' : 'dist' },
    server: { port: 5173, strictPort: true },
    preview: { port: 4173, strictPort: false },
  }
})
