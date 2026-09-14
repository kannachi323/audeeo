export type PublicConfig = {
  supabaseUrl: string
  supabasePublishableKey: string
  revenueCatWebKey: string
}

declare const __AUDEEO_WEB_CONFIG__: PublicConfig

export const config = Object.freeze(__AUDEEO_WEB_CONFIG__)
