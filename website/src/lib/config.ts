export type PublicConfig = {
  billingEnvironment: 'production' | 'sandbox'
  supabaseUrl: string
  supabasePublishableKey: string
  relayUrl: string
  revenueCatWebKey: string
}

declare const __AUDEEO_WEB_CONFIG__: PublicConfig

export const config = Object.freeze(__AUDEEO_WEB_CONFIG__)
