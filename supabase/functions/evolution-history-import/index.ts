import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const STORAGE_BUCKET = 'chat-attachments'
const ALLOWED_INSTANCE = 'Financeiro Medimagem'
const DEFAULT_PAGE_SIZE = 50
const DEFAULT_RECENT_MEDIA_DAYS = 7

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

type MediaType = 'image' | 'video' | 'audio' | 'document' | 'sticker'

type MediaInfo = {
  type: MediaType
  label: string
  caption: string
  mime: string
  name: string
  convertToMp4: boolean
}

type ImportJob = {
  id: string
  instance_name: string
  device_id: string
  status: string
  total_messages: number
  total_pages: number
  target_pages: number
  current_page: number
  page_size: number
  media_mode: string
  recent_media_days: number
  inserted_count: number
  skipped_count: number
  failed_count: number
  error_message: string | null
  started_by: string | null
  started_at: string | null
  finished_at: string | null
  created_at: string
  updated_at: string
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
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function numberFrom(...values: unknown[]) {
  for (const value of values) {
    const n = typeof value === 'number' ? value : Number(value)
    if (Number.isFinite(n)) return n
  }
  return 0
}

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const n = Math.trunc(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function validateInstance(instanceName: string) {
  if (instanceName !== ALLOWED_INSTANCE) {
    throw new Error(`Importação liberada apenas para ${ALLOWED_INSTANCE}`)
  }
}

function quotedIn(values: string[]) {
  return values
    .map((value) => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    .join(',')
}

function safeSegment(value: string): string {
  return (value || 'unknown').replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0, 120) || 'unknown'
}

function safeFileName(value: string): string {
  return (value || 'media_file').replace(/[^a-zA-Z0-9_. -]+/g, '_').slice(0, 160) || 'media_file'
}

function extensionFromMime(mime: string): string {
  const normalized = (mime || '').split(';')[0].toLowerCase()
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/3gpp': '3gp',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/webm': 'webm',
    'application/pdf': 'pdf',
    'text/plain': 'txt',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  }
  return map[normalized] || 'bin'
}

function ensureExtension(name: string, mime: string): string {
  if (/\.[a-z0-9]{2,8}$/i.test(name)) return name
  return `${name}.${extensionFromMime(mime)}`
}

function unwrapMessage(msgObj: Record<string, unknown>): Record<string, any> {
  let current = msgObj as Record<string, any>
  for (let i = 0; i < 6; i++) {
    const next =
      current?.ephemeralMessage?.message ||
      current?.viewOnceMessage?.message ||
      current?.viewOnceMessageV2?.message ||
      current?.viewOnceMessageV2Extension?.message ||
      current?.documentWithCaptionMessage?.message ||
      current?.editedMessage?.message
    if (!next || next === current) break
    current = next
  }
  return current
}

function getMediaInfo(msgObj: Record<string, unknown>): MediaInfo | null {
  const m = msgObj as Record<string, any>

  if (m.imageMessage) {
    const msg = m.imageMessage
    const mime = msg.mimetype || 'image/jpeg'
    return { type: 'image', label: '[Imagem]', caption: msg.caption || '', mime, name: ensureExtension(msg.fileName || 'image_message', mime), convertToMp4: false }
  }

  if (m.videoMessage) {
    const msg = m.videoMessage
    const mime = msg.mimetype || 'video/mp4'
    return { type: 'video', label: '[Vídeo]', caption: msg.caption || '', mime, name: ensureExtension(msg.fileName || 'video_message', mime), convertToMp4: true }
  }

  if (m.audioMessage) {
    const msg = m.audioMessage
    const mime = msg.mimetype || 'audio/ogg'
    return { type: 'audio', label: msg.ptt ? '[Áudio]' : '[Música]', caption: '', mime, name: ensureExtension(msg.fileName || 'audio_message', mime), convertToMp4: false }
  }

  if (m.documentMessage) {
    const msg = m.documentMessage
    const mime = msg.mimetype || 'application/octet-stream'
    const name = msg.fileName || msg.title || 'document_message'
    return { type: 'document', label: `[Documento: ${name}]`, caption: msg.caption || '', mime, name: ensureExtension(name, mime), convertToMp4: false }
  }

  if (m.stickerMessage) {
    const msg = m.stickerMessage
    const mime = msg.mimetype || 'image/webp'
    return { type: 'sticker', label: '[Figurinha]', caption: '', mime, name: ensureExtension(msg.fileName || 'sticker_message', mime), convertToMp4: false }
  }

  return null
}

function extractContent(msgObj: Record<string, unknown>): string {
  if (!msgObj) return ''
  const m = msgObj as Record<string, any>
  const mediaInfo = getMediaInfo(m)
  if (m.conversation) return m.conversation
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text
  if (mediaInfo) return mediaInfo.caption || mediaInfo.label
  if (m.reactionMessage) return '[Reação]'
  if (m.contactMessage) return '[Contato]'
  if (m.locationMessage) return '[Localização]'
  return '[Mensagem de mídia]'
}

function findBase64(value: unknown, depth = 0): string | null {
  if (depth > 5 || value == null) return null
  if (typeof value === 'string') {
    const compact = value.replace(/\s/g, '')
    if (compact.startsWith('data:') || (/^[A-Za-z0-9+/=]+$/.test(compact) && compact.length > 200)) return value
    return null
  }
  if (typeof value !== 'object') return null

  const obj = value as Record<string, unknown>
  for (const key of ['base64', 'base64File', 'file', 'data', 'media']) {
    const found = findBase64(obj[key], depth + 1)
    if (found) return found
  }
  for (const item of Object.values(obj)) {
    const found = findBase64(item, depth + 1)
    if (found) return found
  }
  return null
}

function parseBase64(raw: string, fallbackMime: string): { base64: string; mime: string } {
  const match = raw.match(/^data:([^;]+);base64,(.*)$/s)
  if (match) return { mime: match[1] || fallbackMime, base64: match[2].replace(/\s/g, '') }
  return { mime: fallbackMime, base64: raw.replace(/\s/g, '') }
}

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function messageTimestampToIso(value: unknown): string {
  const n = numberFrom(value)
  if (!n) return new Date().toISOString()
  const ms = n > 9999999999 ? n : n * 1000
  return new Date(ms).toISOString()
}

function isRecent(isoDate: string, days: number) {
  if (days <= 0) return false
  return Date.now() - new Date(isoDate).getTime() <= days * 24 * 60 * 60 * 1000
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
    const secretsResp = await fetch(`${SUPABASE_URL}/rest/v1/secrets?select=key,value`, { headers: serviceHeaders })
    if (secretsResp.ok) {
      const rows = await secretsResp.json()
      if (Array.isArray(rows)) {
        for (const row of rows) {
          if (row.key === 'EVOLUTION_API_KEY' && !apiKey) apiKey = row.value
          if (row.key === 'EVOLUTION_API_URL' && !apiUrl) apiUrl = String(row.value || '').replace(/\/+$/, '')
        }
      }
    }
  }

  if (!apiUrl) apiUrl = 'https://apps-evolution-api.srofjl.easypanel.host'
  if (apiUrl.startsWith('http://apps-evolution-api.srofjl.easypanel.host')) apiUrl = apiUrl.replace(/^http:/, 'https:')
  if (!apiKey) throw new Error('missing EVOLUTION_API_KEY')

  return { apiKey, apiUrl }
}

async function evolutionRequest(method: string, path: string, body?: Record<string, unknown>) {
  const { apiKey, apiUrl } = await getEvolutionConfig()
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: { apikey: apiKey, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const text = await response.text()
  let payload: unknown = text
  if (text) {
    try { payload = JSON.parse(text) } catch { payload = text }
  }

  return { ok: response.ok, status: response.status, payload }
}

async function getDevice(instanceName: string) {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/devices?instance_key=eq.${encodeURIComponent(instanceName)}&deleted_at=is.null&select=id,name,instance_key,status`,
    { headers: serviceHeaders },
  )
  if (!resp.ok) throw new Error('Falha ao buscar aparelho local')
  const rows = await resp.json()
  const device = Array.isArray(rows) ? rows[0] : null
  if (!device) throw new Error(`Aparelho local não encontrado para ${instanceName}`)
  return device as JsonRecord
}

async function countMessages(deviceId: string) {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/messages?device_id=eq.${encodeURIComponent(deviceId)}&select=id`,
    { headers: { ...serviceHeaders, Prefer: 'count=exact', Range: '0-0' }, method: 'HEAD' },
  )
  const contentRange = resp.headers.get('content-range') || ''
  const total = Number(contentRange.split('/')[1] || 0)
  return Number.isFinite(total) ? total : 0
}

async function fetchEvolutionPage(instanceName: string, page: number, pageSize: number) {
  const result = await evolutionRequest('POST', `/chat/findMessages/${encodeURIComponent(instanceName)}`, {
    page,
    limit: pageSize,
  })

  if (!result.ok) {
    throw new Error(`Evolution API findMessages ${result.status}: ${JSON.stringify(result.payload).slice(0, 500)}`)
  }

  const root = asRecord(result.payload) || {}
  const messages = asRecord(root.messages) || root
  const records = Array.isArray(messages.records) ? messages.records : []
  return {
    total: numberFrom(messages.total, root.total),
    pages: numberFrom(messages.pages, root.pages, 1),
    currentPage: numberFrom(messages.currentPage, root.currentPage, page),
    records,
  }
}

async function getLatestJob(instanceName: string) {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/evolution_history_import_jobs?instance_name=eq.${encodeURIComponent(instanceName)}&select=*&order=created_at.desc&limit=1`,
    { headers: serviceHeaders },
  )
  if (!resp.ok) throw new Error('Falha ao buscar job de importação')
  const rows = await resp.json()
  return Array.isArray(rows) && rows.length > 0 ? rows[0] as ImportJob : null
}

async function getActiveJob(instanceName: string) {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/evolution_history_import_jobs?instance_name=eq.${encodeURIComponent(instanceName)}&status=in.(pending,running,paused)&select=*&order=created_at.desc&limit=1`,
    { headers: serviceHeaders },
  )
  if (!resp.ok) throw new Error('Falha ao buscar job ativo')
  const rows = await resp.json()
  return Array.isArray(rows) && rows.length > 0 ? rows[0] as ImportJob : null
}

async function getJob(jobId: string) {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/evolution_history_import_jobs?id=eq.${encodeURIComponent(jobId)}&select=*`,
    { headers: serviceHeaders },
  )
  if (!resp.ok) throw new Error('Falha ao buscar job')
  const rows = await resp.json()
  return Array.isArray(rows) && rows.length > 0 ? rows[0] as ImportJob : null
}

async function updateJob(jobId: string, data: Record<string, unknown>) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/evolution_history_import_jobs?id=eq.${encodeURIComponent(jobId)}`, {
    method: 'PATCH',
    headers: { ...serviceHeaders, Prefer: 'return=representation' },
    body: JSON.stringify({ ...data, updated_at: new Date().toISOString() }),
  })
  if (!resp.ok) throw new Error(`Falha ao atualizar job: ${await resp.text()}`)
  const rows = await resp.json()
  return Array.isArray(rows) && rows.length > 0 ? rows[0] as ImportJob : null
}

async function createJob(data: Record<string, unknown>) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/evolution_history_import_jobs`, {
    method: 'POST',
    headers: { ...serviceHeaders, Prefer: 'return=representation' },
    body: JSON.stringify(data),
  })
  if (!resp.ok) throw new Error(`Falha ao criar job: ${await resp.text()}`)
  const rows = await resp.json()
  return Array.isArray(rows) && rows.length > 0 ? rows[0] as ImportJob : null
}

function normalizeRemoteSender(key: Record<string, any>) {
  const rawJid = key.remoteJidAlt || key.remoteJid || ''
  const isGroup = String(rawJid).includes('@g.us') || String(key.remoteJid || '').includes('@g.us')
  if (isGroup) return String(key.remoteJid || rawJid)
  return String(rawJid).replace(/@s\.whatsapp\.net/g, '').replace(/@lid/g, '').replace(/\D/g, '')
}

function normalizeMessage(raw: unknown, deviceId: string, instanceName: string, job: ImportJob) {
  const record = asRecord(raw)
  if (!record) return null

  const key = asRecord(record.key) as Record<string, any> | null
  if (!key) return null

  const externalId = stringFrom(key.id)
  if (!externalId) return null

  const remoteSender = normalizeRemoteSender(key)
  if (!remoteSender) return null

  const isFromMe = key.fromMe === true
  const createdAt = messageTimestampToIso(record.messageTimestamp)
  const msgObj = unwrapMessage((asRecord(record.message) || {}) as Record<string, unknown>)
  const mediaInfo = getMediaInfo(msgObj)
  const content = extractContent(msgObj)
  const shouldFetchMedia = job.media_mode === 'hybrid' && mediaInfo && isRecent(createdAt, job.recent_media_days)
  const senderName = stringFrom(record.pushName) || (isFromMe ? instanceName : '')

  return {
    raw: record,
    mediaInfo,
    shouldFetchMedia,
    contact: { remote_jid: remoteSender, name: !String(remoteSender).includes('@g.us') ? senderName : '' },
    row: {
      content,
      device_id: deviceId,
      remote_sender: remoteSender,
      sender_name: senderName,
      direction: isFromMe ? 'outbound' : 'inbound',
      is_read: true,
      origin: 'webhook',
      external_id: externalId,
      created_at: createdAt,
    } as JsonRecord,
  }
}

async function existingExternalIds(deviceId: string, externalIds: string[]) {
  if (externalIds.length === 0) return new Set<string>()
  const filter = encodeURIComponent(quotedIn(externalIds))
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/messages?device_id=eq.${encodeURIComponent(deviceId)}&external_id=in.(${filter})&select=external_id`,
    { headers: serviceHeaders },
  )
  if (!resp.ok) return new Set<string>()
  const rows = await resp.json()
  return new Set(Array.isArray(rows) ? rows.map((r) => String(r.external_id)).filter(Boolean) : [])
}

async function saveContacts(candidates: Array<{ remote_jid: string; name: string }>) {
  const byJid = new Map<string, { remote_jid: string; name: string }>()
  for (const candidate of candidates) {
    if (!candidate.remote_jid) continue
    const current = byJid.get(candidate.remote_jid)
    if (!current || (!current.name && candidate.name)) byJid.set(candidate.remote_jid, candidate)
  }

  const items = Array.from(byJid.values())
  if (items.length === 0) return

  const filter = encodeURIComponent(quotedIn(items.map((i) => i.remote_jid)))
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/contacts?remote_jid=in.(${filter})&select=id,remote_jid,name,nickname`,
    { headers: serviceHeaders },
  )
  const existing = resp.ok ? await resp.json() : []
  const existingByJid = new Map<string, JsonRecord>()
  if (Array.isArray(existing)) {
    for (const row of existing) existingByJid.set(String(row.remote_jid), row)
  }

  const inserts: JsonRecord[] = []
  const now = new Date().toISOString()
  for (const item of items) {
    const found = existingByJid.get(item.remote_jid)
    if (!found) {
      inserts.push({ remote_jid: item.remote_jid, name: item.name || undefined })
      continue
    }
    if (!found.name && item.name) {
      await fetch(`${SUPABASE_URL}/rest/v1/contacts?id=eq.${found.id}`, {
        method: 'PATCH',
        headers: { ...serviceHeaders, Prefer: 'return=minimal' },
        body: JSON.stringify({ name: item.name, updated_at: now }),
      })
    }
  }

  if (inserts.length > 0) {
    await fetch(`${SUPABASE_URL}/rest/v1/contacts`, {
      method: 'POST',
      headers: { ...serviceHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify(inserts),
    })
  }
}

async function uploadMedia(path: string, bytes: Uint8Array, mime: string): Promise<string | null> {
  const resp = await fetch(`${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': mime || 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: bytes,
  })
  if (!resp.ok) return null
  return `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${path}`
}

async function fetchMediaAttachment(instanceName: string, messageData: Record<string, any>, mediaInfo: MediaInfo) {
  const attempts = [
    { message: messageData, convertToMp4: mediaInfo.convertToMp4 },
    { message: { key: messageData.key, message: messageData.message }, convertToMp4: mediaInfo.convertToMp4 },
    { message: { key: { id: messageData.key?.id, fromMe: messageData.key?.fromMe, remoteJid: messageData.key?.remoteJidAlt || messageData.key?.remoteJid, participant: messageData.key?.participant } }, convertToMp4: mediaInfo.convertToMp4 },
  ]

  for (const body of attempts) {
    const result = await evolutionRequest('POST', `/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`, body)
    if (!result.ok) continue
    const foundBase64 = findBase64(result.payload)
    if (!foundBase64) continue

    const data = asRecord(result.payload) || {}
    const parsed = parseBase64(foundBase64, stringFrom(data.mimetype, data.mimeType) || mediaInfo.mime)
    const bytes = decodeBase64(parsed.base64)
    const mime = parsed.mime || mediaInfo.mime
    const name = ensureExtension(safeFileName(stringFrom(data.fileName, data.filename) || mediaInfo.name), mime)
    const ext = extensionFromMime(mime)
    const messageId = safeSegment(stringFrom(messageData.key?.id) || crypto.randomUUID())
    const instance = safeSegment(instanceName)
    const path = `whatsapp/${instance}/${mediaInfo.type}/${messageId}.${ext}`
    const url = await uploadMedia(path, bytes, mime)
    if (!url) continue
    return { url, type: mediaInfo.type, name, mime }
  }

  return null
}

async function insertMessages(rows: JsonRecord[]) {
  if (rows.length === 0) return { inserted: 0, failed: 0, skipped: 0 }

  const bulkResp = await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
    method: 'POST',
    headers: { ...serviceHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify(rows),
  })
  if (bulkResp.ok) return { inserted: rows.length, failed: 0, skipped: 0 }

  let inserted = 0
  let failed = 0
  let skipped = 0
  for (const row of rows) {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
      method: 'POST',
      headers: { ...serviceHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify(row),
    })
    if (resp.ok) inserted += 1
    else {
      const text = await resp.text().catch(() => '')
      if (text.toLowerCase().includes('duplicate')) skipped += 1
      else failed += 1
    }
  }
  return { inserted, failed, skipped }
}

async function previewAction(body: JsonRecord) {
  const instanceName = stringFrom(body.instanceName) || ALLOWED_INSTANCE
  validateInstance(instanceName)
  const pageSize = clampInt(body.pageSize, DEFAULT_PAGE_SIZE, 1, 200)
  const device = await getDevice(instanceName)
  const [evolution, localMessages] = await Promise.all([
    fetchEvolutionPage(instanceName, 1, pageSize),
    countMessages(String(device.id)),
  ])
  const latestJob = await getLatestJob(instanceName)

  return json({
    instanceName,
    deviceId: device.id,
    pageSize,
    totalEvolution: evolution.total,
    totalPages: evolution.pages,
    totalLocal: localMessages,
    estimatedMissing: Math.max(0, evolution.total - localMessages),
    latestJob,
  })
}

async function startAction(body: JsonRecord, userId: string) {
  const instanceName = stringFrom(body.instanceName) || ALLOWED_INSTANCE
  validateInstance(instanceName)

  const active = await getActiveJob(instanceName)
  if (active) return json({ error: 'Já existe importação ativa para esta instância', job: active }, 409)

  const pageSize = clampInt(body.pageSize, DEFAULT_PAGE_SIZE, 1, 200)
  const mode = stringFrom(body.mode) || 'test'
  const recentMediaDays = clampInt(body.recentMediaDays, DEFAULT_RECENT_MEDIA_DAYS, 0, 90)
  const device = await getDevice(instanceName)
  const evolution = await fetchEvolutionPage(instanceName, 1, pageSize)
  const totalPages = evolution.pages || 1
  const targetPages = mode === 'all'
    ? totalPages
    : mode === 'last_1000'
      ? Math.min(totalPages, Math.ceil(1000 / pageSize))
      : Math.min(totalPages, 2)

  const job = await createJob({
    instance_name: instanceName,
    device_id: device.id,
    status: 'running',
    total_messages: evolution.total,
    total_pages: totalPages,
    target_pages: targetPages,
    current_page: 1,
    page_size: pageSize,
    media_mode: 'hybrid',
    recent_media_days: recentMediaDays,
    started_by: userId,
    started_at: new Date().toISOString(),
  })

  return json({ job })
}

async function runAction(body: JsonRecord) {
  const instanceName = stringFrom(body.instanceName) || ALLOWED_INSTANCE
  validateInstance(instanceName)

  let job: ImportJob | null = null
  const jobId = stringFrom(body.jobId)
  if (jobId) job = await getJob(jobId)
  else job = await getActiveJob(instanceName)

  if (!job) return json({ error: 'Nenhum job ativo encontrado' }, 404)
  if (!['pending', 'running', 'paused'].includes(job.status)) return json({ job, done: true })

  if (job.status !== 'running') {
    job = await updateJob(job.id, { status: 'running', error_message: null })
    if (!job) return json({ error: 'Falha ao retomar job' }, 500)
  }

  const pagesPerRun = clampInt(body.pagesPerRun, 2, 1, 5)
  const targetPages = job.target_pages || job.total_pages || 1
  let inserted = 0
  let skipped = 0
  let failed = 0
  let processedPages = 0
  let currentPage = job.current_page || 1

  try {
    while (processedPages < pagesPerRun && currentPage <= targetPages) {
      const page = await fetchEvolutionPage(job.instance_name, currentPage, job.page_size || DEFAULT_PAGE_SIZE)
      const normalized = page.records
        .map((record) => normalizeMessage(record, job!.device_id, job!.instance_name, job!))
        .filter(Boolean) as NonNullable<ReturnType<typeof normalizeMessage>>[]

      const ids = normalized.map((item) => String(item.row.external_id)).filter(Boolean)
      const existing = await existingExternalIds(job.device_id, ids)
      const missing = normalized.filter((item) => !existing.has(String(item.row.external_id)))
      skipped += normalized.length - missing.length

      await saveContacts(missing.map((item) => item.contact))

      const rows: JsonRecord[] = []
      for (const item of missing) {
        const row = { ...item.row }
        if (item.shouldFetchMedia && item.mediaInfo) {
          const attachment = await fetchMediaAttachment(job.instance_name, item.raw as Record<string, any>, item.mediaInfo)
          if (attachment) row.attachments = [attachment]
        }
        rows.push(row)
      }

      const result = await insertMessages(rows)
      inserted += result.inserted
      skipped += result.skipped
      failed += result.failed

      currentPage += 1
      processedPages += 1

      job = await updateJob(job.id, {
        current_page: currentPage,
        inserted_count: job.inserted_count + result.inserted,
        skipped_count: job.skipped_count + (normalized.length - missing.length) + result.skipped,
        failed_count: job.failed_count + result.failed,
        error_message: null,
      })
      if (!job) throw new Error('Falha ao atualizar progresso')
    }

    if (currentPage > targetPages) {
      job = await updateJob(job.id, { status: 'completed', finished_at: new Date().toISOString() })
    }

    return json({ job, processedPages, inserted, skipped, failed, done: currentPage > targetPages })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro inesperado'
    job = await updateJob(job.id, {
      status: 'failed',
      error_message: message.slice(0, 1000),
      failed_count: job.failed_count + failed,
    })
    return json({ error: message, job }, 500)
  }
}

async function statusAction(body: JsonRecord) {
  const instanceName = stringFrom(body.instanceName) || ALLOWED_INSTANCE
  validateInstance(instanceName)
  const jobId = stringFrom(body.jobId)
  const job = jobId ? await getJob(jobId) : await getLatestJob(instanceName)
  return json({ job })
}

async function cancelAction(body: JsonRecord) {
  const instanceName = stringFrom(body.instanceName) || ALLOWED_INSTANCE
  validateInstance(instanceName)
  const jobId = stringFrom(body.jobId)
  const job = jobId ? await getJob(jobId) : await getActiveJob(instanceName)
  if (!job) return json({ error: 'Nenhum job ativo encontrado' }, 404)
  const updated = await updateJob(job.id, { status: 'cancelled', finished_at: new Date().toISOString() })
  return json({ job: updated })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return json({ error: 'Supabase environment not configured' }, 500)

  const admin = await requireAdmin(req.headers.get('Authorization') || '')
  if (admin.error) return admin.error

  try {
    const body = await req.json().catch(() => ({})) as JsonRecord
    const action = stringFrom(body.action)
    const userId = stringFrom((admin as any).user?.id)

    switch (action) {
      case 'preview': return await previewAction(body)
      case 'start': return await startAction(body, userId)
      case 'run': return await runAction(body)
      case 'status': return await statusAction(body)
      case 'cancel': return await cancelAction(body)
      default: return json({ error: `unknown action: ${action}` }, 400)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro inesperado'
    return json({ error: message }, 500)
  }
})
