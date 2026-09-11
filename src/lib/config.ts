/** Public build-time configuration. Server secrets must never be added here. */
type PublicConfig = Readonly<{
  supabaseUrl: string
  supabasePublishableKey: string
  relayUrl: string
  authRedirectUrl: string
  revenueCatWebKey: string
  revenueCatAppleKey: string
}>

declare const __AUDEEO_CONFIG__: PublicConfig
export const config: PublicConfig = Object.freeze(__AUDEEO_CONFIG__)
