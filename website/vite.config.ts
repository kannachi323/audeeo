import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig(({ mode }) => {
  const env = {
    ...loadEnv(mode, resolve(process.cwd(), '..'), ''),
    ...loadEnv(mode, process.cwd(), ''),
    ...process.env,
  }
  const revenueCatWebKey = env.REVENUECAT_WEB_KEY || ''
  return {
    plugins: [react()],
    envPrefix: [],
    define: {
      __AUDEEO_WEB_CONFIG__: JSON.stringify({
        supabaseUrl: env.SUPABASE_URL || '',
        supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY || '',
        relayUrl: env.RELAY_URL || '',
        // Never expose Test Store checkout on the public production domains.
        revenueCatWebKey: mode === 'production' && revenueCatWebKey.startsWith('test_') ? '' : revenueCatWebKey,
      }),
    },
    server: { port: 5173, strictPort: false },
    preview: { port: 4173, strictPort: false },
  }
})
