type AppRuntimeConfig = {
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_PUBLISHABLE_KEY?: string
  VITE_RELATORIOS_APP_URL?: string
  VITE_LICITACAO_APP_URL?: string
  VITE_LICITACAO_SUPABASE_URL?: string
}

/**
 * Projeto Supabase do Licitações, onde vive a edge function `licitacao-bridge`.
 * Tem padrão no código de propósito: `.env.local` não vem no clone e um valor
 * vazio aqui quebraria a ferramenta em silêncio na frota inteira. Só a URL —
 * nenhuma chave — e continua sobrescrevível por env.
 */
const LICITACAO_SUPABASE_URL_PADRAO = 'https://qndymclntzdrdhrwlcda.supabase.co'

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
  // URLs dos apps publicados que a aba Ferramentas embute. Ficam em env (e não
  // no código) porque trocar de domínio não deveria exigir rebuild do fonte.
  VITE_RELATORIOS_APP_URL:
    runtimeConfig?.VITE_RELATORIOS_APP_URL || import.meta.env.VITE_RELATORIOS_APP_URL || '',
  VITE_LICITACAO_APP_URL:
    runtimeConfig?.VITE_LICITACAO_APP_URL || import.meta.env.VITE_LICITACAO_APP_URL || '',
  VITE_LICITACAO_SUPABASE_URL:
    runtimeConfig?.VITE_LICITACAO_SUPABASE_URL ||
    import.meta.env.VITE_LICITACAO_SUPABASE_URL ||
    LICITACAO_SUPABASE_URL_PADRAO,
}
