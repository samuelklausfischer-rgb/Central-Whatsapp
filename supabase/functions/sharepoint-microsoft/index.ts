import "jsr:@supabase/functions-js/edge-runtime.d.ts"

/**
 * Pasta de documentos do médico no SharePoint, via Microsoft Graph — usada
 * pelo Gestão Médica.
 *
 * DIFERENTE de `agenda-microsoft` e `email-microsoft`: aqui não existe conexão
 * por pessoa. É UMA biblioteca só (a de médicos), conectada UMA vez por um
 * super admin, e usada em modo leitura por todo mundo que `_pode_usar()` o
 * Gestão Médica — mesmo espírito de caixa de e-mail "de setor", mas sem
 * precisar de várias linhas porque só existe uma biblioteca. É por isso que
 * `public.sharepoint_conexao` é singleton (`id=1`), não uma linha por
 * `user_id`.
 *
 * App registration PRÓPRIA no Azure, não a de e-mail/agenda: um segredo
 * comprometido aqui não deve também carregar `Mail.ReadWrite`/
 * `Calendars.ReadWrite`. Escopos: `Sites.Read.All Files.Read.All
 * offline_access User.Read`.
 *
 * Rotas, no fim do caminho (`.../sharepoint-microsoft/<rota>`):
 *   status         — configurado? conectado? (qualquer um que _pode_usar())
 *   configurar     — super admin grava as três chaves do Entra ID
 *   authorize      — super admin: URL de consentimento
 *   callback       — retorno do consentimento (navegador vem parar aqui)
 *   desconectar    — super admin: apaga a conexão
 *   resolver-site  — super admin: descobre site_id/drive_id a partir da URL do site
 *   buscar         — busca pastas por nome no drive configurado
 *   listar         — lista os itens dentro de uma pasta (item_id)
 *   vincular       — liga um médico a uma pasta (grava em gestao_medica.medico_sharepoint_pastas)
 *   desvincular    — desfaz o vínculo
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
const ESCOPOS = 'offline_access User.Read Sites.Read.All Files.Read.All'

/**
 * Mesma convenção de `evolution-webhook` e `ai-message-assist`: no self-hosted a
 * function é servida por VOLUME, e conferir o arquivo em disco não prova que o
 * isolate do Deno recarregou. Só a resposta prova. Vai também na 401 — que não
 * exige sessão — para dar como conferir a publicação sem credencial nenhuma.
 */
const BUILD_MARKER = 'sharepoint-inicial-2026-09-04'

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
  const chaves = [
    'SHAREPOINT_MS_CLIENT_ID',
    'SHAREPOINT_MS_TENANT_ID',
    'SHAREPOINT_MS_CLIENT_SECRET',
    'SHAREPOINT_MS_STATE_SECRET',
  ]
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
  return Boolean(s.SHAREPOINT_MS_CLIENT_ID && s.SHAREPOINT_MS_TENANT_ID && s.SHAREPOINT_MS_CLIENT_SECRET)
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
 * Mesma regra de `gestao_medica._pode_usar()`, replicada aqui porque essa
 * função do banco depende de `auth.uid()` — que não existe quando é esta
 * function (fora do Postgres) quem pergunta pelo usuário de outra pessoa.
 */
async function podeUsarGestaoMedica(userId: string): Promise<boolean> {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=is_super_admin,department`,
    { headers: serviceHeaders },
  )
  if (!resp.ok) return false
  const linhas = await resp.json()
  const p = Array.isArray(linhas) ? linhas[0] : null
  return Boolean(p && (p.is_super_admin === true || p.department === 'Administrativo'))
}

/** Conectar/desconectar/configurar a biblioteca é ação de super admin, não de todo mundo que _pode_usar(). */
async function ehSuperAdmin(userId: string): Promise<boolean> {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=is_super_admin`,
    { headers: serviceHeaders },
  )
  if (!resp.ok) return false
  const linhas = await resp.json()
  return Array.isArray(linhas) && linhas[0]?.is_super_admin === true
}

// ——— O `state`, assinado ———

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

// ——— A conexão (singleton) ———

interface Conexao {
  access_token: string
  refresh_token: string
  expires_at: string
  conta_email: string | null
  site_id: string | null
  drive_id: string | null
  site_nome: string | null
}

async function lerConexao(): Promise<Conexao | null> {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/sharepoint_conexao?id=eq.1&select=*`, {
    headers: serviceHeaders,
  })
  if (!resp.ok) return null
  const linhas = await resp.json()
  return Array.isArray(linhas) && linhas[0] ? (linhas[0] as Conexao) : null
}

async function gravarConexao(dados: Record<string, unknown>) {
  await fetch(`${SUPABASE_URL}/rest/v1/sharepoint_conexao?on_conflict=id`, {
    method: 'POST',
    headers: { ...serviceHeaders, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ id: 1, ...dados, updated_at: new Date().toISOString() }),
  })
}

async function trocarCodigoPorToken(codigo: string, s: Record<string, string>, redirectUri: string) {
  const corpo = new URLSearchParams({
    client_id: s.SHAREPOINT_MS_CLIENT_ID,
    client_secret: s.SHAREPOINT_MS_CLIENT_SECRET,
    code: codigo,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  })
  const resp = await fetch(`https://login.microsoftonline.com/${s.SHAREPOINT_MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: corpo,
  })
  return { ok: resp.ok, dados: await resp.json() }
}

/** Renova com 60s de folga — mesma regra de agenda-microsoft/email-microsoft. */
async function tokenValido(conexao: Conexao, s: Record<string, string>): Promise<string | null> {
  const venceEm = new Date(conexao.expires_at).getTime()
  if (Number.isFinite(venceEm) && venceEm - Date.now() > 60_000) return conexao.access_token

  const corpo = new URLSearchParams({
    client_id: s.SHAREPOINT_MS_CLIENT_ID,
    client_secret: s.SHAREPOINT_MS_CLIENT_SECRET,
    refresh_token: conexao.refresh_token,
    grant_type: 'refresh_token',
  })
  const resp = await fetch(`https://login.microsoftonline.com/${s.SHAREPOINT_MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: corpo,
  })
  if (!resp.ok) return null
  const dados = await resp.json()

  await gravarConexao({
    access_token: dados.access_token,
    refresh_token: dados.refresh_token || conexao.refresh_token,
    expires_at: new Date(Date.now() + (dados.expires_in ?? 3600) * 1000).toISOString(),
  })
  return dados.access_token
}

// ——— Site e Drive ———

/** Aceita `empresa.sharepoint.com/sites/Medicos` com ou sem protocolo/URL completa. */
function separarSiteUrl(entrada: string): { hostname: string; caminho: string } | null {
  const limpo = entrada.trim().replace(/^https?:\/\//, '')
  const barra = limpo.indexOf('/')
  if (barra === -1) return null
  const hostname = limpo.slice(0, barra)
  const caminho = limpo.slice(barra)
  if (!hostname || !caminho) return null
  return { hostname, caminho }
}

async function graph(token: string, url: string, init: RequestInit = {}) {
  const resp = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  })
  const dados = await resp.json().catch(() => ({}))
  return { ok: resp.ok, status: resp.status, dados }
}

// ——— Entrada ———

/** Ver `agenda-microsoft`/`email-microsoft`: `x-forwarded-host`, e não `req.url`, no self-hosted atrás do Kong. */
function origemPublica(req: Request, url: URL): string {
  const host = req.headers.get('x-forwarded-host') || url.host
  const local = host.startsWith('localhost') || host.startsWith('127.0.0.1')
  return `${local ? 'http' : 'https'}://${host}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const url = new URL(req.url)
  const rota = url.pathname.split('/').filter(Boolean).pop() || ''
  const redirectUri = `${origemPublica(req, url)}/functions/v1/sharepoint-microsoft/callback`
  const s = await lerSegredos()

  // O callback vem do navegador, sem cabeçalho de autorização do app — quem
  // diz de quem é o retorno é o `state` assinado.
  if (rota === 'callback') {
    if (!estaConfigurado(s)) return pagina('SharePoint não configurado', 'Faltam as chaves do aplicativo no servidor.')

    const erroDaMicrosoft = url.searchParams.get('error_description') || url.searchParams.get('error')
    if (erroDaMicrosoft) return pagina('Não deu para conectar', erroDaMicrosoft)

    const codigo = url.searchParams.get('code') || ''
    const state = url.searchParams.get('state') || ''
    const userId = await lerState(state, s.SHAREPOINT_MS_STATE_SECRET || '')
    if (!codigo || !userId) {
      return pagina('Link inválido ou expirado', 'Volte às Configurações do Gestão Médica e clique em Conectar de novo.')
    }

    const { ok, dados } = await trocarCodigoPorToken(codigo, s, redirectUri)
    if (!ok || !dados.access_token) {
      return pagina('Não deu para conectar', String(dados?.error_description ?? 'A Microsoft recusou a troca.'))
    }

    let contaEmail: string | null = null
    try {
      const eu = await fetch(`${GRAPH}/me`, { headers: { Authorization: `Bearer ${dados.access_token}` } })
      if (eu.ok) {
        const perfil = await eu.json()
        contaEmail = perfil.mail || perfil.userPrincipalName || null
      }
    } catch { /* ignora */ }

    await gravarConexao({
      access_token: dados.access_token,
      refresh_token: dados.refresh_token ?? '',
      expires_at: new Date(Date.now() + (dados.expires_in ?? 3600) * 1000).toISOString(),
      conta_email: contaEmail,
    })

    return pagina(
      'Conta Microsoft conectada',
      'Agora configure a biblioteca do SharePoint nas Configurações do Gestão Médica, informando a URL do site.',
    )
  }

  // Todo o resto exige sessão do app.
  const userId = await usuarioDaRequisicao(req.headers.get('Authorization') || '')
  if (!userId) return json({ error: 'Sessão não encontrada', marker: BUILD_MARKER }, 401)

  if (rota === 'status') {
    if (!(await podeUsarGestaoMedica(userId))) return json({ error: 'Sem acesso ao Gestão Médica' }, 403)
    if (!estaConfigurado(s)) {
      return json({
        configurado: false,
        conectado: false,
        super_admin: await ehSuperAdmin(userId),
        marker: BUILD_MARKER,
      })
    }
    const conexao = await lerConexao()
    return json({
      configurado: true,
      conectado: Boolean(conexao?.access_token),
      conta_email: conexao?.conta_email ?? null,
      site_nome: conexao?.site_nome ?? null,
      site_pronto: Boolean(conexao?.drive_id),
      super_admin: await ehSuperAdmin(userId),
      marker: BUILD_MARKER,
    })
  }

  if (rota === 'configurar') {
    if (!(await ehSuperAdmin(userId))) return json({ error: 'Só um administrador pode configurar' }, 403)

    const corpo = (await req.json().catch(() => ({}))) as Record<string, string>
    const client_id = String(corpo.client_id ?? '').trim()
    const tenant_id = String(corpo.tenant_id ?? '').trim()
    const client_secret = String(corpo.client_secret ?? '').trim()

    if (!client_id || !tenant_id || !client_secret) return json({ error: 'Preencha os três campos.' }, 400)

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
        { key: 'SHAREPOINT_MS_CLIENT_ID', value: client_id, updated_at: new Date().toISOString() },
        { key: 'SHAREPOINT_MS_TENANT_ID', value: tenant_id, updated_at: new Date().toISOString() },
        { key: 'SHAREPOINT_MS_CLIENT_SECRET', value: client_secret, updated_at: new Date().toISOString() },
      ]),
    })
    if (!resp.ok) return json({ error: 'Não deu para guardar as chaves.' }, 500)
    return json({ configurado: true })
  }

  if (rota === 'authorize') {
    if (!(await ehSuperAdmin(userId))) return json({ error: 'Só um administrador conecta a biblioteca' }, 403)
    if (!estaConfigurado(s)) return json({ error: 'SharePoint ainda não configurado no servidor' }, 503)

    const state = await montarState(userId, s.SHAREPOINT_MS_STATE_SECRET || '')
    const consentimento =
      `https://login.microsoftonline.com/${s.SHAREPOINT_MS_TENANT_ID}/oauth2/v2.0/authorize` +
      `?client_id=${encodeURIComponent(s.SHAREPOINT_MS_CLIENT_ID)}` +
      `&response_type=code&response_mode=query&prompt=select_account` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent(ESCOPOS)}` +
      `&state=${encodeURIComponent(state)}`
    return json({ url: consentimento })
  }

  if (rota === 'desconectar') {
    if (!(await ehSuperAdmin(userId))) return json({ error: 'Só um administrador desconecta a biblioteca' }, 403)
    await fetch(`${SUPABASE_URL}/rest/v1/sharepoint_conexao?id=eq.1`, {
      method: 'PATCH',
      headers: serviceHeaders,
      body: JSON.stringify({
        access_token: null,
        refresh_token: null,
        expires_at: null,
        conta_email: null,
        site_id: null,
        drive_id: null,
        site_nome: null,
      }),
    })
    return json({ ok: true })
  }

  // Rotas abaixo precisam de conexão válida.
  if (['resolver-site', 'buscar', 'listar', 'vincular', 'desvincular'].includes(rota)) {
    const podeUsar = await podeUsarGestaoMedica(userId)
    if (!podeUsar) return json({ error: 'Sem acesso ao Gestão Médica' }, 403)

    const conexao = await lerConexao()
    if (!conexao?.refresh_token) return json({ error: 'SharePoint não conectado', conectado: false }, 409)

    const token = await tokenValido(conexao, s)
    if (!token) return json({ error: 'A conexão com o SharePoint expirou. Um admin precisa reconectar.', conectado: false }, 409)

    if (rota === 'resolver-site') {
      if (!(await ehSuperAdmin(userId))) return json({ error: 'Só um administrador configura o site' }, 403)
      const corpo = await req.json().catch(() => ({})) as Record<string, string>
      const partes = separarSiteUrl(String(corpo.site_url ?? ''))
      if (!partes) return json({ error: 'Informe a URL do site, ex: empresa.sharepoint.com/sites/Medicos' }, 400)

      const site = await graph(token, `${GRAPH}/sites/${partes.hostname}:${partes.caminho}`)
      if (!site.ok) return json({ error: String(site.dados?.error?.message ?? `Graph respondeu ${site.status}`) }, 502)

      const drive = await graph(token, `${GRAPH}/sites/${site.dados.id}/drive`)
      if (!drive.ok) return json({ error: String(drive.dados?.error?.message ?? `Graph respondeu ${drive.status}`) }, 502)

      await gravarConexao({
        site_id: String(site.dados.id),
        drive_id: String(drive.dados.id),
        site_nome: String(site.dados.displayName ?? site.dados.name ?? partes.caminho),
      })

      return json({ ok: true, site_nome: site.dados.displayName ?? site.dados.name })
    }

    if (!conexao.drive_id) return json({ error: 'Configure o site do SharePoint primeiro' }, 409)

    if (rota === 'buscar') {
      const corpoBusca = await req.json().catch(() => ({})) as Record<string, string>
      const q = String(corpoBusca.q ?? '')
      if (!q.trim()) return json({ error: 'Informe um termo de busca' }, 400)

      const busca = await graph(
        token,
        `${GRAPH}/drives/${conexao.drive_id}/root/search(q='${encodeURIComponent(q.trim())}')?$top=25`,
      )
      if (!busca.ok) return json({ error: String(busca.dados?.error?.message ?? `Graph respondeu ${busca.status}`) }, 502)

      const pastas = (busca.dados.value ?? [])
        .filter((item: any) => item.folder)
        .map((item: any) => ({
          item_id: String(item.id),
          nome: String(item.name),
          caminho: String(item.parentReference?.path ?? ''),
          web_url: String(item.webUrl ?? ''),
        }))
      return json({ pastas })
    }

    if (rota === 'listar') {
      const corpoListar = await req.json().catch(() => ({})) as Record<string, string>
      const itemId = String(corpoListar.item_id ?? '')
      if (!itemId) return json({ error: 'Informe item_id' }, 400)

      const filhos = await graph(token, `${GRAPH}/drives/${conexao.drive_id}/items/${encodeURIComponent(itemId)}/children?$top=200`)
      if (!filhos.ok) return json({ error: String(filhos.dados?.error?.message ?? `Graph respondeu ${filhos.status}`) }, 502)

      const itens = (filhos.dados.value ?? []).map((item: any) => ({
        item_id: String(item.id),
        nome: String(item.name),
        pasta: Boolean(item.folder),
        tamanho_bytes: item.size ?? null,
        download_url: item['@microsoft.graph.downloadUrl'] ?? null,
        web_url: item.webUrl ?? null,
      }))
      return json({ itens })
    }

    if (rota === 'vincular') {
      const corpo = await req.json().catch(() => ({})) as Record<string, string>
      const medicoId = String(corpo.medico_id ?? '')
      const itemId = String(corpo.item_id ?? '')
      const nomePasta = String(corpo.nome_pasta ?? '')
      const webUrl = corpo.web_url ? String(corpo.web_url) : null
      const caminho = corpo.caminho ? String(corpo.caminho) : null
      if (!medicoId || !itemId || !nomePasta) return json({ error: 'Informe medico_id, item_id e nome_pasta' }, 400)

      // Confere que a pasta existe de verdade no drive antes de vincular —
      // evita gravar um item_id copiado errado sem nenhum aviso.
      const item = await graph(token, `${GRAPH}/drives/${conexao.drive_id}/items/${encodeURIComponent(itemId)}`)
      if (!item.ok) return json({ error: 'Pasta não encontrada no SharePoint. Busque de novo.' }, 404)

      const resp = await fetch(`${SUPABASE_URL}/rest/v1/medico_sharepoint_pastas?on_conflict=medico_id`, {
        method: 'POST',
        headers: { ...serviceHeaders, 'Content-Profile': 'gestao_medica', Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({
          medico_id: medicoId,
          item_id: itemId,
          nome_pasta: nomePasta,
          caminho,
          web_url: webUrl,
          vinculado_por: userId,
          updated_at: new Date().toISOString(),
        }),
      })
      if (!resp.ok) return json({ error: 'Não foi possível salvar o vínculo.' }, 500)
      return json({ ok: true })
    }

    if (rota === 'desvincular') {
      const corpo = await req.json().catch(() => ({})) as Record<string, string>
      const medicoId = String(corpo.medico_id ?? '')
      if (!medicoId) return json({ error: 'Informe medico_id' }, 400)

      await fetch(
        `${SUPABASE_URL}/rest/v1/medico_sharepoint_pastas?medico_id=eq.${encodeURIComponent(medicoId)}`,
        { method: 'DELETE', headers: { ...serviceHeaders, 'Content-Profile': 'gestao_medica' } },
      )
      return json({ ok: true })
    }
  }

  return json({ error: 'Rota desconhecida' }, 404)
})
