import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  if (!['direct', 'app-store', 'web'].includes(env.AUDEEO_DISTRIBUTION || '')) throw new Error('Set AUDEEO_DISTRIBUTION=direct, app-store, or web in .env.')
  const billingEnvironment = env.AUDEEO_BILLING_ENVIRONMENT || 'production'
  if (!['production', 'sandbox'].includes(billingEnvironment)) throw new Error('Invalid AUDEEO_BILLING_ENVIRONMENT in .env.')
  const webKey = billingEnvironment === 'sandbox' ? env.REVENUECAT_WEB_SANDBOX_KEY || '' : env.REVENUECAT_WEB_KEY || ''
  if (webKey && (billingEnvironment === 'sandbox') !== webKey.startsWith('rcb_sb_')) throw new Error('RevenueCat web key does not match AUDEEO_BILLING_ENVIRONMENT.')
  const host = process.env.TAURI_DEV_HOST
  const devPort = 1420
  const hmrPort = devPort + 1
  return {
    plugins: [react()],
    resolve: { dedupe: ['@revenuecat/purchases-js'] },
    // Disable automatic env exposure. Only this explicit public allowlist is bundled.
    envPrefix: [],
    define: {
      __AUDEEO_CONFIG__: JSON.stringify({
        distribution: env.AUDEEO_DISTRIBUTION,
        billingEnvironment,
        supabaseUrl: env.SUPABASE_URL || '',
        supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY || '',
        relayUrl: env.RELAY_URL || 'http://127.0.0.1:8787',
        authRedirectUrl: env.AUTH_REDIRECT_URL || '',
        revenueCatWebKey: webKey,
        revenueCatAppleKey: env.REVENUECAT_APPLE_KEY || '',
      }),
    },
    clearScreen: false,
    server: { port: devPort, strictPort: true, host: host || false,
      hmr: host ? { protocol: 'ws', host, port: hmrPort } : undefined,
      watch: { ignored: ['**/src-tauri/**', '**/native/**', '**/services/**', '**/artifacts/**'] } },
  }
})
