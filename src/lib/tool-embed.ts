/**
 * Protocolo de sessão entre o Central Whats (pai) e os apps embutidos na aba
 * Ferramentas (filhos, em iframe cross-origin).
 *
 * Fluxo:
 *   1. o pai monta o iframe com `?embed=1&h=<nonce>`;
 *   2. o filho, ao carregar, publica `ready` no `window.parent`;
 *   3. o pai responde com `credential` + o mesmo nonce, usando targetOrigin exato;
 *   4. o filho só aceita se o nonce bater.
 *
 * Por que nonce e não allowlist de origem: no Electron o pai roda em `file://` e
 * o `event.origin` que o filho enxerga é a string "null", que qualquer iframe
 * sandboxed também produz. Uma allowlist obrigada a aceitar "null" não filtra
 * nada; o nonce faz o filho descartar mensagem de qualquer janela que não seja a
 * que montou o iframe.
 *
 * O que protege o token de verdade é o `targetOrigin` exato na ida (nunca '*'):
 * mesmo que o iframe seja redirecionado, a credencial não é entregue a outra
 * origem. Ver a nota completa em `src/lib/embed.ts` dos apps filhos.
 *
 * Este arquivo é espelhado em `src/lib/embed.ts` nos dois apps filhos —
 * qualquer mudança aqui precisa ser feita nos três.
 */

export const EMBED_PROTOCOL = 'central-whats-embed'

/** Relatórios: mesmo projeto Supabase, então a sessão é transportada direto. */
export interface SupabaseSessionCredential {
  kind: 'supabase-session'
  access_token: string
  refresh_token: string
}

/** Licitações: outro projeto, então o que trafega é um OTP de uso único. */
export interface OtpCredential {
  kind: 'otp'
  token_hash: string
  verification_type: string
}

export type EmbedCredential = SupabaseSessionCredential | OtpCredential

/** filho -> pai: "montei, pode mandar a credencial". Não carrega segredo. */
export interface EmbedReadyMessage {
  source: typeof EMBED_PROTOCOL
  type: 'ready'
}

/** pai -> filho */
export interface EmbedCredentialMessage {
  source: typeof EMBED_PROTOCOL
  type: 'credential'
  nonce: string
  credential: EmbedCredential
}

/** filho -> pai: falhou ao usar a credencial; o pai mostra o erro fora do iframe. */
export interface EmbedErrorMessage {
  source: typeof EMBED_PROTOCOL
  type: 'error'
  message: string
}

export type EmbedMessage = EmbedReadyMessage | EmbedCredentialMessage | EmbedErrorMessage

export function isEmbedMessage(data: unknown): data is EmbedMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { source?: unknown }).source === EMBED_PROTOCOL &&
    typeof (data as { type?: unknown }).type === 'string'
  )
}

/**
 * Monta a URL do iframe preservando path e query que já venham na env
 * (ex.: `https://app.exemplo.com/relatorios?tenant=prn`).
 * Devolve `null` quando a env está vazia ou não é uma URL válida — quem chama
 * mostra o aviso de configuração em vez de renderizar um iframe quebrado.
 *
 * `version`, quando informado, vira `?v=<versão>` — cache-busting só do
 * DOCUMENTO do iframe (o `ToolFrame` usa isso ao recarregar depois que o
 * usuário aceita a faixa de atualização). O bundle interno do app filho, com
 * hash no nome dos arquivos, continua cacheado normalmente: não é este `v`
 * que decide isso, é o navegador batendo hash-miss no HTML novo.
 *
 * ALTERNATIVA PREFERÍVEL, NÃO IMPLEMENTADA: a ferramenta externa poderia
 * informar a própria versão dentro do `ready` do handshake abaixo (ex.:
 * `{ source, type: 'ready', version }`). Evitaria a requisição extra a
 * `/version.json` e qualquer risco de CORS — mas depende de mudar o filho
 * (`embed.ts` nos dois apps) e não é o caminho atual. Ver
 * `src/hooks/use-tool-version.ts` para a implementação via `version.json`.
 */
export function buildEmbedUrl(
  baseUrl: string,
  nonce: string,
  version?: string,
): { src: string; origin: string } | null {
  const trimmed = baseUrl.trim()
  if (!trimmed) return null

  try {
    const url = new URL(trimmed)
    url.searchParams.set('embed', '1')
    url.searchParams.set('h', nonce)
    if (version) url.searchParams.set('v', version)
    return { src: url.toString(), origin: url.origin }
  } catch {
    return null
  }
}
