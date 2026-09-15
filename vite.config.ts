import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  const host = process.env.TAURI_DEV_HOST
  const platform = process.env.TAURI_ENV_PLATFORM
  const devPort = platform === 'android' ? 1430 : platform === 'ios' ? 1440 : 1420
  const hmrPort = devPort + 1
  return {
    plugins: [react()],
    resolve: { dedupe: ['@revenuecat/purchases-js'] },
    // Disable automatic env exposure. Only this explicit public allowlist is bundled.
    envPrefix: [],
    define: {
      __AUDEEO_CONFIG__: JSON.stringify({
        supabaseUrl: env.SUPABASE_URL || '',
        supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY || '',
        relayUrl: env.RELAY_URL || 'http://127.0.0.1:8787',
        authRedirectUrl: env.AUTH_REDIRECT_URL || '',
        revenueCatWebKey: env.REVENUECAT_WEB_KEY || '',
        revenueCatAppleKey: env.REVENUECAT_APPLE_KEY || '',
      }),
    },
    clearScreen: false,
    server: { port: devPort, strictPort: true, host: host || false,
      hmr: host ? { protocol: 'ws', host, port: hmrPort } : undefined,
      watch: { ignored: ['**/src-tauri/**', '**/native/**', '**/services/**', '**/artifacts/**'] } },
  }
})
