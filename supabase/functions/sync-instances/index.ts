import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const DEFAULT_WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/evolution-webhook`
// `CONNECTION_UPDATE` foi acrescentado para consertar `devices.status` na ORIGEM:
// antes desta linha, a coluna só era escrita em 4 pontos de
// `evolution-instances/index.ts` (create/connect -> 'connecting', disconnect ->
// 'disconnected', delete -> 'deleted') e NUNCA saía de 'connecting' depois que o
// QR era lido, porque nenhum evento assinado aqui cobria mudança de conexão — só
// mensagem. `MESSAGES_UPSERT`/`MESSAGES_UPDATE` são preservados: são a função
// principal do app (recebimento de mensagem) e não podem ser perdidos.
const WEBHOOK_EVENTS = ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE']

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

type JsonRecord = Record<string, unknown>

type SyncInstance = {
  instanceName: string
  status: string
  profileName: string | null
  ownerJid: string | null
  profilePicUrl: string | null
  alreadyImported: boolean
  device: JsonRecord | null
}

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null
}

function stringFrom(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function arrayFromEvolutionPayload(payload: unknown) {
  if (Array.isArray(payload)) return payload

  const record = asRecord(payload)
  if (!record) return []

  if (Array.isArray(record.instances)) return record.instances
  if (Array.isArray(record.data)) return record.data
  if (Array.isArray(record.result)) return record.result
  return []
}

function normalizeInstance(raw: unknown) {
  const root = asRecord(raw)
  if (!root) return null

  const instance = asRecord(root.instance) || root
  const instanceName = stringFrom(
    instance.instanceName,
    instance.name,
    root.instanceName,
    root.name,
  )

  if (!instanceName) return null

  const status = stringFrom(
    instance.connectionStatus,
    instance.status,
    instance.state,
    root.connectionStatus,
    root.status,
    root.state,
  )

  return {
    instanceName,
    status: status || 'unknown',
    profileName: stringFrom(instance.profileName, root.profileName) || null,
    ownerJid: stringFrom(instance.ownerJid, root.ownerJid) || null,
    profilePicUrl: stringFrom(
      instance.profilePicUrl,
      instance.profilePictureUrl,
      root.profilePicUrl,
      root.profilePictureUrl,
    ) || null,
  }
}

function isConnectedInstance(instance: ReturnType<typeof normalizeInstance>) {
  if (!instance) return false

  const status = instance.status.toLowerCase()
  if (['open', 'connected', 'connection', 'online'].includes(status)) return true
  if (['close', 'closed', 'disconnected', 'offline', 'connecting'].includes(status)) return false

  return Boolean(instance.ownerJid || instance.profileName || instance.profilePicUrl)
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
  if (!apiKey) throw new Error('missing EVOLUTION_API_KEY secret')

  return { apiKey, apiUrl }
}

function getEvolutionWebhookUrl() {
  return (Deno.env.get('EVOLUTION_WEBHOOK_URL') || DEFAULT_WEBHOOK_URL).trim()
}

async function evolutionRequest(apiUrl: string, apiKey: string, path: string, body: Record<string, unknown>) {
  const response = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: {
      apikey: apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const text = await response.text()
  let payload: unknown = text
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
  }

  return { ok: response.ok, status: response.status, payload }
}

async function configureEvolutionWebhook(instanceName: string) {
  const { apiKey, apiUrl } = await getEvolutionConfig()
  const webhookUrl = getEvolutionWebhookUrl()
  const path = `/webhook/set/${encodeURIComponent(instanceName)}`
  const nestedPayload = {
    webhook: {
      enabled: true,
      url: webhookUrl,
      byEvents: true,
      base64: false,
      events: WEBHOOK_EVENTS,
    },
  }
  const flatPayload = {
    enabled: true,
    url: webhookUrl,
    webhook_by_events: true,
    webhook_base64: false,
    events: WEBHOOK_EVENTS,
  }

  const nestedResult = await evolutionRequest(apiUrl, apiKey, path, nestedPayload)
  if (nestedResult.ok) {
    return { instanceName, status: nestedResult.status, configured: true }
  }

  const flatResult = await evolutionRequest(apiUrl, apiKey, path, flatPayload)
  if (flatResult.ok) {
    return { instanceName, status: flatResult.status, configured: true }
  }

  return {
    instanceName,
    configured: false,
    status: flatResult.status || nestedResult.status,
    error: flatResult.payload || nestedResult.payload,
  }
}

async function fetchConnectedEvolutionInstances() {
  const { apiKey, apiUrl } = await getEvolutionConfig()
  const response = await fetch(`${apiUrl}/instance/fetchInstances`, {
    headers: {
      apikey: apiKey,
      'Content-Type': 'application/json',
    },
  })

  const text = await response.text()
  let payload: unknown = text
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
  }

  if (!response.ok) {
    throw new Error(`Evolution API error ${response.status}: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`)
  }

  const unique = new Map<string, NonNullable<ReturnType<typeof normalizeInstance>>>()
  for (const raw of arrayFromEvolutionPayload(payload)) {
    const instance = normalizeInstance(raw)
    if (isConnectedInstance(instance) && instance && !unique.has(instance.instanceName)) {
      unique.set(instance.instanceName, instance)
    }
  }

  return Array.from(unique.values()).sort((a, b) => a.instanceName.localeCompare(b.instanceName))
}

async function fetchDevices() {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/devices?select=id,name,instance_key,department,status,avatar_url&order=name.asc`,
    { headers: serviceHeaders },
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to fetch devices: ${error}`)
  }

  const devices = await response.json()
  return Array.isArray(devices) ? devices as JsonRecord[] : []
}

async function listInstances() {
  const [instances, devices] = await Promise.all([fetchConnectedEvolutionInstances(), fetchDevices()])
  const devicesByInstanceKey = new Map<string, JsonRecord>()

  for (const device of devices) {
    const instanceKey = stringFrom(device.instance_key)
    if (instanceKey) devicesByInstanceKey.set(instanceKey, device)
  }

  const items: SyncInstance[] = instances.map((instance) => {
    const device = devicesByInstanceKey.get(instance.instanceName) || null
    return {
      ...instance,
      alreadyImported: Boolean(device),
      device,
    }
  })

  return json({ instances: items })
}

function requestedInstanceNames(body: unknown) {
  const record = asRecord(body)
  const rawInstances = Array.isArray(record?.instances) ? record.instances : []
  const names = new Set<string>()

  for (const item of rawInstances) {
    if (typeof item === 'string') {
      if (item.trim()) names.add(item.trim())
      continue
    }

    const instance = asRecord(item)
    const instanceName = stringFrom(instance?.instanceName, instance?.name)
    if (instanceName) names.add(instanceName)
  }

  return Array.from(names)
}

async function configureWebhooks(req: Request) {
  const body = await req.json().catch(() => null)
  const names = requestedInstanceNames(body)
  if (names.length === 0) return json({ error: 'instances is required' }, 400)

  const results = []
  for (const name of names) {
    results.push(await configureEvolutionWebhook(name))
  }

  const failed = results.filter((result) => !result.configured)
  return json({ configured: results, failed }, failed.length > 0 ? 207 : 200)
}

async function importInstances(req: Request) {
  const body = await req.json().catch(() => null)
  const names = requestedInstanceNames(body)
  if (names.length === 0) return json({ error: 'instances is required' }, 400)

  const [connectedInstances, existingDevices] = await Promise.all([
    fetchConnectedEvolutionInstances(),
    fetchDevices(),
  ])

  const connectedByName = new Map(connectedInstances.map((instance) => [instance.instanceName, instance]))
  const existingByInstanceKey = new Map<string, JsonRecord>()
  for (const device of existingDevices) {
    const instanceKey = stringFrom(device.instance_key)
    if (instanceKey) existingByInstanceKey.set(instanceKey, device)
  }

  const skipped: JsonRecord[] = []
  const rowsToInsert: JsonRecord[] = []
  const now = new Date().toISOString()

  for (const name of names) {
    const instance = connectedByName.get(name)
    if (!instance) {
      skipped.push({ instanceName: name, reason: 'not_connected' })
      continue
    }

    if (existingByInstanceKey.has(name)) {
      skipped.push({ instanceName: name, reason: 'already_imported' })
      continue
    }

    rowsToInsert.push({
      name: instance.instanceName,
      instance_key: instance.instanceName,
      status: instance.status === 'unknown' ? 'open' : instance.status,
      unread_count: 0,
      department: null,
      avatar_url: instance.profilePicUrl,
      avatar_updated_at: instance.profilePicUrl ? now : null,
    })
  }

  const webhookResults = []
  for (const name of names.filter((name) => connectedByName.has(name))) {
    webhookResults.push(await configureEvolutionWebhook(name))
  }

  if (rowsToInsert.length === 0) return json({ created: [], skipped, webhooks: webhookResults })

  const insertResp = await fetch(`${SUPABASE_URL}/rest/v1/devices`, {
    method: 'POST',
    headers: { ...serviceHeaders, Prefer: 'return=representation' },
    body: JSON.stringify(rowsToInsert),
  })

  if (!insertResp.ok) {
    const error = await insertResp.text()
    throw new Error(`Failed to create devices: ${error}`)
  }

  const created = await insertResp.json()
  return json({ created: Array.isArray(created) ? created : [], skipped, webhooks: webhookResults })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (!['GET', 'POST'].includes(req.method)) {
    return json({ error: 'method not allowed' }, 405)
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return json({ error: 'Supabase environment not configured' }, 500)
  }

  const admin = await requireAdmin(req.headers.get('Authorization') || '')
  if (admin.error) return admin.error

  try {
    if (req.method === 'GET') return await listInstances()
    const body = await req.clone().json().catch(() => null)
    if (asRecord(body)?.action === 'configure_webhooks') return await configureWebhooks(req)
    return await importInstances(req)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return json({ error: message }, 500)
  }
})
