import { expect, it } from 'vitest'
import { resolveConfig } from 'vite'

it('exposes only named public settings, never provider secrets or VITE-prefixed variables', async () => {
  const overrides = {
    SUPABASE_URL: 'https://configuration-test.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    SONIOX_API_KEY: 'soniox-server-only-secret',
    OPENAI_API_KEY: 'openai-server-only-secret',
    DEEPGRAM_API_KEY: 'secret-must-not-reach-the-client',
    QWEN_API_KEY: 'another-server-only-secret',
    SUPABASE_SECRET_KEY: 'sb_secret_must-stay-server-side',
    VITE_ACCIDENTAL_SECRET: 'prefix-must-not-auto-expose-this',
  }
  const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]))
  Object.assign(process.env, overrides)
  try {
    const resolved = await resolveConfig({}, 'build', 'production')
    const publicConfig = JSON.parse(resolved.define!.__AUDEEO_CONFIG__ as string)
    expect(Object.keys(publicConfig).sort()).toEqual([
      'authRedirectUrl', 'relayUrl', 'revenueCatAppleKey', 'revenueCatWebKey', 'supabasePublishableKey', 'supabaseUrl',
    ])
    expect(publicConfig.supabaseUrl).toBe(overrides.SUPABASE_URL)
    expect(publicConfig.supabasePublishableKey).toBe(overrides.SUPABASE_PUBLISHABLE_KEY)
    const exposed = JSON.stringify({ define: resolved.define, env: resolved.env })
    for (const [key, value] of Object.entries(overrides)) {
      if (key !== 'SUPABASE_URL' && key !== 'SUPABASE_PUBLISHABLE_KEY') expect(exposed).not.toContain(value)
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
