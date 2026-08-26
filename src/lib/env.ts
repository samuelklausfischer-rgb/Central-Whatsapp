type AppRuntimeConfig = {
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_PUBLISHABLE_KEY?: string
  VITE_RELATORIOS_APP_URL?: string
  VITE_LICITACAO_APP_URL?: string
  VITE_LICITACAO_SUPABASE_URL?: string
  VITE_PRN_HUB_APP_URL?: string
  VITE_GESTAO_MEDICA_APP_URL?: string
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
const PRN_HUB_APP_URL_PADRAO = 'https://frontends-projetos-hub.srofjl.easypanel.host'
/**
 * Gestão Médica. Ao contrário do Licitações, NÃO há URL de Supabase própria aqui:
 * o banco dele é o schema `gestao_medica` deste mesmo projeto, então a sessão
 * atravessa direto e não existe ponte para configurar.
 */
const GESTAO_MEDICA_APP_URL_PADRAO = 'https://frontends-gestao-medica.srofjl.easypanel.host'

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
  // ITEM 2: PRN Hub. Com padrão no código, como as outras duas e pela mesma
  // lição da v0.0.207 explicada acima — só em `.env.local` a variável falta no
  // build e a ferramenta vai quebrada para a frota, em silêncio.
  //
  // ATENÇÃO: em 24/08/2026 esta URL respondia `401` com
  // `WWW-Authenticate: Basic realm="PRN Hub"`. Enquanto essa proteção existir, o
  // iframe NÃO carrega: o Chrome não deixa um quadro de outra origem pedir
  // usuário e senha, então a ferramenta abre vazia. A URL fica aqui pronta, mas
  // o que destrava a ferramenta é tirar o Basic auth do serviço — o app já exige
  // login próprio, então ele é uma segunda tranca na mesma porta.
  VITE_PRN_HUB_APP_URL:
    runtimeConfig?.VITE_PRN_HUB_APP_URL ||
    import.meta.env.VITE_PRN_HUB_APP_URL ||
    PRN_HUB_APP_URL_PADRAO,

  VITE_GESTAO_MEDICA_APP_URL:
    runtimeConfig?.VITE_GESTAO_MEDICA_APP_URL ||
    import.meta.env.VITE_GESTAO_MEDICA_APP_URL ||
    GESTAO_MEDICA_APP_URL_PADRAO,
}
