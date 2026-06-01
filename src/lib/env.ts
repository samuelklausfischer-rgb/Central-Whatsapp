type AppRuntimeConfig = {
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_PUBLISHABLE_KEY?: string
}

declare global {
  interface Window {
    __APP_CONFIG__?: AppRuntimeConfig
  }
}

const runtimeConfig = typeof window !== 'undefined' ? window.__APP_CONFIG__ : undefined

export const appEnv = {
  VITE_SUPABASE_URL: runtimeConfig?.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL || '',
  VITE_SUPABASE_PUBLISHABLE_KEY:
    runtimeConfig?.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '',
}
