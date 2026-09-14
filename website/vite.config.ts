import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  return {
    plugins: [react()],
    envPrefix: [],
    define: {
      __AUDEEO_WEB_CONFIG__: JSON.stringify({
        supabaseUrl: env.SUPABASE_URL || '',
        supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY || '',
        revenueCatWebKey: env.REVENUECAT_WEB_KEY || '',
      }),
    },
    server: { port: 5173, strictPort: false },
    preview: { port: 4173, strictPort: false },
  }
})
