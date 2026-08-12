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

/**
 * URLs dos apps que a aba Ferramentas embute em iframe.
 *
 * Estas ficavam só em env, e isso quebrou a v0.0.207: o `.env.local` da pasta de
 * onde o build saiu tinha 4 das 10 variáveis que o código lê, e as duas que
 * faltavam eram exatamente estas. Como o Vite grava `VITE_*` no bundle em tempo
 * de BUILD, o app foi para a frota com a URL vazia e as duas ferramentas
 * abriam no aviso "não está configurado".
 *
 * Não são segredo: o `Dockerfile` já as declarava como `ARG` com estes mesmos
 * valores padrão, sob o comentário "URLs públicas, sem segredo". O padrão só
 * vivia lá, no build da web — Electron e Android ficavam de fora. Agora vive
 * aqui, onde as três plataformas leem.
 */
const RELATORIOS_APP_URL_PADRAO = 'https://frontends-relatorios.srofjl.easypanel.host'
const LICITACAO_APP_URL_PADRAO = 'https://frontends-front-licitacao.srofjl.easypanel.host'

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
  // A ordem importa: `runtimeConfig` primeiro é o que deixa a WEB trocar de
  // domínio sem rebuild — o Docker reescreve `dist/env-config.js` depois do
  // build. Esse caminho não existe no Electron nem no Android, onde o valor é
  // gravado no bundle de qualquer jeito; por isso o padrão no fim da fila, que
  // é o que impede um `.env.local` incompleto de quebrar em silêncio.
  VITE_RELATORIOS_APP_URL:
    runtimeConfig?.VITE_RELATORIOS_APP_URL ||
    import.meta.env.VITE_RELATORIOS_APP_URL ||
    RELATORIOS_APP_URL_PADRAO,
  VITE_LICITACAO_APP_URL:
    runtimeConfig?.VITE_LICITACAO_APP_URL ||
    import.meta.env.VITE_LICITACAO_APP_URL ||
    LICITACAO_APP_URL_PADRAO,
  VITE_LICITACAO_SUPABASE_URL:
    runtimeConfig?.VITE_LICITACAO_SUPABASE_URL ||
    import.meta.env.VITE_LICITACAO_SUPABASE_URL ||
    LICITACAO_SUPABASE_URL_PADRAO,
}
