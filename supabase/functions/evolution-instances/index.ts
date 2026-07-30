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
      events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE'],
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
      events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE'],
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

    // `group_participants` é operação de atendimento, não de administração:
    // valida sessão + acesso ao aparelho. Todo o resto continua exigindo admin,
    // exatamente como antes.
    if (action === 'group_participants') {
      const acesso = await requireDeviceAccess(authHeader, String(body.deviceId || '').trim())
      if (acesso.error) return acesso.error
      return await groupParticipantsAction(body)
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
      default:
        return json({ error: `unknown action: ${action}` }, 400)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return json({ error: message }, 500)
  }
})
