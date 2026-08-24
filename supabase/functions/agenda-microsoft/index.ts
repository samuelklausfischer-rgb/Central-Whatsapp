import "jsr:@supabase/functions-js/edge-runtime.d.ts"

/**
 * Agenda pessoal conectada ao Outlook (Microsoft 365), via Microsoft Graph.
 *
 * TUDO passa por aqui de propósito: o `refresh_token` dá acesso à agenda da
 * pessoa por tempo indeterminado, e não pode existir no navegador. A migration
 * `20260824190000` garante isso no banco (grant por coluna), e esta função é o
 * único lugar que lê aquelas colunas.
 *
 * As rotas ficam no fim do caminho: `.../agenda-microsoft/<rota>`.
 *   status       — a tela pergunta se já está conectado
 *   authorize    — devolve a URL de consentimento da Microsoft
 *   callback     — retorno do consentimento (o navegador vem parar AQUI)
 *   eventos      — compromissos de um período
 *   criar        — cria compromisso no Outlook
 *   desconectar  — apaga a conexão
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
 * O fuso do app. A Microsoft devolve tudo em UTC se ninguém pedir outra coisa —
 * e aí um compromisso das 14:00 apareceria às 17:00 aqui.
 */
const FUSO = 'America/Sao_Paulo'

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/** Página simples para o retorno do consentimento, que roda fora do app. */
function pagina(titulo: string, mensagem: string) {
  return new Response(
    `<!doctype html><html lang="pt-BR"><meta charset="utf-8">
     <meta name="viewport" content="width=device-width,initial-scale=1">
     <title>${titulo}</title>
     <body style="font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#0b1220;color:#e6edf7">
       <div style="max-width:26rem;text-align:center;padding:2rem">
         <h1 style="font-size:1.1rem;font-weight:600">${titulo}</h1>
         <p style="color:#93a4bd;line-height:1.6">${mensagem}</p>
       </div>
     </body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

// ——— Segredos e configuração ———

async function lerSegredos(): Promise<Record<string, string>> {
  const chaves = ['AGENDA_MS_CLIENT_ID', 'AGENDA_MS_TENANT_ID', 'AGENDA_MS_CLIENT_SECRET', 'AGENDA_MS_STATE_SECRET']
  const lista = chaves.map((k) => `"${k}"`).join(',')
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/secrets?key=in.(${encodeURIComponent(lista)})&select=key,value`,
    { headers: serviceHeaders },
  )
  if (!resp.ok) return {}
  const linhas = (await resp.json()) as { key: string; value: string }[]
  return Object.fromEntries(linhas.map((l) => [l.key, l.value]))
}

function estaConfigurado(s: Record<string, string>) {
  return Boolean(s.AGENDA_MS_CLIENT_ID && s.AGENDA_MS_TENANT_ID && s.AGENDA_MS_CLIENT_SECRET)
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

// ——— O `state`, assinado ———

/**
 * O `state` volta da Microsoft junto com o código. Se ele fosse só o id do
 * usuário em texto puro, bastaria alguém trocar esse id para amarrar a PRÓPRIA
 * conta do Outlook ao usuário de outra pessoa aqui dentro — e passar a ver a
 * agenda dela. Assinando, um state adulterado é recusado.
 *
 * Validade curta pelo mesmo motivo de qualquer token de uso único: um link de
 * consentimento esquecido aberto não deve valer para sempre.
 */
const VALIDADE_DO_STATE_MS = 10 * 60 * 1000

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

async function montarState(userId: string, segredo: string): Promise<string> {
  const corpo = `${userId}.${Date.now()}`
  return `${corpo}.${await assinar(corpo, segredo)}`
}

async function lerState(state: string, segredo: string): Promise<string | null> {
  const partes = state.split('.')
  if (partes.length !== 3) return null
  const [userId, emitidoEm, assinatura] = partes
  const corpo = `${userId}.${emitidoEm}`
  if ((await assinar(corpo, segredo)) !== assinatura) return null
  if (Date.now() - Number(emitidoEm) > VALIDADE_DO_STATE_MS) return null
  return userId
}

// ——— Tokens ———

interface Conexao {
  user_id: string
  access_token: string
  refresh_token: string
  expires_at: string
  conta_email: string | null
}

async function lerConexao(userId: string): Promise<Conexao | null> {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/agenda_conexoes?user_id=eq.${encodeURIComponent(userId)}&select=*`,
    { headers: serviceHeaders },
  )
  if (!resp.ok) return null
  const linhas = await resp.json()
  return Array.isArray(linhas) && linhas[0] ? (linhas[0] as Conexao) : null
}

async function gravarConexao(userId: string, dados: Record<string, unknown>) {
  await fetch(`${SUPABASE_URL}/rest/v1/agenda_conexoes?on_conflict=user_id`, {
    method: 'POST',
    headers: { ...serviceHeaders, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ user_id: userId, ...dados, updated_at: new Date().toISOString() }),
  })
}

async function trocarCodigoPorToken(codigo: string, s: Record<string, string>, redirectUri: string) {
  const corpo = new URLSearchParams({
    client_id: s.AGENDA_MS_CLIENT_ID,
    client_secret: s.AGENDA_MS_CLIENT_SECRET,
    code: codigo,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  })
  const resp = await fetch(`https://login.microsoftonline.com/${s.AGENDA_MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: corpo,
  })
  return { ok: resp.ok, dados: await resp.json() }
}

/**
 * Devolve um access token válido, renovando se preciso.
 *
 * Renova com 60s de folga: um token que vence "daqui a 3 segundos" passaria na
 * checagem e venceria no meio da chamada ao Graph.
 */
async function tokenValido(conexao: Conexao, s: Record<string, string>): Promise<string | null> {
  const venceEm = new Date(conexao.expires_at).getTime()
  if (Number.isFinite(venceEm) && venceEm - Date.now() > 60_000) return conexao.access_token

  const corpo = new URLSearchParams({
    client_id: s.AGENDA_MS_CLIENT_ID,
    client_secret: s.AGENDA_MS_CLIENT_SECRET,
    refresh_token: conexao.refresh_token,
    grant_type: 'refresh_token',
  })
  const resp = await fetch(`https://login.microsoftonline.com/${s.AGENDA_MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: corpo,
  })
  if (!resp.ok) return null
  const dados = await resp.json()

  await gravarConexao(conexao.user_id, {
    access_token: dados.access_token,
    // A Microsoft PODE rotacionar o refresh token. Guardar o novo quando vier,
    // senão a conexão morre sozinha na próxima renovação.
    refresh_token: dados.refresh_token || conexao.refresh_token,
    expires_at: new Date(Date.now() + (dados.expires_in ?? 3600) * 1000).toISOString(),
  })
  return dados.access_token
}

// ——— Compromissos ———

interface EventoNormalizado {
  id: string
  titulo: string
  descricao: string | null
  starts_at: string
  ends_at: string
  dia_inteiro: boolean
  link: string | null
  origem: 'outlook'
}

function normalizar(ev: Record<string, any>): EventoNormalizado {
  return {
    id: String(ev.id ?? ''),
    titulo: String(ev.subject ?? '(sem título)'),
    descricao: ev.bodyPreview ? String(ev.bodyPreview) : null,
    starts_at: String(ev.start?.dateTime ?? ''),
    ends_at: String(ev.end?.dateTime ?? ''),
    dia_inteiro: Boolean(ev.isAllDay),
    link: ev.webLink ? String(ev.webLink) : null,
    origem: 'outlook',
  }
}

/**
 * `calendarView` (e não `/events`) porque ele devolve as OCORRÊNCIAS de um
 * compromisso que se repete, já expandidas no período. Com `/events` viria só a
 * regra da repetição e teríamos de expandir na mão — que é justamente o
 * trabalho que a V1 da nossa agenda decidiu não fazer.
 */
async function buscarEventos(token: string, inicioIso: string, fimIso: string) {
  const eventos: EventoNormalizado[] = []
  let url =
    `${GRAPH}/me/calendar/calendarView` +
    `?startDateTime=${encodeURIComponent(inicioIso)}&endDateTime=${encodeURIComponent(fimIso)}` +
    `&$top=200&$orderby=start/dateTime`

  // Segue a paginação, com teto: um período muito largo numa agenda cheia não
  // pode virar laço infinito dentro da function.
  for (let pagina = 0; pagina < 10 && url; pagina++) {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Prefer: `outlook.timezone="${FUSO}"` },
    })
    if (!resp.ok) {
      return { erro: `Graph respondeu ${resp.status}`, eventos }
    }
    const dados = await resp.json()
    for (const ev of dados.value ?? []) eventos.push(normalizar(ev))
    url = dados['@odata.nextLink'] ?? ''
  }
  return { erro: null, eventos }
}

// ——— Entrada ———

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const url = new URL(req.url)
  const rota = url.pathname.split('/').filter(Boolean).pop() || ''
  const redirectUri = `${url.origin}/functions/v1/agenda-microsoft/callback`
  const s = await lerSegredos()

  // O callback vem do navegador da pessoa, SEM o cabeçalho de autorização do
  // app — quem diz de quem é o retorno é o `state` assinado.
  if (rota === 'callback') {
    if (!estaConfigurado(s)) return pagina('Outlook não configurado', 'Faltam as chaves do aplicativo no servidor.')

    const erroDaMicrosoft = url.searchParams.get('error_description') || url.searchParams.get('error')
    if (erroDaMicrosoft) return pagina('Não deu para conectar', erroDaMicrosoft)

    const codigo = url.searchParams.get('code') || ''
    const state = url.searchParams.get('state') || ''
    const userId = await lerState(state, s.AGENDA_MS_STATE_SECRET || '')
    if (!codigo || !userId) {
      return pagina('Link inválido ou expirado', 'Volte ao app e clique em Conectar Outlook de novo.')
    }

    const { ok, dados } = await trocarCodigoPorToken(codigo, s, redirectUri)
    if (!ok || !dados.access_token) {
      return pagina('Não deu para conectar', String(dados?.error_description ?? 'A Microsoft recusou a troca.'))
    }

    // O e-mail é só para a tela poder dizer "conectado como…". Falhar aqui não
    // invalida a conexão, que já está feita.
    let contaEmail: string | null = null
    try {
      const eu = await fetch(`${GRAPH}/me`, { headers: { Authorization: `Bearer ${dados.access_token}` } })
      if (eu.ok) {
        const perfil = await eu.json()
        contaEmail = perfil.mail || perfil.userPrincipalName || null
      }
    } catch { /* ignora */ }

    await gravarConexao(userId, {
      provider: 'microsoft',
      access_token: dados.access_token,
      refresh_token: dados.refresh_token ?? '',
      expires_at: new Date(Date.now() + (dados.expires_in ?? 3600) * 1000).toISOString(),
      conta_email: contaEmail,
    })

    return pagina('Outlook conectado', 'Pode fechar esta aba e voltar para o PRN Hub.')
  }

  // Todo o resto exige sessão do app.
  const userId = await usuarioDaRequisicao(req.headers.get('Authorization') || '')
  if (!userId) return json({ error: 'Sessão não encontrada' }, 401)

  if (rota === 'status') {
    if (!estaConfigurado(s)) return json({ configurado: false, conectado: false })
    const conexao = await lerConexao(userId)
    return json({ configurado: true, conectado: Boolean(conexao), conta_email: conexao?.conta_email ?? null })
  }

  if (rota === 'authorize') {
    if (!estaConfigurado(s)) return json({ error: 'Outlook ainda não configurado no servidor' }, 503)
    const state = await montarState(userId, s.AGENDA_MS_STATE_SECRET || '')
    const consentimento =
      `https://login.microsoftonline.com/${s.AGENDA_MS_TENANT_ID}/oauth2/v2.0/authorize` +
      `?client_id=${encodeURIComponent(s.AGENDA_MS_CLIENT_ID)}` +
      `&response_type=code&response_mode=query` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent('offline_access User.Read Calendars.ReadWrite')}` +
      `&state=${encodeURIComponent(state)}`
    return json({ url: consentimento })
  }

  if (rota === 'desconectar') {
    await fetch(`${SUPABASE_URL}/rest/v1/agenda_conexoes?user_id=eq.${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      headers: serviceHeaders,
    })
    return json({ ok: true })
  }

  const conexao = await lerConexao(userId)
  if (!conexao) return json({ error: 'Outlook não conectado', conectado: false }, 409)

  const token = await tokenValido(conexao, s)
  if (!token) {
    // Renovação recusada quase sempre significa consentimento revogado. Apagar
    // a linha faz a tela voltar a oferecer "Conectar", em vez de insistir num
    // erro que a pessoa não tem como resolver.
    await fetch(`${SUPABASE_URL}/rest/v1/agenda_conexoes?user_id=eq.${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      headers: serviceHeaders,
    })
    return json({ error: 'A conexão com o Outlook expirou. Conecte de novo.', conectado: false }, 409)
  }

  if (rota === 'eventos') {
    const corpo = await req.json().catch(() => ({}))
    if (!corpo.inicio || !corpo.fim) return json({ error: 'Informe inicio e fim' }, 400)
    const { erro, eventos } = await buscarEventos(token, String(corpo.inicio), String(corpo.fim))
    if (erro) return json({ error: erro }, 502)
    return json({ eventos })
  }

  if (rota === 'criar') {
    const c = await req.json().catch(() => ({}))
    if (!c.titulo || !c.inicio || !c.fim) return json({ error: 'Informe titulo, inicio e fim' }, 400)

    const resp = await fetch(`${GRAPH}/me/events`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: String(c.titulo),
        body: { contentType: 'text', content: String(c.descricao ?? '') },
        start: { dateTime: String(c.inicio), timeZone: FUSO },
        end: { dateTime: String(c.fim), timeZone: FUSO },
        isAllDay: Boolean(c.dia_inteiro),
      }),
    })
    const dados = await resp.json().catch(() => ({}))
    if (!resp.ok) return json({ error: String(dados?.error?.message ?? `Graph respondeu ${resp.status}`) }, 502)
    return json({ ok: true, id: dados.id })
  }

  return json({ error: 'Rota desconhecida' }, 404)
})
