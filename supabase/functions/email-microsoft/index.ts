import "jsr:@supabase/functions-js/edge-runtime.d.ts"

/**
 * Conecta as caixas de e-mail da empresa (Microsoft 365) ao Email Hub.
 *
 * Irmã da `agenda-microsoft`, que faz o mesmo fluxo para a agenda e já roda em
 * produção. Quase tudo aqui é o padrão de lá, provado: a resolução do endereço
 * público, o `state` assinado, a troca do código e a renovação do token. Onde
 * este arquivo diverge, o comentário diz por quê.
 *
 * TUDO passa por aqui de propósito: o `refresh_token` dá acesso à caixa por
 * tempo indeterminado e não pode existir no navegador. Ele mora em
 * `email_account_tokens`, tabela com RLS ligada e ZERO policy — só o
 * service_role alcança, e este arquivo é o único que lê de lá.
 *
 * As rotas ficam no fim do caminho: `.../email-microsoft/<rota>`.
 *   status       — a tela pergunta se o aplicativo já foi configurado
 *   configurar   — admin grava as três chaves do Entra ID (nunca as lê de volta)
 *   authorize    — devolve a URL de consentimento da Microsoft
 *   callback     — retorno do consentimento (o navegador vem parar AQUI)
 *   desconectar  — apaga a caixa e o token
 *   pastas       — espelha a árvore de pastas do Outlook
 *   importar     — carga inicial dos últimos N dias
 *   sincronizar  — varredura delta (pg_cron, 15 min)
 *   assinar      — cria o aviso em tempo real da Microsoft
 *   renovar      — renova os avisos que vão vencer (pg_cron, 6h)
 *   avisar       — a Microsoft chama AQUI quando algo muda
 *   anexo        — devolve o binário de um anexo, sob demanda
 *   enviar       — envia, responde, responde a todos e encaminha (08/09/2026)
 *   marcar       — lido/não lido e estrela, com efeito no Outlook (08/09/2026)
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const serviceHeaders = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  apikey: SUPABASE_SERVICE_KEY,
}

const GRAPH = 'https://graph.microsoft.com/v1.0'

/**
 * As cinco permissões consentidas no portal em 26/08/2026. Pedir aqui menos do
 * que foi consentido é seguro; pedir MAIS derruba o consentimento e volta a
 * exigir um administrador.
 */
const ESCOPOS = 'offline_access User.Read Mail.Read Mail.ReadWrite Mail.Send'

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/** Escapa texto que vai para dentro do HTML da página de retorno. */
function esc(txt: string): string {
  return txt.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

/** Página simples para o retorno do consentimento, que roda fora do app. */
function pagina(titulo: string, mensagem: string) {
  return new Response(
    `<!doctype html><html lang="pt-BR"><meta charset="utf-8">
     <meta name="viewport" content="width=device-width,initial-scale=1">
     <title>${esc(titulo)}</title>
     <body style="font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#0b1220;color:#e6edf7">
       <div style="max-width:28rem;text-align:center;padding:2rem">
         <h1 style="font-size:1.1rem;font-weight:600">${esc(titulo)}</h1>
         <p style="color:#93a4bd;line-height:1.6">${esc(mensagem)}</p>
       </div>
     </body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

// ——— Segredos e configuração ———

const CHAVES = [
  'EMAIL_MS_CLIENT_ID',
  'EMAIL_MS_TENANT_ID',
  'EMAIL_MS_CLIENT_SECRET',
  'EMAIL_MS_STATE_SECRET',
  // Segredo que a Microsoft devolve em cada aviso. A URL do aviso é pública por
  // natureza, então é isto que separa um aviso legítimo de um forjado.
  'EMAIL_MS_WEBHOOK_SECRET',
  // Como o agendador do banco (pg_cron) se identifica. Deliberadamente separado
  // da chave de serviço: só abre as rotas de sincronizar e renovar.
  'EMAIL_MS_CRON_SECRET',
] as const

async function lerSegredos(): Promise<Record<string, string>> {
  const lista = CHAVES.map((k) => `"${k}"`).join(',')
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/secrets?key=in.(${encodeURIComponent(lista)})&select=key,value`,
    { headers: serviceHeaders },
  )
  if (!resp.ok) return {}
  const linhas = (await resp.json()) as { key: string; value: string }[]
  return Object.fromEntries(linhas.map((l) => [l.key, l.value]))
}

function estaConfigurado(s: Record<string, string>) {
  return Boolean(s.EMAIL_MS_CLIENT_ID && s.EMAIL_MS_TENANT_ID && s.EMAIL_MS_CLIENT_SECRET)
}

// ——— Quem está chamando ———

async function usuarioDaRequisicao(authHeader: string): Promise<string | null> {
  if (!authHeader) return null
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: SUPABASE_SERVICE_KEY },
  })
  if (!resp.ok) return null
  const user = await resp.json()
  return user?.id ?? null
}

/**
 * Confere `is_admin` NO SERVIDOR.
 *
 * A tela também esconde os botões de admin, mas esconder botão não é
 * autorização: quem chamar a rota direto passaria reto. É aqui que a regra vale.
 */
async function ehAdmin(userId: string): Promise<boolean> {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=is_admin`,
    { headers: serviceHeaders },
  )
  if (!resp.ok) return false
  const linhas = await resp.json()
  return Array.isArray(linhas) && linhas[0]?.is_admin === true
}

// ——— O `state`, assinado ———

/**
 * O `state` volta da Microsoft junto com o código. Aqui ele carrega mais do que
 * na Agenda: além de quem pediu, precisa dizer se a caixa é pessoal ou de setor,
 * o apelido, o setor e qual endereço era esperado. Vai tudo assinado, porque um
 * state adulterado poderia, por exemplo, transformar uma conexão pessoal em
 * caixa de um setor que a pessoa não administra.
 *
 * Continua sem tabela de estado: a assinatura e o carimbo de tempo bastam.
 */
const VALIDADE_DO_STATE_MS = 10 * 60 * 1000

interface Pedido {
  /** Quem clicou em conectar. */
  u: string
  /** `pessoal` (só o dono vê) ou `setor` (o setor inteiro vê). */
  t: 'pessoal' | 'setor'
  /** Apelido que aparece na lista. */
  l: string
  /** Setor, quando for caixa de setor. */
  d: string | null
  /** Endereço que o admin disse que ia conectar, para conferir no retorno. */
  e: string | null
}

function b64url(txt: string): string {
  const bytes = new TextEncoder().encode(txt)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function deB64url(txt: string): string {
  const pad = txt.length % 4 ? '='.repeat(4 - (txt.length % 4)) : ''
  const bin = atob(txt.replace(/-/g, '+').replace(/_/g, '/') + pad)
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

async function assinar(valor: string, segredo: string): Promise<string> {
  const chave = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(segredo),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const assinatura = await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(valor))
  return [...new Uint8Array(assinatura)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function montarState(pedido: Pedido, segredo: string): Promise<string> {
  const corpo = `${b64url(JSON.stringify(pedido))}.${Date.now()}`
  return `${corpo}.${await assinar(corpo, segredo)}`
}

async function lerState(state: string, segredo: string): Promise<Pedido | null> {
  const partes = state.split('.')
  if (partes.length !== 3) return null
  const [carga, emitidoEm, assinatura] = partes
  if ((await assinar(`${carga}.${emitidoEm}`, segredo)) !== assinatura) return null
  if (Date.now() - Number(emitidoEm) > VALIDADE_DO_STATE_MS) return null
  try {
    return JSON.parse(deB64url(carga)) as Pedido
  } catch {
    return null
  }
}

// ——— Contas e tokens ———

interface Conta {
  id: string
  user_id: string
  department: string | null
  email: string
}

async function contaPorEmail(email: string): Promise<Conta | null> {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/email_accounts?email=eq.${encodeURIComponent(email)}&select=id,user_id,department,email`,
    { headers: serviceHeaders },
  )
  if (!resp.ok) return null
  const linhas = await resp.json()
  return Array.isArray(linhas) && linhas[0] ? (linhas[0] as Conta) : null
}

async function contaPorId(id: string): Promise<Conta | null> {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/email_accounts?id=eq.${encodeURIComponent(id)}&select=id,user_id,department,email`,
    { headers: serviceHeaders },
  )
  if (!resp.ok) return null
  const linhas = await resp.json()
  return Array.isArray(linhas) && linhas[0] ? (linhas[0] as Conta) : null
}

/**
 * Cria a caixa, ou atualiza se aquele endereço já estiver conectado.
 *
 * Reconectar é caminho normal, não exceção: quando o refresh token vence ou
 * alguém revoga o acesso no portal, a saída é conectar de novo. Se isso criasse
 * linha nova, a lista encheria de caixas duplicadas e os e-mails antigos
 * ficariam pendurados na conta morta.
 */
async function salvarConta(pedido: Pedido, email: string): Promise<string | null> {
  const existente = await contaPorEmail(email)

  if (existente) {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/email_accounts?id=eq.${encodeURIComponent(existente.id)}`,
      {
        method: 'PATCH',
        headers: { ...serviceHeaders, Prefer: 'return=representation' },
        body: JSON.stringify({
          label: pedido.l,
          department: pedido.t === 'setor' ? pedido.d : null,
          user_id: pedido.u,
          is_active: true,
          updated_at: new Date().toISOString(),
        }),
      },
    )
    return resp.ok ? existente.id : null
  }

  const resp = await fetch(`${SUPABASE_URL}/rest/v1/email_accounts`, {
    method: 'POST',
    headers: { ...serviceHeaders, Prefer: 'return=representation' },
    body: JSON.stringify({
      user_id: pedido.u,
      department: pedido.t === 'setor' ? pedido.d : null,
      label: pedido.l,
      email,
      provider: 'outlook',
      is_active: true,
    }),
  })
  if (!resp.ok) return null
  const linhas = await resp.json()
  return Array.isArray(linhas) && linhas[0]?.id ? String(linhas[0].id) : null
}

async function gravarToken(accountId: string, dados: Record<string, unknown>) {
  await fetch(`${SUPABASE_URL}/rest/v1/email_account_tokens?on_conflict=account_id`, {
    method: 'POST',
    headers: { ...serviceHeaders, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ account_id: accountId, ...dados, updated_at: new Date().toISOString() }),
  })
}

async function trocarCodigoPorToken(codigo: string, s: Record<string, string>, redirectUri: string) {
  const corpo = new URLSearchParams({
    client_id: s.EMAIL_MS_CLIENT_ID,
    client_secret: s.EMAIL_MS_CLIENT_SECRET,
    code: codigo,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  })
  const resp = await fetch(`https://login.microsoftonline.com/${s.EMAIL_MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: corpo,
  })
  return { ok: resp.ok, dados: await resp.json() }
}

// ——— Sincronização com o Graph ———

/** Campos que a lista e o leitor precisam. Pedir só isto encolhe muito a resposta. */
const CAMPOS_DA_MENSAGEM =
  'id,internetMessageId,conversationId,subject,bodyPreview,body,from,toRecipients,' +
  'ccRecipients,bccRecipients,replyTo,hasAttachments,importance,isDraft,isRead,flag,' +
  'webLink,receivedDateTime,sentDateTime,parentFolderId'

async function rest(caminho: string, init?: RequestInit) {
  return await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, {
    ...init,
    headers: { ...serviceHeaders, ...(init?.headers ?? {}) },
  })
}

/**
 * Um access token válido para a caixa, renovando quando preciso.
 *
 * Cópia do `tokenValido` da `agenda-microsoft`. Dois detalhes que parecem
 * pequenos e não são:
 *  - a folga de 60s existe porque um token que vence "em 3 segundos" passaria na
 *    checagem e morreria no meio da chamada ao Graph;
 *  - a Microsoft PODE devolver um refresh token novo. Guardar o novo quando vier
 *    é o que impede a conexão morrer sozinha na renovação seguinte.
 */
async function tokenValido(accountId: string, s: Record<string, string>): Promise<string | null> {
  const resp = await rest(`email_account_tokens?account_id=eq.${encodeURIComponent(accountId)}&select=*`)
  if (!resp.ok) return null
  const linhas = await resp.json()
  const t = Array.isArray(linhas) ? linhas[0] : null
  if (!t?.refresh_token) return null

  const venceEm = new Date(t.expires_at ?? 0).getTime()
  if (Number.isFinite(venceEm) && venceEm - Date.now() > 60_000) return t.access_token

  const corpo = new URLSearchParams({
    client_id: s.EMAIL_MS_CLIENT_ID,
    client_secret: s.EMAIL_MS_CLIENT_SECRET,
    refresh_token: t.refresh_token,
    grant_type: 'refresh_token',
  })
  const r = await fetch(`https://login.microsoftonline.com/${s.EMAIL_MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: corpo,
  })
  if (!r.ok) return null
  const d = await r.json()

  await gravarToken(accountId, {
    access_token: d.access_token,
    refresh_token: d.refresh_token || t.refresh_token,
    expires_at: new Date(Date.now() + (d.expires_in ?? 3600) * 1000).toISOString(),
    scope: d.scope ?? t.scope,
  })
  return d.access_token
}

async function graph(token: string, urlCompleta: string) {
  const r = await fetch(urlCompleta, { headers: { Authorization: `Bearer ${token}` } })
  return { ok: r.ok, status: r.status, dados: await r.json().catch(() => ({})) }
}

/**
 * Espelha a árvore de pastas do Outlook.
 *
 * A recursão é necessária: `/me/mailFolders` devolve só o primeiro nível, e no
 * Outlook as pastas são aninhadas. O teto de profundidade evita que uma árvore
 * absurda (ou um ciclo, que não deveria existir) prenda a função.
 */
async function sincronizarPastas(
  accountId: string,
  token: string,
): Promise<{ total: number; erros: string[] }> {
  const porGraphId = new Map<string, string>()
  // Os erros SOBEM. A primeira versão fazia `return` calado quando o Graph
  // recusava, e a rota respondia `{"pastas": 0}` com status 200 — parecia que
  // tinha funcionado e não tinha. Falha silenciosa custa mais que falha feia.
  const erros: string[] = []

  const visitar = async (paiGraphId: string | null, nivel: number) => {
    if (nivel > 8) return
    const base = paiGraphId
      ? `${GRAPH}/me/mailFolders/${paiGraphId}/childFolders`
      : `${GRAPH}/me/mailFolders`
    /*
      `wellKnownName` NÃO entra no $select: a v1.0 do Graph recusa a requisição
      inteira com `Could not find a property named 'wellKnownName' on type
      microsoft.graph.mailFolder` — a propriedade só existe no beta. Quais são as
      pastas de sistema é resolvido depois, em `marcarPastasDeSistema`.
    */
    let url =
      `${base}?$top=100&$select=id,displayName,parentFolderId,totalItemCount,unreadItemCount,childFolderCount`

    while (url) {
      const { ok, status, dados } = await graph(token, url)
      if (!ok) {
        erros.push(`Graph ${status} em ${paiGraphId ?? 'raiz'}: ${JSON.stringify(dados?.error ?? dados).slice(0, 300)}`)
        return
      }
      for (const f of dados.value ?? []) {
        const paiId = paiGraphId ? porGraphId.get(paiGraphId) ?? null : null
        const r = await rest('email_folders?on_conflict=account_id,graph_id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
          body: JSON.stringify({
            account_id: accountId,
            graph_id: f.id,
            name: f.displayName,
            display_name: f.displayName,
            parent_id: paiId,
            total_count: f.totalItemCount ?? 0,
            unread_count: f.unreadItemCount ?? 0,
          }),
        })
        if (r.ok) {
          const linhas = await r.json()
          if (Array.isArray(linhas) && linhas[0]?.id) porGraphId.set(f.id, String(linhas[0].id))
        } else {
          erros.push(`Gravar "${f.displayName}": ${(await r.text()).slice(0, 300)}`)
        }
        if ((f.childFolderCount ?? 0) > 0) await visitar(f.id, nivel + 1)
      }
      url = dados['@odata.nextLink'] ?? ''
    }
  }

  await visitar(null, 0)
  await marcarPastasDeSistema(accountId, token, erros)
  return { total: porGraphId.size, erros }
}

/**
 * Descobre quais pastas são as de sistema, e marca cada uma.
 *
 * O Graph aceita o apelido no lugar do id (`/me/mailFolders/inbox`) e devolve a
 * pasta com o id real. Seis chamadas resolvem o que o `$select` não entrega —
 * e é assim que a árvore consegue pôr Caixa de Entrada em cima e as
 * personalizadas embaixo, como no Outlook.
 */
const PASTAS_DE_SISTEMA = [
  'inbox',
  'drafts',
  'sentitems',
  'deleteditems',
  'junkemail',
  'archive',
  'outbox',
] as const

async function marcarPastasDeSistema(accountId: string, token: string, erros: string[]) {
  for (const apelido of PASTAS_DE_SISTEMA) {
    const { ok, dados } = await graph(token, `${GRAPH}/me/mailFolders/${apelido}?$select=id`)
    // Nem toda caixa tem todas: `archive` e `outbox` podem não existir. Faltar
    // uma é normal e não é erro.
    if (!ok || !dados?.id) continue
    const r = await rest(
      `email_folders?account_id=eq.${encodeURIComponent(accountId)}&graph_id=eq.${encodeURIComponent(dados.id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ well_known_name: apelido, is_system: true, name: apelido }),
      },
    )
    if (!r.ok) erros.push(`Marcar ${apelido}: ${(await r.text()).slice(0, 200)}`)
  }
}

/** O que sabemos de uma pasta a partir do `parentFolderId` que o Graph manda. */
interface PastaConhecida {
  id: string
  /** `inbox`, `sentitems`, `drafts`… — nulo em pasta criada pela pessoa. */
  apelido: string | null
}

/**
 * graph_id da pasta -> nossa linha.
 *
 * O `apelido` entrou em 08/09/2026 e existe por um motivo só: descobrir se a
 * mensagem está em Itens Enviados. Antes disso a classificação comparava
 * `msg.parentFolderId === 'sentitems'` — e o Graph manda um ID OPACO ali, nunca
 * o apelido, então a comparação nunca era verdadeira. Resultado medido no banco:
 * os 39 e-mails da pasta Itens Enviados estavam todos marcados como `inbound`,
 * ou seja, o que a pessoa mandou aparecia como se tivessem mandado para ela.
 */
async function mapaDePastas(accountId: string): Promise<Map<string, PastaConhecida>> {
  const r = await rest(`email_folders?account_id=eq.${encodeURIComponent(accountId)}&select=id,graph_id,well_known_name`)
  const mapa = new Map<string, PastaConhecida>()
  if (!r.ok) return mapa
  for (const f of await r.json()) {
    if (f.graph_id) mapa.set(f.graph_id, { id: f.id, apelido: f.well_known_name ?? null })
  }
  return mapa
}

/**
 * O endereço da própria caixa, usado só para classificar entrada/saída.
 *
 * Existe porque a pasta nem sempre está no mapa: hoje 3 das 5 contas ativas têm
 * ZERO pastas sincronizadas (a rota `pastas` não tem gatilho no app nem no cron)
 * e 804 dos 1.455 e-mails estão com `folder_id` nulo. Nesses casos o apelido da
 * pasta não responde nada, e o remetente é o que sobra de confiável.
 */
async function enderecoDaConta(accountId: string): Promise<string | null> {
  const r = await rest(`email_accounts?id=eq.${encodeURIComponent(accountId)}&select=email`)
  if (!r.ok) return null
  const linhas = await r.json()
  const e = Array.isArray(linhas) ? linhas[0]?.email : null
  return typeof e === 'string' ? e.toLowerCase() : null
}

/**
 * Cola a assinatura PESSOAL de quem está enviando no fim do corpo.
 *
 * Acontece no SERVIDOR, e não no navegador, pelo mesmo motivo que a assinatura
 * do WhatsApp é aplicada dentro da RPC `send_whatsapp_message`: assim ela não
 * depende de o cliente lembrar, e ninguém consegue enviar em nome de outra
 * pessoa com a assinatura dela.
 *
 * A assinatura vem de `profiles.email_prefs`, do usuário da requisição — nunca
 * de `email_accounts.signature`, que é uma linha só compartilhada pelo setor
 * inteiro e faria todo mundo assinar igual.
 *
 * Em resposta e encaminhamento, o Graph acrescenta a citação do original DEPOIS
 * do que mandamos — então a assinatura cai no lugar certo sozinha: abaixo do
 * texto da pessoa e acima do histórico.
 *
 * Falha de leitura devolve o corpo intacto de propósito. E-mail sem assinatura
 * incomoda; e-mail que não sai por causa da assinatura é muito pior.
 */
async function comAssinatura(
  corpoHtml: string,
  userId: string | null,
): Promise<{ corpo: string; embutidas: Record<string, unknown>[] }> {
  const semAssinatura = { corpo: corpoHtml, embutidas: [] as Record<string, unknown>[] }
  if (!userId) return semAssinatura
  try {
    const r = await rest(`profiles?id=eq.${encodeURIComponent(userId)}&select=email_prefs`)
    if (!r.ok) return semAssinatura
    const linhas = await r.json()
    const prefs = (Array.isArray(linhas) ? linhas[0]?.email_prefs : null) ?? {}
    const assinatura = String(prefs.assinatura_html ?? '').trim()
    if (!assinatura) return semAssinatura

    /*
      As imagens da assinatura vão como anexo EMBUTIDO.

      O corpo guardado já referencia `cid:`, nunca `data:` — Gmail remove imagem
      `data:` e o Outlook de mesa a bloqueia. `isInline` + `contentId` é o mesmo
      caminho que o próprio Outlook usa, e é o que faz o logotipo aparecer sem o
      destinatário precisar clicar em "exibir imagens".
    */
    const imagens = Array.isArray(prefs.assinatura_imagens) ? prefs.assinatura_imagens : []
    const embutidas = imagens
      .filter((i: any) => i?.cid && i?.base64)
      .map((i: any) => ({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: String(i.nome ?? `${i.cid}.png`),
        contentType: String(i.tipo ?? 'image/png'),
        contentBytes: String(i.base64),
        isInline: true,
        contentId: String(i.cid),
      }))

    // Sem `<hr>`: a assinatura já traz a própria separação, e uma régua nossa por
    // cima aparece como risco solto no cliente de quem recebe.
    return { corpo: `${corpoHtml}<br><br>${assinatura}`, embutidas }
  } catch {
    return semAssinatura
  }
}

function ehDaPropriaCaixa(remetente: unknown, enderecoDaCaixa: string | null): boolean {
  if (!enderecoDaCaixa || typeof remetente !== 'string') return false
  return remetente.toLowerCase() === enderecoDaCaixa
}

/**
 * Teto do anexo em UMA requisição ao Graph.
 *
 * O limite real da chamada é ~4 MB de corpo, e base64 infla o binário em ~33%.
 * 3 MB de arquivo original chegam a ~4 MB codificados — por isso o teto é sobre
 * o tamanho JÁ codificado, que é o que de fato viaja. Acima disso a Microsoft
 * exige sessão de upload, que ficou fora desta entrega: melhor recusar com uma
 * frase clara do que estourar com erro cru da Microsoft.
 */
const TETO_ANEXOS_B64 = 3.5 * 1024 * 1024

function montarAnexos(
  lista: unknown[],
  /**
   * Bytes já ocupados antes de contar os anexos da pessoa — hoje, a assinatura.
   * Sem somá-los, um arquivo de 2,9 MB passaria aqui e só estouraria depois, no
   * Graph, com erro cru e sem explicação.
   */
  jaOcupado = 0,
): { lista: Record<string, unknown>[]; erro?: string } {
  const saida: Record<string, unknown>[] = []
  let total = jaOcupado
  for (const a of lista) {
    const item = a as Record<string, unknown>
    const nome = String(item?.nome ?? '').trim()
    const conteudo = String(item?.base64 ?? '')
    if (!nome || !conteudo) return { lista: [], erro: 'Anexo sem nome ou sem conteúdo.' }
    total += conteudo.length
    if (total > TETO_ANEXOS_B64) {
      return {
        lista: [],
        erro: 'Os anexos passam de 3 MB no total. Envie um arquivo menor ou mande um link.',
      }
    }
    saida.push({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: nome,
      contentType: String(item?.tipo ?? 'application/octet-stream'),
      contentBytes: conteudo,
    })
  }
  return { lista: saida }
}

function enderecos(lista: unknown): string[] {
  if (!Array.isArray(lista)) return []
  return lista
    .map((x: any) => x?.emailAddress?.address)
    .filter((e: unknown): e is string => typeof e === 'string' && e.length > 0)
}

/**
 * Grava (ou atualiza) uma mensagem.
 *
 * Vai por `on_conflict=account_id,graph_id`, apoiado no índice único criado na
 * migration `20260826140000`. O aviso em tempo real e a varredura de segurança
 * PODEM tratar a mesma mensagem ao mesmo tempo — é esperado. Com o upsert a
 * segunda passada só reescreve a linha, em vez de duplicar o e-mail na tela.
 */
async function gravarMensagem(
  accountId: string,
  msg: Record<string, any>,
  pastas: Map<string, PastaConhecida>,
  /** Endereço da própria caixa — só para decidir entrada/saída. Ver `ehDaPropriaCaixa`. */
  enderecoDaCaixa: string | null,
): Promise<{ id: string | null; novo: boolean }> {
  const pasta = msg.parentFolderId ? pastas.get(msg.parentFolderId) ?? null : null
  const folderId = pasta?.id ?? null
  const de = msg.from?.emailAddress ?? msg.sender?.emailAddress ?? {}
  const ehHtml = msg.body?.contentType === 'html'

  const linha = {
    account_id: accountId,
    folder_id: folderId,
    graph_id: msg.id,
    message_id: msg.internetMessageId ?? null,
    internet_message_id: msg.internetMessageId ?? null,
    conversation_id: msg.conversationId ?? null,
    thread_id: msg.conversationId ?? null,
    // Rascunho e enviado saem daqui; todo o resto chegou.
    //
    // A pasta é conferida pelo APELIDO da nossa linha, não pelo `parentFolderId`
    // cru: o Graph manda um ID opaco, então o `=== 'sentitems'` que existia aqui
    // nunca era verdadeiro e todo e-mail enviado entrava como recebido.
    // Quando a pasta é desconhecida (mensagem que chegou antes do mapa existir),
    // o remetente decide — é o que resta de confiável.
    direction:
      msg.isDraft || pasta?.apelido === 'sentitems' || ehDaPropriaCaixa(de.address, enderecoDaCaixa)
        ? 'outbound'
        : 'inbound',
    from_email: de.address ?? '(desconhecido)',
    from_name: de.name ?? null,
    to_emails: enderecos(msg.toRecipients),
    cc_emails: enderecos(msg.ccRecipients),
    bcc_emails: enderecos(msg.bccRecipients),
    reply_to_email: enderecos(msg.replyTo)[0] ?? null,
    subject: msg.subject ?? null,
    body_html: ehHtml ? msg.body?.content ?? null : null,
    body_text: ehHtml ? null : msg.body?.content ?? null,
    body_preview: msg.bodyPreview ?? null,
    has_attachments: Boolean(msg.hasAttachments),
    importance: msg.importance ?? null,
    is_draft: Boolean(msg.isDraft),
    is_read: Boolean(msg.isRead),
    is_starred: msg.flag?.flagStatus === 'flagged',
    web_link: msg.webLink ?? null,
    received_at: msg.receivedDateTime ?? msg.sentDateTime ?? new Date().toISOString(),
  }

  const r = await rest('emails?on_conflict=account_id,graph_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(linha),
  })
  if (!r.ok) return { id: null, novo: false }
  const linhas = await r.json()
  return { id: Array.isArray(linhas) && linhas[0]?.id ? String(linhas[0].id) : null, novo: true }
}

/**
 * Guarda a FICHA dos anexos, não o conteúdo.
 *
 * Por decisão de 26/08/2026 o binário continua na Microsoft e é buscado quando
 * alguém clica. Baixar tudo na importação encheria o disco com anexo que
 * ninguém vai abrir — e deixaria a primeira carga muito mais lenta.
 */
async function registrarAnexos(emailId: string, graphMsgId: string, token: string) {
  const { ok, dados } = await graph(
    token,
    `${GRAPH}/me/messages/${graphMsgId}/attachments?$select=id,name,contentType,size,isInline`,
  )
  if (!ok) return
  const linhas = (dados.value ?? []).map((a: any) => ({
    email_id: emailId,
    graph_attachment_id: a.id,
    name: a.name ?? 'anexo',
    mime_type: a.contentType ?? null,
    size: a.size ?? null,
    is_inline: Boolean(a.isInline),
    content_id: a.contentId ?? null,
  }))
  if (linhas.length === 0) return
  await rest('email_attachments?on_conflict=email_id,graph_attachment_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(linhas),
  })
}

async function abrirCorrida(accountId: string, origem: string): Promise<string | null> {
  const r = await rest('email_sync_runs', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, origem }),
  })
  if (!r.ok) return null
  const linhas = await r.json()
  return Array.isArray(linhas) && linhas[0]?.id ? String(linhas[0].id) : null
}

async function fecharCorrida(id: string | null, dados: Record<string, unknown>) {
  if (!id) return
  await rest(`email_sync_runs?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ finished_at: new Date().toISOString(), ...dados }),
  })
}

/**
 * Já existe uma sincronização em andamento?
 *
 * Quem responde é o RELÓGIO, não um campo de status. Os jobs de importação do
 * WhatsApp ficaram presos em `running` para sempre e bloquearam novas
 * importações — o status mentia e ninguém conseguia destravar. Aqui uma
 * execução parada há mais de 10 minutos simplesmente envelhece e sai da frente.
 */
async function jaEstaRodando(accountId: string): Promise<boolean> {
  const limite = new Date(Date.now() - 10 * 60_000).toISOString()
  const r = await rest(
    `email_sync_runs?account_id=eq.${encodeURIComponent(accountId)}&finished_at=is.null&started_at=gt.${limite}&select=id`,
  )
  if (!r.ok) return false
  const linhas = await r.json()
  return Array.isArray(linhas) && linhas.length > 0
}

/** Carga inicial: as mensagens dos últimos N dias, pasta por pasta. */
async function importarHistorico(accountId: string, token: string, dias: number) {
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString()
  const pastas = await mapaDePastas(accountId)
  const meuEndereco = await enderecoDaConta(accountId)
  let novos = 0

  for (const [graphFolderId] of pastas) {
    let url =
      `${GRAPH}/me/mailFolders/${graphFolderId}/messages` +
      `?$filter=receivedDateTime ge ${desde}&$top=50&$orderby=receivedDateTime desc` +
      `&$select=${CAMPOS_DA_MENSAGEM}`

    // Teto de páginas por pasta: 50 x 50 = 2.500 mensagens. Uma edge function
    // tem tempo limitado; sem teto, uma pasta gigante mataria a importação
    // inteira e nem as outras pastas entrariam.
    for (let pagina = 0; pagina < 50 && url; pagina++) {
      const { ok, dados } = await graph(token, url)
      if (!ok) break
      for (const msg of dados.value ?? []) {
        const { id } = await gravarMensagem(accountId, msg, pastas, meuEndereco)
        if (id) {
          novos++
          if (msg.hasAttachments) await registrarAnexos(id, msg.id, token)
        }
      }
      url = dados['@odata.nextLink'] ?? ''
    }

    // Marca o ponto de partida do incremental SEM baixar a pasta de novo.
    // `$deltaToken=latest` devolve na hora um ponteiro que significa "de agora
    // em diante"; sem ele, a primeira varredura releria tudo o que acabou de
    // ser importado.
    const { ok, dados } = await graph(
      token,
      `${GRAPH}/me/mailFolders/${graphFolderId}/messages/delta?$deltaToken=latest`,
    )
    if (ok && dados['@odata.deltaLink']) {
      await rest(
        `email_folders?account_id=eq.${encodeURIComponent(accountId)}&graph_id=eq.${encodeURIComponent(graphFolderId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            delta_link: dados['@odata.deltaLink'],
            last_sync_at: new Date().toISOString(),
          }),
        },
      )
    }
  }
  return novos
}

/** Varredura incremental: só o que mudou desde o último delta de cada pasta. */
async function varrerDelta(accountId: string, token: string) {
  const r = await rest(
    `email_folders?account_id=eq.${encodeURIComponent(accountId)}&delta_link=not.is.null&select=graph_id,delta_link`,
  )
  if (!r.ok) return 0
  const pastas = await mapaDePastas(accountId)
  const meuEndereco = await enderecoDaConta(accountId)
  let mudou = 0

  for (const f of await r.json()) {
    let url: string = f.delta_link
    let deltaNovo = ''
    for (let pagina = 0; pagina < 20 && url; pagina++) {
      const { ok, dados } = await graph(token, url)
      if (!ok) break
      for (const msg of dados.value ?? []) {
        // O Graph marca exclusão com @removed; a mensagem some da nossa base
        // junto, senão a lista mostraria e-mail que já não existe no Outlook.
        if (msg['@removed']) {
          await rest(
            `emails?account_id=eq.${encodeURIComponent(accountId)}&graph_id=eq.${encodeURIComponent(msg.id)}`,
            { method: 'DELETE' },
          )
          mudou++
          continue
        }
        const { id } = await gravarMensagem(accountId, msg, pastas, meuEndereco)
        if (id) {
          mudou++
          if (msg.hasAttachments) await registrarAnexos(id, msg.id, token)
        }
      }
      deltaNovo = dados['@odata.deltaLink'] ?? ''
      url = dados['@odata.nextLink'] ?? ''
    }
    if (deltaNovo) {
      await rest(
        `email_folders?account_id=eq.${encodeURIComponent(accountId)}&graph_id=eq.${encodeURIComponent(f.graph_id)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ delta_link: deltaNovo, last_sync_at: new Date().toISOString() }),
        },
      )
    }
  }
  return mudou
}

// ——— Entrada ———

/**
 * O endereço PÚBLICO desta função — o único que a Microsoft aceita.
 *
 * `new URL(req.url).origin` NÃO serve no self-hosted: o Kong repassa para o
 * container interno e `req.url` chega como `http://functions:9000/...`, que a
 * Microsoft recusa com `AADSTS50011`. Quem sabe o endereço de verdade é o
 * `x-forwarded-host`.
 *
 * O `x-forwarded-proto` é ignorado DE PROPÓSITO: chega como `http` porque o TLS
 * termina no Traefik, uma camada antes do Kong. Confiar nele produziria
 * `http://apps-supabase…`, trocando um AADSTS50011 por outro.
 *
 * Descoberto na `agenda-microsoft`; repetido aqui porque a causa é a mesma.
 */
function origemPublica(req: Request, url: URL): string {
  const host = req.headers.get('x-forwarded-host') || url.host
  const local = host.startsWith('localhost') || host.startsWith('127.0.0.1')
  return `${local ? 'http' : 'https'}://${host}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const url = new URL(req.url)
  const rota = url.pathname.split('/').filter(Boolean).pop() || ''
  const redirectUri = `${origemPublica(req, url)}/functions/v1/email-microsoft/callback`
  const s = await lerSegredos()

  // O callback vem do navegador da pessoa, SEM o cabeçalho de autorização do
  // app — quem diz de quem é o retorno é o `state` assinado.
  if (rota === 'callback') {
    if (!estaConfigurado(s)) {
      return pagina('Microsoft não configurada', 'Faltam as chaves do aplicativo. Avise quem administra o sistema.')
    }

    const erroDaMicrosoft = url.searchParams.get('error_description') || url.searchParams.get('error')
    if (erroDaMicrosoft) return pagina('Não deu para conectar', erroDaMicrosoft)

    const codigo = url.searchParams.get('code') || ''
    const pedido = await lerState(url.searchParams.get('state') || '', s.EMAIL_MS_STATE_SECRET || '')
    if (!codigo || !pedido) {
      return pagina('Link inválido ou expirado', 'Volte ao app e clique em conectar de novo.')
    }

    const { ok, dados } = await trocarCodigoPorToken(codigo, s, redirectUri)
    if (!ok || !dados.access_token) {
      return pagina('Não deu para conectar', String(dados?.error_description ?? 'A Microsoft recusou a troca.'))
    }

    // Qual caixa entrou de verdade. Diferente da Agenda, aqui isso NÃO é
    // enfeite: sem o endereço não dá para gravar a conta, e é o que permite a
    // conferência logo abaixo.
    let contaEmail: string | null = null
    try {
      const eu = await fetch(`${GRAPH}/me`, { headers: { Authorization: `Bearer ${dados.access_token}` } })
      if (eu.ok) {
        const perfil = await eu.json()
        contaEmail = perfil.mail || perfil.userPrincipalName || null
      }
    } catch { /* tratado abaixo */ }

    if (!contaEmail) {
      return pagina(
        'Não deu para identificar a caixa',
        'A conta entrou, mas a Microsoft não informou o endereço de e-mail. Ela pode não ter licença de e-mail no 365.',
      )
    }

    /*
      A conferência que impede o erro mais caro deste fluxo.

      Conectar caixa de setor exige entrar COM A SENHA DA CAIXA. Quem já está
      logado com a própria conta clica em "Entrar" no automático e conecta a si
      mesmo — e aí o setor inteiro passa a ver o e-mail pessoal daquela pessoa.
      O `prompt=select_account` na URL de consentimento reduz o tropeço; esta
      conferência é o que o impede de virar vazamento.
    */
    if (pedido.e && pedido.e.toLowerCase() !== contaEmail.toLowerCase()) {
      return pagina(
        'Caixa errada — nada foi conectado',
        `Você pediu para conectar ${pedido.e}, mas entrou como ${contaEmail}. ` +
          `Volte ao app, clique em conectar de novo e escolha "Usar outra conta" na tela da Microsoft.`,
      )
    }

    const accountId = await salvarConta(pedido, contaEmail)
    if (!accountId) {
      return pagina('Não deu para salvar', 'A conexão com a Microsoft funcionou, mas o cadastro da caixa falhou. Tente de novo.')
    }

    await gravarToken(accountId, {
      access_token: dados.access_token,
      refresh_token: dados.refresh_token ?? '',
      expires_at: new Date(Date.now() + (dados.expires_in ?? 3600) * 1000).toISOString(),
      scope: dados.scope ?? ESCOPOS,
    })

    return pagina(
      'Caixa conectada',
      `${contaEmail} está conectada. Pode fechar esta aba e voltar para o PRN Hub.`,
    )
  }

  /*
    O aviso da Microsoft. Vem da internet, sem sessão nenhuma — por isso fica
    ANTES da checagem de login, junto do callback.

    Duas exigências que não perdoam:

    1. VALIDAÇÃO. Ao criar a inscrição, a Microsoft chama esta URL com
       `?validationToken=…` e espera o token DE VOLTA, em texto puro, em até 10
       segundos. Qualquer JSON, qualquer status diferente de 200, e a inscrição
       nem chega a ser criada — sem mensagem de erro útil.

    2. `clientState`. É o segredo que nós definimos ao assinar e que volta em
       cada aviso. Conferir é o que impede qualquer um na internet mandar um
       POST forjado nesta URL e fazer a função buscar mensagens à toa.
  */
  if (rota === 'avisar') {
    const validacao = url.searchParams.get('validationToken')
    if (validacao) {
      return new Response(validacao, {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }

    const corpo = (await req.json().catch(() => ({}))) as Record<string, any>
    const avisos: any[] = Array.isArray(corpo.value) ? corpo.value : []
    const esperado = s.EMAIL_MS_WEBHOOK_SECRET || ''

    // Sem segredo configurado ninguém entra: melhor perder um aviso do que
    // aceitar qualquer POST anônimo.
    if (!esperado) return new Response('', { status: 202 })

    const legitimos = avisos.filter((a) => a?.clientState === esperado)
    if (legitimos.length === 0) return new Response('', { status: 202 })

    // Um aviso não traz o e-mail, só o id. É preciso buscar cada um.
    const porInscricao = new Map<string, string[]>()
    for (const a of legitimos) {
      const idMsg = a?.resourceData?.id
      if (!a?.subscriptionId || !idMsg) continue
      porInscricao.set(a.subscriptionId, [...(porInscricao.get(a.subscriptionId) ?? []), idMsg])
    }

    for (const [subId, ids] of porInscricao) {
      const r = await rest(
        `email_subscriptions?subscription_id=eq.${encodeURIComponent(subId)}&select=account_id`,
      )
      if (!r.ok) continue
      const linhas = await r.json()
      const accountId = Array.isArray(linhas) && linhas[0]?.account_id ? String(linhas[0].account_id) : null
      if (!accountId) continue

      const token = await tokenValido(accountId, s)
      if (!token) continue

      const pastas = await mapaDePastas(accountId)
  const meuEndereco = await enderecoDaConta(accountId)
      const corrida = await abrirCorrida(accountId, 'aviso')
      let novos = 0
      for (const idMsg of ids.slice(0, 50)) {
        const { ok, dados } = await graph(
          token,
          `${GRAPH}/me/messages/${idMsg}?$select=${CAMPOS_DA_MENSAGEM}`,
        )
        if (!ok) continue
        const { id } = await gravarMensagem(accountId, dados, pastas, meuEndereco)
        if (id) {
          novos++
          if (dados.hasAttachments) await registrarAnexos(id, dados.id, token)
        }
      }
      await fecharCorrida(corrida, { novos })
      await rest(`email_subscriptions?account_id=eq.${encodeURIComponent(accountId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ last_notified_at: new Date().toISOString() }),
      })
    }

    return new Response('', { status: 202 })
  }

  /*
    O `pg_cron` chama esta função sozinho, e não tem token de pessoa nenhuma —
    `/auth/v1/user` recusaria. Ele se identifica por um segredo PRÓPRIO,
    `EMAIL_MS_CRON_SECRET`, e não pela chave de serviço.

    A diferença importa: a chave de serviço abre o banco inteiro, e ela teria de
    ficar guardada dentro de uma função do Postgres para o cron alcançar. Este
    segredo só serve para pedir "sincroniza" e "renova" — se vazar, o estrago é
    alguém disparar uma sincronização.
  */
  const cabecalho = req.headers.get('Authorization') || ''
  const segredoCron = s.EMAIL_MS_CRON_SECRET || ''
  const ehServico =
    segredoCron.length > 0 && req.headers.get('x-cron-secret') === segredoCron

  // Todo o resto exige sessão do app.
  const userId = ehServico ? null : await usuarioDaRequisicao(cabecalho)
  if (!userId && !ehServico) return json({ error: 'Sessão não encontrada' }, 401)

  // A chave de serviço serve para o agendador, e só para isso. Deixá-la abrir
  // as rotas da tela seria dar a ela poder de conectar e desconectar caixa.
  // `pastas` e `importar` entram para a primeira carga poder ser disparada de
  // dentro do banco (`select private.email_chamar_funcao('importar')`), sem
  // ninguém precisar manusear segredo nem esperar a tela existir.
  const ROTAS_DO_AGENDADOR = new Set(['sincronizar', 'renovar', 'pastas', 'importar', 'assinar'])
  if (ehServico && !ROTAS_DO_AGENDADOR.has(rota)) {
    return json({ error: 'Rota indisponível para o agendador' }, 403)
  }
  const usuario = userId as string

  if (rota === 'status') {
    return json({ configurado: estaConfigurado(s), admin: await ehAdmin(usuario) })
  }

  /*
    Grava as três chaves do aplicativo. NUNCA devolve valor — nem para conferir.
    A tela mostra "configurada ✓" a partir do `status`, não do conteúdo.
  */
  if (rota === 'configurar') {
    if (!(await ehAdmin(usuario))) return json({ error: 'Só um administrador pode configurar' }, 403)

    const corpo = await req.json().catch(() => ({})) as Record<string, string>
    const client_id = String(corpo.client_id ?? '').trim()
    const tenant_id = String(corpo.tenant_id ?? '').trim()
    const client_secret = String(corpo.client_secret ?? '').trim()

    if (!client_id || !tenant_id || !client_secret) {
      return json({ error: 'Preencha os três campos.' }, 400)
    }
    // Os dois primeiros são GUIDs. Conferir o formato aqui evita o erro mais
    // comum do cadastro: colar o "ID do Segredo" no lugar do "Valor", ou trocar
    // a ordem dos campos — que só apareceria depois, como AADSTS700016.
    const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!guid.test(client_id)) return json({ error: 'O ID do aplicativo não parece um identificador válido.' }, 400)
    if (!guid.test(tenant_id)) return json({ error: 'O ID do diretório não parece um identificador válido.' }, 400)
    if (guid.test(client_secret)) {
      return json({ error: 'Isso parece o ID do Segredo, não o Valor. Copie a coluna "Valor" no portal.' }, 400)
    }

    const resp = await fetch(`${SUPABASE_URL}/rest/v1/secrets?on_conflict=key`, {
      method: 'POST',
      headers: { ...serviceHeaders, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify([
        { key: 'EMAIL_MS_CLIENT_ID', value: client_id, updated_at: new Date().toISOString() },
        { key: 'EMAIL_MS_TENANT_ID', value: tenant_id, updated_at: new Date().toISOString() },
        { key: 'EMAIL_MS_CLIENT_SECRET', value: client_secret, updated_at: new Date().toISOString() },
      ]),
    })
    if (!resp.ok) return json({ error: 'Não deu para guardar as chaves.' }, 500)
    return json({ configurado: true })
  }

  if (rota === 'authorize') {
    if (!estaConfigurado(s)) return json({ error: 'Microsoft ainda não configurada' }, 503)

    const corpo = await req.json().catch(() => ({})) as Record<string, unknown>
    const tipo = corpo.tipo === 'setor' ? 'setor' : 'pessoal'
    const label = String(corpo.label ?? '').trim()
    const department = corpo.department ? String(corpo.department).trim() : null
    const expected = corpo.expected_email ? String(corpo.expected_email).trim().toLowerCase() : null

    if (tipo === 'setor') {
      // Vale a mesma regra da RLS: caixa de setor é do admin.
      if (!(await ehAdmin(usuario))) return json({ error: 'Só um administrador conecta caixa de setor' }, 403)
      if (!department) return json({ error: 'Escolha o setor da caixa.' }, 400)
      if (!expected) return json({ error: 'Informe o endereço da caixa que vai ser conectada.' }, 400)
    }

    const pedido: Pedido = {
      u: usuario,
      t: tipo,
      l: label || (tipo === 'setor' ? department! : 'Minha conta'),
      d: tipo === 'setor' ? department : null,
      e: expected,
    }

    const consentimento =
      `https://login.microsoftonline.com/${s.EMAIL_MS_TENANT_ID}/oauth2/v2.0/authorize` +
      `?client_id=${encodeURIComponent(s.EMAIL_MS_CLIENT_ID)}` +
      `&response_type=code&response_mode=query` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent(ESCOPOS)}` +
      // Força o seletor de contas. Sem isso a Microsoft entra direto com quem já
      // estiver logado no navegador, e a caixa de setor conectaria a pessoa
      // errada sem ninguém perceber.
      `&prompt=select_account` +
      (expected ? `&login_hint=${encodeURIComponent(expected)}` : '') +
      `&state=${encodeURIComponent(await montarState(pedido, s.EMAIL_MS_STATE_SECRET || ''))}`

    return json({ url: consentimento })
  }

  if (rota === 'desconectar') {
    const corpo = await req.json().catch(() => ({})) as Record<string, string>
    const accountId = String(corpo.account_id ?? '').trim()
    if (!accountId) return json({ error: 'Falta dizer qual caixa.' }, 400)

    const conta = await contaPorId(accountId)
    if (!conta) return json({ error: 'Caixa não encontrada.' }, 404)

    // Esta função usa service_role, que ignora RLS — então a regra de quem pode
    // desconectar precisa valer AQUI, e é a mesma da policy de escrita:
    // caixa de setor só admin; conta pessoal só o dono.
    const podeApagar = conta.department === null
      ? conta.user_id === usuario || (await ehAdmin(usuario))
      : await ehAdmin(usuario)
    if (!podeApagar) return json({ error: 'Você não pode desconectar esta caixa.' }, 403)

    // O token some junto por `on delete cascade` em email_account_tokens.
    await fetch(`${SUPABASE_URL}/rest/v1/email_accounts?id=eq.${encodeURIComponent(accountId)}`, {
      method: 'DELETE',
      headers: serviceHeaders,
    })
    return json({ ok: true })
  }

  // ——— Rotas de sincronização ———

  /**
   * Mesma regra do banco (`_pode_ver_conta_de_email`), repetida aqui porque esta
   * função fala com o Postgres como service_role — que ignora RLS. Sem esta
   * conferência, qualquer pessoa logada pediria a sincronização da caixa alheia.
   */
  const podeVerConta = async (accountId: string): Promise<boolean> => {
    const r = await rest(
      `email_accounts?id=eq.${encodeURIComponent(accountId)}&select=user_id,department`,
    )
    if (!r.ok) return false
    const linhas = await r.json()
    const c = Array.isArray(linhas) ? linhas[0] : null
    if (!c) return false
    if (c.user_id === usuario) return true
    if (await ehAdmin(usuario)) return true
    if (c.department) {
      const s2 = await rest(
        `user_sectors?user_id=eq.${encodeURIComponent(usuario)}&setor=eq.${encodeURIComponent(c.department)}&select=setor`,
      )
      if (s2.ok && (await s2.json()).length > 0) return true
    }
    const p = await rest(
      `user_allowed_email_accounts?user_id=eq.${encodeURIComponent(usuario)}&account_id=eq.${encodeURIComponent(accountId)}&select=id`,
    )
    return p.ok && (await p.json()).length > 0
  }

  const corpoJson = async () => (await req.json().catch(() => ({}))) as Record<string, any>

  if (rota === 'pastas' || rota === 'importar') {
    const c = await corpoJson()
    const pedida = c.account_id ? String(c.account_id) : null

    // Sem caixa nomeada: o agendador trata todas as ativas; uma pessoa trata as
    // dela. Nomeando, precisa ter acesso àquela.
    let alvos: string[]
    if (pedida) {
      if (!ehServico && !(await podeVerConta(pedida))) return json({ error: 'Sem acesso a esta caixa.' }, 403)
      alvos = [pedida]
    } else {
      const filtro = ehServico ? 'is_active=eq.true' : `user_id=eq.${encodeURIComponent(usuario)}`
      const r = await rest(`email_accounts?${filtro}&select=id`)
      alvos = r.ok ? (await r.json()).map((x: any) => String(x.id)) : []
    }
    if (alvos.length === 0) return json({ error: 'Nenhuma caixa para sincronizar.' }, 404)

    const resultado: Record<string, unknown> = {}
    for (const accountId of alvos) {
      if (await jaEstaRodando(accountId)) {
        resultado[accountId] = 'já estava rodando'
        continue
      }
      const token = await tokenValido(accountId, s)
      if (!token) {
        resultado[accountId] = 'conexão expirada — reconectar a caixa'
        continue
      }

      const corrida = await abrirCorrida(accountId, rota === 'pastas' ? 'manual' : 'inicial')
      try {
        const { total: pastas, erros } = await sincronizarPastas(accountId, token)
        if (rota === 'pastas') {
          await fecharCorrida(corrida, { erro: erros[0] ?? null })
          resultado[accountId] = { pastas, erros }
          continue
        }
        // 90 dias: decisão de 26/08/2026. Enche a tela com coisa útil em minutos
        // e deixa aumentar depois sem refazer nada.
        const novos = await importarHistorico(accountId, token, Number(c.dias ?? 90))
        await fecharCorrida(corrida, { novos, erro: erros[0] ?? null })
        resultado[accountId] = { pastas, novos, erros }
      } catch (e) {
        await fecharCorrida(corrida, { erro: String(e) })
        resultado[accountId] = { erro: String(e) }
      }
    }
    return json({ contas: resultado })
  }

  /**
   * A varredura de segurança embaixo do tempo real.
   *
   * O aviso da Microsoft é o caminho normal, mas ele para em silêncio se a
   * inscrição vencer sem renovar. Esta rota roda a cada 15 min pelo pg_cron e
   * pega o que escapou. Usa delta, então quando não há novidade custa quase nada.
   */
  if (rota === 'sincronizar') {
    const c = await corpoJson()
    const alvo = c.account_id ? String(c.account_id) : null

    if (alvo && !ehServico && !(await podeVerConta(alvo))) {
      return json({ error: 'Sem acesso a esta caixa.' }, 403)
    }

    const filtro = alvo
      ? `id=eq.${encodeURIComponent(alvo)}`
      : ehServico
        ? 'is_active=eq.true'
        : `user_id=eq.${encodeURIComponent(usuario)}`
    const r = await rest(`email_accounts?${filtro}&select=id`)
    if (!r.ok) return json({ error: 'Não deu para listar as caixas.' }, 500)

    const resultado: Record<string, number> = {}
    for (const conta of await r.json()) {
      if (await jaEstaRodando(conta.id)) continue
      const token = await tokenValido(conta.id, s)
      if (!token) continue
      const corrida = await abrirCorrida(conta.id, 'varredura')
      try {
        resultado[conta.id] = await varrerDelta(conta.id, token)
        await fecharCorrida(corrida, { atualizados: resultado[conta.id] })
      } catch (e) {
        await fecharCorrida(corrida, { erro: String(e) })
      }
    }
    return json({ contas: resultado })
  }

  /**
   * Entrega o anexo. O binário vem da Microsoft na hora e NÃO passa pelo banco.
   *
   * É o outro lado da decisão de não guardar anexo: nada ocupa disco, e o
   * conteúdo é sempre o que está no Outlook agora.
   */
  /**
   * ENVIAR — email novo, resposta, resposta a todos e encaminhamento.
   *
   * Nasceu em 08/09/2026 para substituir a edge function `email-send`, que
   * **nunca enviou um e-mail**: ela usa SMTP e recusa com 400 quando a conta não
   * tem `smtp_host` (`email-send/index.ts:123`) — e NENHUMA das contas tem, porque
   * o fluxo OAuth não preenche esse campo e não existe tela para isso. Ela ainda
   * lê `imap_password_enc` e `oauth_access_token`, colunas apagadas do banco na
   * migration `20260826124852`. Medição que fechou o diagnóstico: os 104 e-mails
   * de saída no banco têm todos `graph_id`, ou seja, vieram do Graph; nenhum saiu
   * do app.
   *
   * Mora AQUI, e não numa função nova, porque é aqui que já vivem as duas coisas
   * que a `email-send` não tinha: a renovação de token (`tokenValido`) e a
   * checagem de acesso à caixa (`podeVerConta`). A `email-send` decodificava o
   * JWT SEM VERIFICAR e nunca conferia acesso — só não vazou porque falhava antes.
   *
   * POR QUE `reply`/`replyAll`/`forward` EM VEZ DE MONTAR TUDO NA MÃO: o Graph
   * costura a conversa sozinho (`In-Reply-To`/`References`/`conversationId`), o
   * `replyAll` acerta os destinatários incluindo Cc, e o `forward` **leva os
   * anexos do original**. Fazer isso à mão seria reimplementar RFC 5322 para
   * chegar num resultado pior.
   *
   * NÃO gravamos cópia local do enviado. `saveToSentItems` põe a mensagem em
   * Itens Enviados e ela volta pelo aviso em tempo real com o `graph_id` de
   * verdade; inserir aqui também produziria a mesma mensagem duas vezes na lista,
   * porque o upsert casa por `(account_id, graph_id)` e nós não temos o id no
   * momento do envio — o Graph responde 202 sem corpo.
   */
  if (rota === 'enviar') {
    const c = await corpoJson()
    const accountId = String(c.account_id ?? '').trim()
    if (!accountId) return json({ error: 'Falta dizer de qual caixa.' }, 400)
    if (!(await podeVerConta(accountId))) {
      return json({ error: 'Você não tem acesso a esta caixa.' }, 403)
    }

    const token = await tokenValido(accountId, s)
    if (!token) return json({ error: 'Conexão expirada — reconecte a caixa.' }, 401)

    const modo = String(c.modo ?? 'novo') as 'novo' | 'responder' | 'responder_todos' | 'encaminhar'
    const { corpo: corpoHtml, embutidas } = await comAssinatura(String(c.body_html ?? ''), usuario)
    const destinatarios = (Array.isArray(c.to) ? c.to : []).map(String).filter(Boolean)
    const copia = (Array.isArray(c.cc) ? c.cc : []).map(String).filter(Boolean)
    const copiaOculta = (Array.isArray(c.bcc) ? c.bcc : []).map(String).filter(Boolean)

    const pesoDaAssinatura = embutidas.reduce(
      (t, a) => t + String(a.contentBytes ?? '').length,
      0,
    )
    const anexos = montarAnexos(Array.isArray(c.anexos) ? c.anexos : [], pesoDaAssinatura)
    if (anexos.erro) return json({ error: anexos.erro }, 400)
    // As imagens da assinatura entram na MESMA lista dos anexos da pessoa: para o
    // Graph é tudo `attachments`; o que as separa é o `isInline`.
    const todosOsAnexos = [...anexos.lista, ...embutidas]

    // Nas três ações sobre um e-mail existente, o Graph precisa do `graph_id`
    // dele — que é nosso ponteiro para a mensagem na Microsoft.
    let graphIdOriginal: string | null = null
    if (modo !== 'novo') {
      const idOriginal = String(c.reply_to_email_id ?? '').trim()
      if (!idOriginal) return json({ error: 'Falta dizer a qual e-mail responder.' }, 400)
      const r = await rest(`emails?id=eq.${encodeURIComponent(idOriginal)}&select=graph_id,account_id`)
      const orig = r.ok ? (await r.json())[0] : null
      if (!orig?.graph_id) return json({ error: 'E-mail original não encontrado na Microsoft.' }, 404)
      if (orig.account_id !== accountId) {
        return json({ error: 'O e-mail original é de outra caixa.' }, 400)
      }
      graphIdOriginal = String(orig.graph_id)
    }

    const paraGraph = (e: string) => ({ emailAddress: { address: e } })
    const mensagem: Record<string, unknown> = {
      body: { contentType: 'HTML', content: corpoHtml },
      ...(destinatarios.length ? { toRecipients: destinatarios.map(paraGraph) } : {}),
      ...(copia.length ? { ccRecipients: copia.map(paraGraph) } : {}),
      ...(copiaOculta.length ? { bccRecipients: copiaOculta.map(paraGraph) } : {}),
      ...(todosOsAnexos.length ? { attachments: todosOsAnexos } : {}),
    }

    /**
     * Marca o original como respondido — estado NOSSO, que não existe no Graph e
     * por isso não corre risco de eco. Falhar aqui não desfaz o envio, que já
     * aconteceu; daí o erro ser engolido de propósito.
     */
    const marcarRespondido = async () => {
      if (!graphIdOriginal || modo === 'encaminhar') return
      const idOriginal = String(c.reply_to_email_id ?? '')
      await rest(`email_states?email_id=eq.${encodeURIComponent(idOriginal)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'replied',
          responded_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      }).catch(() => {})
    }

    const post = (u: string, corpo: unknown) =>
      fetch(u, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
      })
    const recusa = async (r: Response) =>
      json(
        {
          error: 'A Microsoft recusou o envio.',
          detalhe: (await r.text().catch(() => '')).slice(0, 300),
          status: r.status,
        },
        502,
      )

    /*
      ANEXO EM RESPOSTA/ENCAMINHAMENTO VAI PELO CAMINHO DO RASCUNHO.

      A chamada de uma tacada só (`/reply`, `/replyAll`, `/forward`) aceita um
      objeto `message`, mas o campo `attachments` dentro dele é tratado de forma
      inconsistente — em parte das contas o e-mail sai SEM o arquivo, e sem erro
      nenhum. Enviar em silêncio um "segue o documento" sem o documento é o pior
      defeito possível numa ferramenta de e-mail.

      Com `createReply`/`createReplyAll`/`createForward` ganhamos o id do
      rascunho, penduramos os anexos um a um e só então mandamos. São três idas
      em vez de uma, e por isso só pagamos esse preço quando há anexo.

      ATENÇÃO AO CUSTO, que mudou em 08/09/2026: a assinatura gerada traz
      imagens embutidas (o painel da marca e os ícones), e elas contam como
      anexo. Ou seja, quem tem assinatura com imagem faz estas três idas em TODA
      resposta, não só quando manda arquivo. É o preço de a imagem chegar
      inteira — e é o mesmo caminho que o Outlook percorre.
    */
    if (modo !== 'novo' && todosOsAnexos.length > 0) {
      const criar = modo === 'encaminhar'
        ? 'createForward'
        : modo === 'responder_todos'
          ? 'createReplyAll'
          : 'createReply'
      const { toRecipients: _semDestino, attachments: _semAnexos, ...corpoSemAnexo } = mensagem
      const rascunho = await post(`${GRAPH}/me/messages/${graphIdOriginal}/${criar}`, {
        message: modo === 'responder_todos' ? corpoSemAnexo : { ...corpoSemAnexo, ...(destinatarios.length ? { toRecipients: destinatarios.map(paraGraph) } : {}) },
      })
      if (!rascunho.ok) return await recusa(rascunho)
      const draftId = String(((await rascunho.json()) as Record<string, unknown>).id ?? '')
      if (!draftId) return json({ error: 'A Microsoft não devolveu o rascunho.' }, 502)

      for (const anexo of todosOsAnexos) {
        const r = await post(`${GRAPH}/me/messages/${draftId}/attachments`, anexo)
        if (!r.ok) return await recusa(r)
      }
      const enviado = await post(`${GRAPH}/me/messages/${draftId}/send`, {})
      if (!enviado.ok) return await recusa(enviado)
      await marcarRespondido()
      return json({ ok: true })
    }

    let alvo: string
    let carga: Record<string, unknown>
    if (modo === 'novo') {
      if (!destinatarios.length) return json({ error: 'Sem destinatário.' }, 400)
      const assunto = String(c.subject ?? '').trim()
      if (!assunto) return json({ error: 'Sem assunto.' }, 400)
      alvo = `${GRAPH}/me/sendMail`
      carga = { message: { ...mensagem, subject: assunto }, saveToSentItems: true }
    } else if (modo === 'encaminhar') {
      if (!destinatarios.length) return json({ error: 'Sem destinatário.' }, 400)
      alvo = `${GRAPH}/me/messages/${graphIdOriginal}/forward`
      carga = { message: mensagem, comment: '' }
    } else {
      // `reply` e `replyAll`: o Graph resolve destinatário e assunto. Mandar
      // `toRecipients` no `replyAll` seria discordar dele — deixamos a mensagem
      // com o corpo e os anexos, e nada mais.
      alvo = `${GRAPH}/me/messages/${graphIdOriginal}/${modo === 'responder_todos' ? 'replyAll' : 'reply'}`
      const { toRecipients: _ignorado, ...semDestinatarios } = mensagem
      carga = { message: modo === 'responder_todos' ? semDestinatarios : mensagem, comment: '' }
    }

    const envio = await post(alvo, carga)
    if (!envio.ok) return await recusa(envio)

    await marcarRespondido()
    return json({ ok: true })
  }

  /**
   * MARCAR — lido/não lido e estrela, com efeito NA MICROSOFT.
   *
   * Antes disto `markEmailRead` só fazia `UPDATE emails` local, e a varredura
   * delta seguinte sobrescrevia com o valor do Outlook (`gravarMensagem` grava
   * `is_read: Boolean(msg.isRead)`). Na prática: a pessoa lia trinta e-mails e a
   * caixa voltava a dizer trinta não lidos. O contador da pasta nem chegava a
   * baixar — ele vem de `email_folders.unread_count`, que é o número do Outlook.
   *
   * O `PATCH` no Graph resolve os dois de uma vez: a marcação sobrevive ao delta
   * porque vira a verdade lá também, e o contador da pasta acompanha.
   */
  if (rota === 'marcar') {
    const c = await corpoJson()
    const emailId = String(c.email_id ?? '').trim()
    if (!emailId) return json({ error: 'Falta dizer qual e-mail.' }, 400)

    const r = await rest(`emails?id=eq.${encodeURIComponent(emailId)}&select=graph_id,account_id`)
    const alvo = r.ok ? (await r.json())[0] : null
    if (!alvo) return json({ error: 'E-mail não encontrado.' }, 404)
    if (!(await podeVerConta(alvo.account_id))) return json({ error: 'Sem acesso.' }, 403)

    const mudanca: Record<string, unknown> = {}
    if (typeof c.is_read === 'boolean') mudanca.isRead = c.is_read
    if (typeof c.is_starred === 'boolean') {
      mudanca.flag = { flagStatus: c.is_starred ? 'flagged' : 'notFlagged' }
    }
    if (Object.keys(mudanca).length === 0) return json({ error: 'Nada para mudar.' }, 400)

    // Sem `graph_id` a mensagem não existe na Microsoft (só pode ser uma linha
    // antiga): grava só aqui em vez de recusar, que é o que a pessoa espera.
    if (alvo.graph_id) {
      const token = await tokenValido(alvo.account_id, s)
      if (!token) return json({ error: 'Conexão expirada — reconecte a caixa.' }, 401)
      const p = await fetch(`${GRAPH}/me/messages/${alvo.graph_id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(mudanca),
      })
      if (!p.ok) {
        const detalhe = (await p.text().catch(() => '')).slice(0, 200)
        return json({ error: 'A Microsoft recusou a marcação.', detalhe }, 502)
      }
    }

    const local: Record<string, unknown> = {}
    if (typeof c.is_read === 'boolean') local.is_read = c.is_read
    if (typeof c.is_starred === 'boolean') local.is_starred = c.is_starred
    await rest(`emails?id=eq.${encodeURIComponent(emailId)}`, {
      method: 'PATCH',
      body: JSON.stringify(local),
    })

    return json({ ok: true })
  }

  if (rota === 'anexo') {
    const anexoId = url.searchParams.get('id') || ''
    if (!anexoId) return json({ error: 'Falta o anexo.' }, 400)

    const r = await rest(
      `email_attachments?id=eq.${encodeURIComponent(anexoId)}&select=graph_attachment_id,name,mime_type,email_id,emails(account_id,graph_id)`,
    )
    if (!r.ok) return json({ error: 'Anexo não encontrado.' }, 404)
    const a = (await r.json())[0]
    if (!a?.emails) return json({ error: 'Anexo não encontrado.' }, 404)
    if (!(await podeVerConta(a.emails.account_id))) return json({ error: 'Sem acesso.' }, 403)

    const token = await tokenValido(a.emails.account_id, s)
    if (!token) return json({ error: 'Conexão expirada.' }, 401)

    const bin = await fetch(
      `${GRAPH}/me/messages/${a.emails.graph_id}/attachments/${a.graph_attachment_id}/$value`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (!bin.ok) return json({ error: 'A Microsoft não devolveu o anexo.' }, 502)

    return new Response(bin.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': a.mime_type || 'application/octet-stream',
        // `attachment` e não `inline`: anexo de e-mail é conteúdo de terceiro e
        // não deve ser renderizado dentro do nosso domínio.
        'Content-Disposition': `attachment; filename="${encodeURIComponent(a.name)}"`,
      },
    })
  }

  /** Cria ou renova o aviso em tempo real da Microsoft. */
  if (rota === 'assinar' || rota === 'renovar') {
    const segredoAviso = s.EMAIL_MS_WEBHOOK_SECRET
    if (!segredoAviso) return json({ error: 'Falta EMAIL_MS_WEBHOOK_SECRET no cofre.' }, 503)

    const notificationUrl = `${origemPublica(req, url)}/functions/v1/email-microsoft/avisar`
    // Máximo da Microsoft para mensagens é 4230 min (~2,9 dias). Pedimos um
    // pouco menos para não esbarrar no limite e ter a renovação recusada.
    const validade = new Date(Date.now() + 4000 * 60_000).toISOString()

    const alvos = rota === 'assinar'
      ? [String((await corpoJson()).account_id ?? '')].filter(Boolean)
      : await (async () => {
          // Renova o que vence nas próximas 24h. Com um dia de antecedência uma
          // falha temporária ainda tem várias tentativas antes de a caixa congelar.
          const limite = new Date(Date.now() + 24 * 3600_000).toISOString()
          const r = await rest(`email_subscriptions?expires_at=lt.${limite}&select=account_id`)
          const vencendo = r.ok ? (await r.json()).map((x: any) => String(x.account_id)) : []

          // E cria para quem ainda não tem NENHUMA. Sem isto, uma caixa
          // conectada depois ficaria para sempre sem tempo real e ninguém
          // notaria — a varredura de 15 min disfarçaria o problema.
          const todas = await rest('email_accounts?is_active=eq.true&select=id')
          const comInscricao = await rest('email_subscriptions?select=account_id')
          const jaTem = new Set(
            comInscricao.ok ? (await comInscricao.json()).map((x: any) => String(x.account_id)) : [],
          )
          const semInscricao = todas.ok
            ? (await todas.json()).map((x: any) => String(x.id)).filter((id: string) => !jaTem.has(id))
            : []

          return [...new Set([...vencendo, ...semInscricao])]
        })()

    const feitos: Record<string, string> = {}
    for (const accountId of alvos) {
      if (!ehServico && !(await podeVerConta(accountId))) {
        feitos[accountId] = 'sem acesso'
        continue
      }
      const token = await tokenValido(accountId, s)
      if (!token) {
        feitos[accountId] = 'conexão expirada'
        continue
      }

      const atual = await rest(
        `email_subscriptions?account_id=eq.${encodeURIComponent(accountId)}&select=subscription_id`,
      )
      const existente = atual.ok ? (await atual.json())[0] : null

      let resp: Response
      if (existente?.subscription_id) {
        resp = await fetch(`${GRAPH}/subscriptions/${existente.subscription_id}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ expirationDateTime: validade }),
        })
      } else {
        resp = await fetch(`${GRAPH}/subscriptions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            changeType: 'created,updated,deleted',
            notificationUrl,
            resource: '/me/messages',
            expirationDateTime: validade,
            clientState: segredoAviso,
          }),
        })
      }

      const d = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        feitos[accountId] = String(d?.error?.message ?? `Graph ${resp.status}`)
        continue
      }

      await rest('email_subscriptions?on_conflict=account_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({
          account_id: accountId,
          subscription_id: d.id ?? existente?.subscription_id,
          resource: '/me/messages',
          client_state: segredoAviso,
          expires_at: d.expirationDateTime ?? validade,
          updated_at: new Date().toISOString(),
        }),
      })
      feitos[accountId] = 'ok'
    }
    return json({ inscricoes: feitos })
  }

  return json({ error: 'Rota desconhecida' }, 404)
})
