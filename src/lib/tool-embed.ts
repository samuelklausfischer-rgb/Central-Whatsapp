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

/**
 * pai -> filho: o tema atual do Central Whats.
 *
 * Existe porque o tema mora no `localStorage` DESTA origem, e o iframe é de
 * outra — o app filho não tem como espiar. Sem isto, a ferramenta abriria com a
 * cor dela (o Gestão Médica ficava travado no escuro) dentro de um app que pode
 * estar no claro.
 *
 * ADITIVA: `isEmbedMessage` só confere `source` e que `type` é string, então
 * quem ainda não conhece este tipo (Relatórios, Licitações) simplesmente ignora
 * a mensagem. Não há ordem de deploy a respeitar.
 *
 * NÃO carrega segredo, mas viaja com `targetOrigin` exato como a credencial —
 * usar `'*'` aqui abriria um precedente ao lado da única linha que não pode.
 */
export interface EmbedThemeMessage {
  source: typeof EMBED_PROTOCOL
  type: 'theme'
  theme: 'dark' | 'light'
}

/**
 * filho -> pai: "leve a pessoa para OUTRA ferramenta, nesta rota".
 *
 * Existe para o Licitações mandar um edital para o quadro do Gestor de Tarefas
 * (`/licitacao?novo=1&titulo=...`): são apps diferentes, em bancos diferentes, e
 * o único elo entre eles é este pai.
 *
 * ⚠️ É a ÚNICA mensagem em que um filho manda o pai fazer algo fora do iframe.
 * Por isso `pedidoDeAberturaValido` abaixo é obrigatório, e o `ToolFrame` já
 * confere `event.source === iframe.contentWindow` antes de olhar o conteúdo.
 */
export interface EmbedOpenToolMessage {
  source: typeof EMBED_PROTOCOL
  type: 'open-tool'
  slug: string
  /** Rota DENTRO do app de destino, sempre relativa (ex.: `/licitacao?novo=1`). */
  path: string
}

/**
 * pai -> filho: "vá para esta rota", sem recarregar.
 *
 * Recarregar seria o caminho óbvio (trocar o `src` do iframe), mas as
 * ferramentas ficam MONTADAS de propósito para não refazer o handshake — ver
 * `stores/ferramentasVivas.ts`. Além disso um `src` com a rota dentro seria
 * reaplicado se a ferramenta remontasse, reabrindo o mesmo formulário.
 *
 * ADITIVA, como o `theme`: quem não conhece este tipo ignora.
 */
export interface EmbedNavigateMessage {
  source: typeof EMBED_PROTOCOL
  type: 'navigate'
  path: string
}

export type EmbedMessage =
  | EmbedReadyMessage
  | EmbedCredentialMessage
  | EmbedErrorMessage
  | EmbedThemeMessage
  | EmbedOpenToolMessage
  | EmbedNavigateMessage

/**
 * Ferramentas que OUTRA ferramenta pode pedir para abrir.
 *
 * Deliberadamente curta: hoje o único caminho que existe é o Licitações mandando
 * um edital para o quadro do Gestor de Tarefas. Crescer esta lista é decisão
 * consciente, não consequência de alguém ter mandado um slug novo.
 */
export const SLUGS_ABRIVEIS = ['relatorios'] as const

/**
 * O pedido de abertura, se for confiável — senão `null`.
 *
 * O que se defende aqui: um app filho comprometido (ou uma página que ele tenha
 * embutido) pedindo ao Central Whats que navegue para onde quiser. `slug` tem de
 * estar na lista de quem chama, e `path` tem de ser rota interna:
 *
 *   - `//outro-host/x`  → o navegador leria como protocolo-relativo e sairia daqui
 *   - `http://…`        → outra origem
 *   - `javascript:…`    → execução
 *   - `\\servidor`      → alguns navegadores normalizam a barra invertida
 */
export function pedidoDeAberturaValido(
  data: unknown,
  slugsPermitidos: readonly string[],
): { slug: string; path: string } | null {
  if (!isEmbedMessage(data) || data.type !== 'open-tool') return null
  const { slug, path } = data as EmbedOpenToolMessage
  if (typeof slug !== 'string' || !slugsPermitidos.includes(slug)) return null
  if (typeof path !== 'string' || path.length > 2000) return null
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return null
  if (path.includes('\\')) return null
  return { slug, path }
}

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
