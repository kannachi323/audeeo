import { createClient, type Provider } from '@supabase/supabase-js'
import { config } from './config'

export const supabase = config.supabaseUrl && config.supabasePublishableKey
  ? createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true },
    })
  : undefined

export async function signIn(provider: Extract<Provider, 'apple' | 'google'>, returnTo = '/') {
  if (!supabase) throw new Error('Website sign-in is not configured yet.')
  const destination = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/'
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${window.location.origin}/signin?returnTo=${encodeURIComponent(destination)}` },
  })
  if (error) throw error
}
