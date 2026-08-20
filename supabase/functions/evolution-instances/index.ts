import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const serviceHeaders = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  apikey: SUPABASE_SERVICE_KEY,
}

/**
 * Eventos que TODA instância precisa assinar na Evolution.
 *
 * Esta lista tem que andar junto com `WEBHOOK_EVENTS` de `sync-instances`.
 * Elas viviam separadas e divergiram: `sync-instances` passou a assinar
 * `CONNECTION_UPDATE` e estas duas aqui continuaram só com as de mensagem —
 * então instância criada pela tela, ou webhook reconfigurado por este arquivo,
 * nunca reportava conexão, e `devices.status` voltava a ficar preso em
 * `'connecting'`. Era o bug do dashboard ("3 de 5 conectados") renascendo a
 * cada aparelho novo.
 *
 * `MESSAGES_UPSERT`/`MESSAGES_UPDATE` são a ingestão de mensagem, ou seja, a
 * função principal do app: nunca remover.
 */
const WEBHOOK_EVENTS = ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE']

type JsonRecord = Record<string, unknown>

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function requireAdmin(authHeader: string) {
  if (!authHeader) return { error: json({ error: 'Authorization header required' }, 401) }

  const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: SUPABASE_SERVICE_KEY },
  })

  if (!userResp.ok) return { error: json({ error: 'Invalid session' }, 401) }

  const authUser = await userResp.json()
  const profileResp = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(authUser.id)}&select=is_admin`,
    { headers: serviceHeaders },
  )

  if (!profileResp.ok) return { error: json({ error: 'Unable to validate admin profile' }, 500) }

  const profiles = await profileResp.json()
  if (!Array.isArray(profiles) || !profiles[0]?.is_admin) {
    return { error: json({ error: 'Admin privileges required' }, 403) }
  }

  return { user: authUser }
}

/**
 * Porta de acesso do `group_participants`.
 *
 * As demais ações desta função são de administração de instância e exigem
 * `is_admin`. Ver os membros de um grupo é operação de ATENDIMENTO — qualquer
 * atendente que já tem acesso àquele aparelho precisa poder. Por isso valida a
 * sessão e o acesso ao aparelho, não o papel de admin.
 */
async function requireDeviceAccess(authHeader: string, deviceId: string) {
  if (!authHeader) return { error: json({ error: 'Authorization header required' }, 401) }
  if (!deviceId) return { error: json({ error: 'deviceId is required' }, 400) }

  const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: SUPABASE_SERVICE_KEY },
  })
  if (!userResp.ok) return { error: json({ error: 'Invalid session' }, 401) }
  const authUser = await userResp.json()

  const profileResp = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(authUser.id)}&select=is_admin,is_super_admin,devices_restricted`,
    { headers: serviceHeaders },
  )
  if (!profileResp.ok) return { error: json({ error: 'Unable to validate profile' }, 500) }
  const perfis = await profileResp.json()
  const perfil = Array.isArray(perfis) ? perfis[0] : null
  if (!perfil) return { error: json({ error: 'Profile not found' }, 403) }

  // Mesma regra de `can_access_device`: admin sem restrição enxerga tudo; os
  // demais precisam do aparelho liberado explicitamente.
  const temTodos = perfil.is_super_admin || (perfil.is_admin && !perfil.devices_restricted)
  if (!temTodos) {
    const liberadoResp = await fetch(
      `${SUPABASE_URL}/rest/v1/user_allowed_devices?user_id=eq.${encodeURIComponent(authUser.id)}&device_id=eq.${encodeURIComponent(deviceId)}&select=device_id`,
      { headers: serviceHeaders },
    )
    const liberados = liberadoResp.ok ? await liberadoResp.json() : []
    if (!Array.isArray(liberados) || liberados.length === 0) {
      return { error: json({ error: 'Device not allowed for this user' }, 403) }
    }
  }

  return { user: authUser }
}

/**
 * Participantes de um grupo, direto da Evolution.
 *
 * `findGroupInfos` traz, por participante, EXATAMENTE três campos:
 * `{ id: "...@lid", phoneNumber: "...@s.whatsapp.net", admin: "admin"|"superadmin"|null }`.
 * **Não existe campo de nome** — quem resolve o nome é o app, cruzando o telefone
 * com a tabela `contacts`.
 *
 * ~18% dos grupos respondem 404 ("Error fetching group") porque a instância saiu
 * ou foi removida do grupo. Devolvemos `indisponivel: true` em vez de erro, para
 * o app cair no que já sabe (quem falou no grupo) sem tratar isso como falha.
 */
async function groupParticipantsAction(body: JsonRecord) {
  const deviceId = String(body.deviceId || '').trim()
  const groupJid = String(body.groupJid || '').trim()
  if (!deviceId || !groupJid) {
    return json({ error: 'deviceId and groupJid are required' }, 400)
  }

  /**
   * A instância é resolvida a partir do `deviceId` JÁ AUTORIZADO, e o
   * `instanceName` que o cliente manda é IGNORADO.
   *
   * O portão autoriza um aparelho; se a ação obedecesse ao nome de instância do
   * corpo, autorizar o aparelho A e agir sobre a instância B seria só uma questão
   * de trocar um campo do JSON. Mesmo padrão da função `send-message`, que
   * também resolve `instance_key` pelo `device_id`.
   */
  const deviceResp = await fetch(
    `${SUPABASE_URL}/rest/v1/devices?id=eq.${encodeURIComponent(deviceId)}&deleted_at=is.null&select=instance_key`,
    { headers: serviceHeaders },
  )
  if (!deviceResp.ok) return json({ error: 'Unable to resolve device' }, 500)
  const devices = await deviceResp.json()
  const instanceName = String((Array.isArray(devices) ? devices[0]?.instance_key : '') || '').trim()
  if (!instanceName) return json({ error: 'device not found' }, 400)

  const resp = await evolutionRequest(
    'GET',
    `/group/findGroupInfos/${encodeURIComponent(instanceName)}?groupJid=${encodeURIComponent(groupJid)}`,
  )

  if (!resp.ok) {
    return json({ indisponivel: true, status: resp.status, participants: [] })
  }

  const dados = (resp.payload ?? {}) as JsonRecord
  const brutos = Array.isArray(dados.participants) ? dados.participants : []
  const participants = brutos
    .map((p: any) => ({
      id: String(p?.id ?? ''),
      // Chega como "5547...@s.whatsapp.net"; o app trabalha com dígitos.
      phone: String(p?.phoneNumber ?? '').replace(/@.*$/, '').replace(/\D/g, ''),
      admin: p?.admin ?? null,
    }))
    .filter((p: any) => p.id || p.phone)

  return json({
    indisponivel: false,
    subject: (dados as any).subject ?? null,
    size: typeof (dados as any).size === 'number' ? (dados as any).size : participants.length,
    participants,
  })
}

/**
 * Resolve `deviceId → instance_key`, mesmo padrão de `groupParticipantsAction`
 * (linha ~124): o `instanceName` nunca vem do corpo da requisição, sempre do
 * aparelho já autorizado pelo gate. Extraído para função porque as 8 novas
 * actions de escrita de grupo repetem exatamente essa resolução.
 */
async function resolveInstanceName(deviceId: string): Promise<string | null> {
  const deviceResp = await fetch(
    `${SUPABASE_URL}/rest/v1/devices?id=eq.${encodeURIComponent(deviceId)}&deleted_at=is.null&select=instance_key`,
    { headers: serviceHeaders },
  )
  if (!deviceResp.ok) return null
  const devices = await deviceResp.json()
  const instanceName = String((Array.isArray(devices) ? devices[0]?.instance_key : '') || '').trim()
  return instanceName || null
}

/** `groupJid` só é aceitável no formato de grupo do WhatsApp. Recusa cedo. */
function validarGroupJid(groupJid: string): string | null {
  if (!groupJid || !groupJid.endsWith('@g.us')) {
    return 'groupJid inválido: precisa terminar em "@g.us"'
  }
  return null
}

/**
 * Traduz uma resposta de ESCRITA da Evolution em erro explícito para a UI.
 * Duas categorias precisam ser DISTINGUÍVEIS do erro genérico (exigência
 * explícita desta tarefa — leitura pode degradar em silêncio, escrita não):
 *
 *  - 404 → a instância não está mais nesse grupo. Mesma causa dos ~18% de 404
 *    medidos na LEITURA (`groupParticipantsAction`), mas aqui não dá pra cair
 *    de volta no banco: é uma ação de escrita, ou ela aconteceu ou não.
 *  - permissão → a Evolution recusa quando o número conectado não é admin do
 *    grupo. NÃO existe um contrato estável e documentado para esse caso; o
 *    heurístico abaixo procura por 401/403 ou por palavras como "admin" /
 *    "not authorized" no corpo do erro 400. Se a Evolution mudar a mensagem,
 *    cai no ramo genérico — nunca vira sucesso silencioso, só perde a
 *    distinção. PRECISA DE CONFIRMAÇÃO MANUAL contra a Evolution real.
 */
function respostaErroDeGrupo(
  result: { ok: boolean; status: number; payload: unknown },
  groupJid: string,
) {
  if (result.ok) return null

  if (result.status === 404) {
    return json({
      error: 'A instância não está mais nesse grupo.',
      code: 'group_unavailable',
      groupJid,
    }, 404)
  }

  const textoErro = JSON.stringify(result.payload ?? '').toLowerCase()
  const pareceErroDePermissao =
    [401, 403].includes(result.status) ||
    (result.status === 400 && /admin|not.?authoriz|forbidden|permission/.test(textoErro))

  if (pareceErroDePermissao) {
    return json({
      error: 'O número conectado não é administrador deste grupo.',
      code: 'not_group_admin',
      details: result.payload,
    }, 403)
  }

  return json({
    error: 'Falha ao executar ação no grupo na Evolution API.',
    code: 'evolution_error',
    details: result.payload,
    evolutionStatus: result.status,
  }, 502)
}

/** Muda a foto do grupo. Gate: `requireDeviceAccess`. */
async function groupUpdatePictureAction(body: JsonRecord) {
  const deviceId = String(body.deviceId || '').trim()
  const groupJid = String(body.groupJid || '').trim()
  // INCERTEZA DE CONTRATO: `/group/updateGroupPicture` costuma aceitar o campo
  // `image`, mas o FORMATO aceito (URL pública vs. base64 data URL) varia por
  // versão da Evolution e não há como confirmar isso sem chamar a API real —
  // proibido nesta tarefa. Por isso `image` é repassado EXATAMENTE como veio do
  // cliente, sem tentar normalizar ou adivinhar o formato. Verificação manual
  // necessária antes de ir para produção.
  const image = String(body.image || '').trim()

  if (!deviceId) return json({ error: 'deviceId is required' }, 400)
  const erroJid = validarGroupJid(groupJid)
  if (erroJid) return json({ error: erroJid }, 400)
  if (!image) return json({ error: 'image is required' }, 400)

  const instanceName = await resolveInstanceName(deviceId)
  if (!instanceName) return json({ error: 'device not found' }, 400)

  const result = await evolutionRequest(
    'PUT',
    `/group/updateGroupPicture/${encodeURIComponent(instanceName)}?groupJid=${encodeURIComponent(groupJid)}`,
    { image },
  )

  const erro = respostaErroDeGrupo(result, groupJid)
  if (erro) return erro

  return json({ groupJid, updated: true })
}

/** Muda o nome (assunto) do grupo. Gate: `requireDeviceAccess`. */
async function groupUpdateSubjectAction(body: JsonRecord) {
  const deviceId = String(body.deviceId || '').trim()
  const groupJid = String(body.groupJid || '').trim()
  const subject = String(body.subject || '').trim()

  if (!deviceId) return json({ error: 'deviceId is required' }, 400)
  const erroJid = validarGroupJid(groupJid)
  if (erroJid) return json({ error: erroJid }, 400)
  if (!subject) return json({ error: 'subject is required' }, 400)

  const instanceName = await resolveInstanceName(deviceId)
  if (!instanceName) return json({ error: 'device not found' }, 400)

  const result = await evolutionRequest(
    'PUT',
    `/group/updateGroupSubject/${encodeURIComponent(instanceName)}?groupJid=${encodeURIComponent(groupJid)}`,
    { subject },
  )

  const erro = respostaErroDeGrupo(result, groupJid)
  if (erro) return erro

  return json({ groupJid, subject, updated: true })
}

/** Muda a descrição do grupo. Gate: `requireDeviceAccess`. */
async function groupUpdateDescriptionAction(body: JsonRecord) {
  const deviceId = String(body.deviceId || '').trim()
  const groupJid = String(body.groupJid || '').trim()
  // Descrição vazia é caso de uso legítimo (apagar a descrição do grupo), então
  // só exigimos deviceId/groupJid válidos — não que `description` venha preenchido.
  const description = String(body.description ?? '').trim()

  if (!deviceId) return json({ error: 'deviceId is required' }, 400)
  const erroJid = validarGroupJid(groupJid)
  if (erroJid) return json({ error: erroJid }, 400)

  const instanceName = await resolveInstanceName(deviceId)
  if (!instanceName) return json({ error: 'device not found' }, 400)

  const result = await evolutionRequest(
    'PUT',
    `/group/updateGroupDescription/${encodeURIComponent(instanceName)}?groupJid=${encodeURIComponent(groupJid)}`,
    { description },
  )

  const erro = respostaErroDeGrupo(result, groupJid)
  if (erro) return erro

  return json({ groupJid, description, updated: true })
}

/**
 * `promote` | `demote` | `remove` compartilham a mesma rota da Evolution
 * (`/group/updateParticipant`), só muda o campo `action` do corpo. `promote` e
 * `demote` chegam aqui com gate `requireDeviceAccess`; `remove` chega com
 * `requireAdmin` (é destrutivo — decisão explícita do usuário, ver despacho).
 */
async function groupUpdateParticipantAction(body: JsonRecord, acao: 'promote' | 'demote' | 'remove') {
  const deviceId = String(body.deviceId || '').trim()
  const groupJid = String(body.groupJid || '').trim()
  const participant = String(body.participant || '').trim()

  if (!deviceId) return json({ error: 'deviceId is required' }, 400)
  const erroJid = validarGroupJid(groupJid)
  if (erroJid) return json({ error: erroJid }, 400)
  if (!participant) return json({ error: 'participant is required' }, 400)

  const instanceName = await resolveInstanceName(deviceId)
  if (!instanceName) return json({ error: 'device not found' }, 400)

  const result = await evolutionRequest(
    'PUT',
    `/group/updateParticipant/${encodeURIComponent(instanceName)}?groupJid=${encodeURIComponent(groupJid)}`,
    { action: acao, participants: [participant] },
  )

  const erro = respostaErroDeGrupo(result, groupJid)
  if (erro) return erro

  return json({ groupJid, participant, action: acao, updated: true })
}

/**
 * Cria um grupo novo. Gate: `requireAdmin` (decisão explícita do usuário —
 * junto com sair do grupo e remover participante, são as três ações
 * destrutivas/irreversíveis desta camada).
 */
async function groupCreateAction(body: JsonRecord) {
  const deviceId = String(body.deviceId || '').trim()
  const subject = String(body.subject || '').trim()
  const participants = Array.isArray(body.participants)
    ? body.participants.map((p) => String(p).trim()).filter(Boolean)
    : []
  const description = String(body.description || '').trim()

  if (!deviceId) return json({ error: 'deviceId is required' }, 400)
  if (!subject) return json({ error: 'subject is required' }, 400)
  if (participants.length === 0) return json({ error: 'at least one participant is required' }, 400)

  const instanceName = await resolveInstanceName(deviceId)
  if (!instanceName) return json({ error: 'device not found' }, 400)

  const payload: JsonRecord = { subject, participants }
  if (description) payload.description = description

  const result = await evolutionRequest('POST', `/group/create/${encodeURIComponent(instanceName)}`, payload)

  if (!result.ok) {
    return json({
      error: 'Falha ao criar grupo na Evolution API.',
      code: 'evolution_error',
      details: result.payload,
      evolutionStatus: result.status,
    }, 502)
  }

  const dados = (result.payload ?? {}) as JsonRecord
  const groupJid = String(dados.id ?? dados.groupJid ?? '') || null

  return json({ created: true, groupJid, raw: dados })
}

/**
 * Sai do grupo. Gate: `requireAdmin` (destrutivo/irreversível — mesma decisão
 * do usuário citada em `groupCreateAction`).
 */
async function groupLeaveAction(body: JsonRecord) {
  const deviceId = String(body.deviceId || '').trim()
  const groupJid = String(body.groupJid || '').trim()

  if (!deviceId) return json({ error: 'deviceId is required' }, 400)
  const erroJid = validarGroupJid(groupJid)
  if (erroJid) return json({ error: erroJid }, 400)

  const instanceName = await resolveInstanceName(deviceId)
  if (!instanceName) return json({ error: 'device not found' }, 400)

  const result = await evolutionRequest(
    'DELETE',
    `/group/leaveGroup/${encodeURIComponent(instanceName)}?groupJid=${encodeURIComponent(groupJid)}`,
  )

  const erro = respostaErroDeGrupo(result, groupJid)
  if (erro) return erro

  return json({ groupJid, left: true })
}

async function getEvolutionConfig() {
  let apiKey = Deno.env.get('EVOLUTION_API_KEY') || ''
  let apiUrl = (Deno.env.get('EVOLUTION_API_URL') || '').replace(/\/+$/, '')

  if (!apiKey || !apiUrl) {
    const secretsResp = await fetch(
      `${SUPABASE_URL}/rest/v1/secrets?select=key,value`,
      { headers: serviceHeaders },
    )
    if (secretsResp.ok) {
      const rows = await secretsResp.json()
      if (Array.isArray(rows)) {
        for (const row of rows) {
          if (row.key === 'EVOLUTION_API_KEY' && !apiKey) apiKey = row.value
          if (row.key === 'EVOLUTION_API_URL' && !apiUrl) apiUrl = row.value.replace(/\/+$/, '')
        }
      }
    }
  }

  if (!apiUrl) apiUrl = 'https://apps-evolution-api.srofjl.easypanel.host'
  if (apiUrl.startsWith('http://apps-evolution-api.srofjl.easypanel.host')) {
    apiUrl = apiUrl.replace(/^http:/, 'https:')
  }
  if (!apiKey) throw new Error('missing EVOLUTION_API_KEY')

  return { apiKey, apiUrl }
}

async function evolutionRequest(method: string, path: string, body?: Record<string, unknown>) {
  const { apiKey, apiUrl } = await getEvolutionConfig()
  const url = `${apiUrl}${path}`

  const options: RequestInit = {
    method,
    headers: {
      apikey: apiKey,
      'Content-Type': 'application/json',
    },
  }

  if (body) options.body = JSON.stringify(body)

  const response = await fetch(url, options)
  const text = await response.text()
  let payload: unknown = text
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
  }

  return { ok: response.ok, status: response.status, payload, url, method }
}

function extractQrCode(respData: JsonRecord): JsonRecord | null {
  const wrap = (respData.instance as JsonRecord) || respData
  const sources = [wrap, respData]

  for (const src of sources) {
    const base64 = String(src.base64 || src.qrcode || src.qrCode || src.qr || '')
    if (base64) return { base64 }
    const pairingCode = String(src.pairingCode || '')
    if (pairingCode) return { pairingCode }
    const code = String(src.code || '')
    if (code) return { code }
  }

  return null
}

async function listInstancesAction() {
  const { payload } = await evolutionRequest('GET', '/instance/fetchInstances')

  const rawList = Array.isArray(payload) ? payload
    : (payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (Array.isArray((payload as JsonRecord).instances) ? (payload as JsonRecord).instances
        : Array.isArray((payload as JsonRecord).data) ? (payload as JsonRecord).data
        : [])
      : [])

  const devicesResp = await fetch(
    `${SUPABASE_URL}/rest/v1/devices?select=id,name,instance_key,department,status,avatar_url,deleted_at&order=name.asc`,
    { headers: serviceHeaders },
  )
  const localDevices = devicesResp.ok ? await devicesResp.json() : []
  const devicesByKey = new Map<string, JsonRecord>()
  if (Array.isArray(localDevices)) {
    for (const d of localDevices) {
      if (d.instance_key) devicesByKey.set(d.instance_key, d)
    }
  }

  const validInstances: JsonRecord[] = []
  // Reconciliação de `devices.status`: depender só do webhook `connection.update`
  // (ver `evolution-webhook/index.ts`) é frágil — se ele cair, ou se a instância
  // reconectar com o webhook fora do ar, a coluna volta a mentir. Esta ação já
  // consulta a Evolution AO VIVO e já calcula `normalizedStatus` só para a
  // resposta; persistir o mesmo valor aqui resolve a reconciliação de graça,
  // toda vez que alguém abre a tela de Conexão WhatsApp — sem cron novo.
  const statusParaGravar: { id: string; status: string }[] = []

  for (const raw of rawList as JsonRecord[]) {
    const inst = (raw as JsonRecord).instance as JsonRecord || raw
    const instanceName = String(
      inst.instanceName || inst.name || inst.instanceId || inst.id
      || raw.instanceName || raw.name || raw.instanceId || raw.id
      || ''
    ).trim()
    if (!instanceName) continue

    const rawStatus = String(inst.connectionStatus || inst.status || raw.connectionStatus || raw.status || 'unknown')
    const lowerStatus = rawStatus.toLowerCase()

    let normalizedStatus: string
    if (['open', 'connected', 'online', 'connection'].includes(lowerStatus)) normalizedStatus = 'connected'
    else if (['close', 'closed', 'disconnected', 'offline'].includes(lowerStatus)) normalizedStatus = 'disconnected'
    else if (['connecting'].includes(lowerStatus)) normalizedStatus = 'connecting'
    else normalizedStatus = 'unknown'

    const device = devicesByKey.get(instanceName) || null

    // Só grava quando: (a) o aparelho existe e não foi excluído — um eco tardio
    // não pode reviver uma instância apagada no app; (b) o status mudou de
    // verdade — evita um PATCH a cada abertura de tela para os 5 aparelhos que
    // já estão certos; (c) `normalizedStatus` não é 'unknown' — um estado que a
    // Evolution não deu para classificar não pode sobrescrever um status bom.
    if (device && !device.deleted_at && normalizedStatus !== 'unknown' && device.status !== normalizedStatus) {
      statusParaGravar.push({ id: String(device.id), status: normalizedStatus })
    }

    validInstances.push({
      instanceName,
      status: rawStatus,
      normalizedStatus,
      profileName: String(inst.profileName || raw.profileName || '') || null,
      ownerJid: String(inst.ownerJid || raw.ownerJid || '') || null,
      profilePicUrl: String(inst.profilePicUrl || inst.profilePictureUrl || raw.profilePicUrl || raw.profilePictureUrl || '') || null,
      device,
      alreadyImported: Boolean(device),
    })
  }

  // Fogo-e-esquece: a reconciliação é um bônus desta leitura, não o motivo dela.
  // Se um PATCH falhar, a resposta ao front (que já foi montada com o valor
  // fresco de `normalizedStatus`) não pode ficar refém disso — a próxima
  // chamada de `list` tenta de novo.
  if (statusParaGravar.length > 0) {
    await Promise.all(
      statusParaGravar.map(({ id, status }) =>
        fetch(`${SUPABASE_URL}/rest/v1/devices?id=eq.${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { ...serviceHeaders, Prefer: 'return=minimal' },
          body: JSON.stringify({ status }),
        }).catch((err) => {
          console.warn(JSON.stringify({ scope: 'reconciliacao_status', deviceId: id, status, erro: String(err) }))
        }),
      ),
    )
  }

  return json({ instances: validInstances })
}

async function createInstanceAction(body: JsonRecord) {
  const instanceName = String(body.instanceName || '').trim()
  if (!instanceName) return json({ error: 'instanceName is required' }, 400)

  const createResult = await evolutionRequest('POST', '/instance/create', {
    instanceName,
    qrcode: true,
    integration: 'WHATSAPP-BAILEYS',
  })

  if (!createResult.ok) {
    return json({ error: 'Falha ao criar instância na Evolution API', details: createResult.payload, evolutionStatus: createResult.status }, 400)
  }

  const now = new Date().toISOString()
  const displayName = String(body.displayName || instanceName).trim()

  const checkResp = await fetch(
    `${SUPABASE_URL}/rest/v1/devices?instance_key=eq.${encodeURIComponent(instanceName)}&select=id`,
    { headers: serviceHeaders },
  )
  const existing = checkResp.ok ? await checkResp.json() : []
  let deviceId: string | null = null

  if (Array.isArray(existing) && existing.length > 0) {
    deviceId = existing[0].id
    await fetch(`${SUPABASE_URL}/rest/v1/devices?id=eq.${deviceId}`, {
      method: 'PATCH',
      headers: { ...serviceHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({
        name: displayName,
        status: 'connecting',
        deleted_at: null,
        department: String(body.department || '').trim() || null,
      }),
    })
  } else {
    const insertResp = await fetch(`${SUPABASE_URL}/rest/v1/devices`, {
      method: 'POST',
      headers: { ...serviceHeaders, Prefer: 'return=representation' },
      body: JSON.stringify({
        name: displayName,
        instance_key: instanceName,
        status: 'connecting',
        department: String(body.department || '').trim() || null,
        unread_count: 0,
      }),
    })
    if (insertResp.ok) {
      const created = await insertResp.json()
      deviceId = Array.isArray(created) && created.length > 0 ? created[0].id : null
    }
  }

  const webhookUrl = `${SUPABASE_URL}/functions/v1/evolution-webhook`
  await evolutionRequest('POST', `/webhook/set/${encodeURIComponent(instanceName)}`, {
    webhook: {
      enabled: true,
      url: webhookUrl,
      byEvents: true,
      base64: false,
      events: WEBHOOK_EVENTS,
    },
  })

  const respData = typeof createResult.payload === 'object' ? createResult.payload as JsonRecord : {}
  const qrcode = extractQrCode(respData)

  return json({
    instanceName,
    deviceId,
    status: 'connecting',
    qrcode,
  })
}

async function connectInstanceAction(body: JsonRecord) {
  const instanceName = String(body.instanceName || '').trim()
  if (!instanceName) return json({ error: 'instanceName é obrigatório' }, 400)

  const encodedName = encodeURIComponent(instanceName)

  const diagnostics: JsonRecord = {
    attemptedEndpoints: [] as JsonRecord[],
  }

  // Try GET first (standard Evolution API)
  let result = await evolutionRequest('GET', `/instance/connect/${encodedName}`)
  const attempts: JsonRecord[] = [
    { method: 'GET', path: `/instance/connect/${encodedName}`, status: result.status, ok: result.ok },
  ]

  if (!result.ok) {
    // Try POST as fallback (some Evolution versions)
    result = await evolutionRequest('POST', `/instance/connect/${encodedName}`)
    attempts.push({ method: 'POST', path: `/instance/connect/${encodedName}`, status: result.status, ok: result.ok })
  }

  if (!result.ok) {
    // Try POST with empty body as second fallback
    result = await evolutionRequest('POST', `/instance/connect/${encodedName}`, {})
    attempts.push({ method: 'POST (body)', path: `/instance/connect/${encodedName}`, status: result.status, ok: result.ok })
  }

  diagnostics.attemptedEndpoints = attempts

  if (!result.ok) {
    const responsePayload = typeof result.payload === 'object' ? result.payload : { raw: String(result.payload) }
    return json({
      error: 'Falha ao conectar instância na Evolution API',
      details: responsePayload,
      diagnostics,
    }, 400)
  }

  const respData = typeof result.payload === 'object' ? result.payload as JsonRecord : {}
  const qrcode = extractQrCode(respData)

  return json({
    instanceName,
    qrcode,
  })
}

async function disconnectInstanceAction(body: JsonRecord) {
  const instanceName = String(body.instanceName || '').trim()
  if (!instanceName) return json({ error: 'instanceName is required' }, 400)

  const result = await evolutionRequest('DELETE', `/instance/logout/${encodeURIComponent(instanceName)}`)

  await fetch(
    `${SUPABASE_URL}/rest/v1/devices?instance_key=eq.${encodeURIComponent(instanceName)}`,
    {
      method: 'PATCH',
      headers: { ...serviceHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'disconnected' }),
    },
  )

  return json({ instanceName, status: 'disconnected', ok: result.ok })
}

async function deleteInstanceAction(body: JsonRecord) {
  const instanceName = String(body.instanceName || '').trim()
  if (!instanceName) return json({ error: 'instanceName is required' }, 400)

  await evolutionRequest('DELETE', `/instance/delete/${encodeURIComponent(instanceName)}`)

  const now = new Date().toISOString()
  await fetch(
    `${SUPABASE_URL}/rest/v1/devices?instance_key=eq.${encodeURIComponent(instanceName)}`,
    {
      method: 'PATCH',
      headers: { ...serviceHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({ deleted_at: now, status: 'deleted' }),
    },
  )

  return json({ instanceName, softDeleted: true, status: 'deleted' })
}

async function renameDisplayAction(body: JsonRecord) {
  const instanceName = String(body.instanceName || '').trim()
  const displayName = String(body.displayName || '').trim()

  if (!instanceName) return json({ error: 'instanceName is required' }, 400)
  if (!displayName) return json({ error: 'displayName is required' }, 400)

  await fetch(
    `${SUPABASE_URL}/rest/v1/devices?instance_key=eq.${encodeURIComponent(instanceName)}`,
    {
      method: 'PATCH',
      headers: { ...serviceHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({ name: displayName }),
    },
  )

  return json({ instanceName, displayName, updated: true })
}

async function configureWebhookAction(body: JsonRecord) {
  const instanceName = String(body.instanceName || '').trim()
  if (!instanceName) return json({ error: 'instanceName is required' }, 400)

  const webhookUrl = `${SUPABASE_URL}/functions/v1/evolution-webhook`
  const result = await evolutionRequest('POST', `/webhook/set/${encodeURIComponent(instanceName)}`, {
    webhook: {
      enabled: true,
      url: webhookUrl,
      byEvents: true,
      base64: false,
      events: WEBHOOK_EVENTS,
    },
  })

  return json({ instanceName, configured: result.ok })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405)
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return json({ error: 'Supabase environment not configured' }, 500)
  }

  const authHeader = req.headers.get('Authorization') || ''

  try {
    const body = await req.json().catch(() => ({})) as JsonRecord
    const action = String(body.action || '').trim()

    // Ações de ATENDIMENTO (não de administração de instância): valida sessão +
    // acesso ao aparelho, não o papel de admin. `group_participants` é leitura;
    // as quatro de grupo abaixo são escrita, mas ainda são operação do dia a dia
    // de quem já tem o aparelho liberado — mudar nome/foto/descrição do grupo ou
    // promover/rebaixar um admin não é ação destrutiva/irreversível. Todo o
    // resto (inclusive criar grupo, sair do grupo e remover participante — essas
    // três SÃO destrutivas/irreversíveis) continua exigindo admin, como antes.
    const acoesDeAparelho = new Set([
      'group_participants',
      'group_update_picture',
      'group_update_subject',
      'group_update_description',
      'group_promote_participant',
      'group_demote_participant',
    ])

    if (acoesDeAparelho.has(action)) {
      const acesso = await requireDeviceAccess(authHeader, String(body.deviceId || '').trim())
      if (acesso.error) return acesso.error

      switch (action) {
        case 'group_participants':
          return await groupParticipantsAction(body)
        case 'group_update_picture':
          return await groupUpdatePictureAction(body)
        case 'group_update_subject':
          return await groupUpdateSubjectAction(body)
        case 'group_update_description':
          return await groupUpdateDescriptionAction(body)
        case 'group_promote_participant':
          return await groupUpdateParticipantAction(body, 'promote')
        case 'group_demote_participant':
          return await groupUpdateParticipantAction(body, 'demote')
      }
    }

    const admin = await requireAdmin(authHeader)
    if (admin.error) return admin.error

    switch (action) {
      case 'list':
        return await listInstancesAction()
      case 'create':
        return await createInstanceAction(body)
      case 'connect':
        return await connectInstanceAction(body)
      case 'disconnect':
        return await disconnectInstanceAction(body)
      case 'delete':
        return await deleteInstanceAction(body)
      case 'rename_display':
        return await renameDisplayAction(body)
      case 'configure_webhook':
        return await configureWebhookAction(body)
      case 'group_create':
        return await groupCreateAction(body)
      case 'group_leave':
        return await groupLeaveAction(body)
      case 'group_remove_participant':
        return await groupUpdateParticipantAction(body, 'remove')
      default:
        return json({ error: `unknown action: ${action}` }, 400)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return json({ error: message }, 500)
  }
})
