import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const STORAGE_BUCKET = 'chat-attachments'
const ALLOWED_INSTANCES = ['Financeiro Medimagem', 'Financeiro PRN', 'WhatsApp Adm']
const DEFAULT_PAGE_SIZE = 50

/**
 * Teto do arquivo de mídia, em caracteres de base64 (~4/3 do tamanho real).
 * 12 MB de base64 ≈ 9 MB de arquivo — cobre foto, áudio, documento e a grande
 * maioria dos vídeos de WhatsApp. Acima disso a mensagem entra sem o anexo, em
 * vez de arriscar matar o worker por memória e travar a importação inteira.
 */
const MAX_MEDIA_BASE64 = 12 * 1024 * 1024

/**
 * Teto de espera por resposta da Evolution. Precisa ser bem menor que o limite
 * do worker: falhar aqui é recuperável (o laço repete a página, o progresso está
 * salvo); ser morto pelo runtime não é — não roda `catch` e o job fica preso.
 */
const EVOLUTION_TIMEOUT_MS = 45_000

/**
 * Tempo sem progresso a partir do qual um job ativo é considerado morto e deixa
 * de bloquear novas importações. 10 min é folgado: cada página atualiza o job, e
 * uma chamada inteira não passa de ~1 min mesmo com o timeout da Evolution.
 */
const JOB_PARADO_MS = 10 * 60 * 1000
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
  // Liberado para qualquer instância. A proteção natural é o getDevice():
  // só importa instância que tem um device local com instance_key correspondente.
  if (!instanceName || !instanceName.trim()) {
    throw new Error('Instância não informada')
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

type ContactInfo = { name: string; phone: string | null }

/** Extrai nome (FN) e telefone (TEL, preferindo o parâmetro waid=) de uma vcard. */
function parseVcard(vcard: string): { name: string | null; phone: string | null } {
  const lines = vcard.split(/\r?\n/)
  let name: string | null = null
  let phone: string | null = null
  // Aceita "TEL" com prefixo opcional de grupo vCard (ex.: "item1.TEL"), como usado
  // por vCards exportados do iPhone/Apple Contacts (RFC 6350 grouped properties).
  const telLineRe = /^(?:[A-Za-z0-9-]+\.)?TEL/i
  for (const line of lines) {
    if (line.startsWith('FN:')) {
      name = line.slice(3).trim() || null
    }
    if (telLineRe.test(line)) {
      const waidMatch = line.match(/waid=(\d+)/)
      if (waidMatch) {
        phone = waidMatch[1]
      } else if (!phone) {
        const raw = line.split(':').pop() || ''
        const digits = raw.replace(/[^\d]/g, '')
        if (digits) phone = digits
      }
    }
  }
  return { name, phone }
}

/** Um cartão de contato a partir do objeto cru da Evolution. */
function cartaoDeContato(cm: unknown): ContactInfo | null {
  if (!cm || typeof cm !== 'object') return null
  const c = cm as Record<string, any>
  const vcard = typeof c.vcard === 'string' ? c.vcard : ''
  const parsed = vcard ? parseVcard(vcard) : { name: null, phone: null }
  const nome = typeof c.displayName === 'string' && c.displayName.trim() ? c.displayName.trim() : null
  return {
    name: nome || parsed.name || 'Contato',
    phone: parsed.phone,
  }
}

/**
 * Contatos compartilhados numa mensagem. SEMPRE lista — inclusive quando é um só.
 *
 * GÊMEA da função de mesmo nome em `evolution-webhook/index.ts`, e precisa
 * continuar assim. As duas funções são independentes: não há `_shared` nem
 * import entre elas, e o deploy é ARQUIVO A ARQUIVO no self-hosted (com portão
 * de sha256), então extrair essas ~40 linhas para um módulo comum custaria
 * mudar o pipeline de publicação inteiro. Ao alterar aqui, alterar lá também.
 *
 * O porquê está documentado na versão do webhook: o WhatsApp usa
 * `contactMessage` para um contato e `contactsArrayMessage` para vários, e só o
 * singular era tratado — vários viravam balão vazio.
 */
function getContactInfos(msgObj: Record<string, unknown>): ContactInfo[] | null {
  const m = msgObj as Record<string, any>

  if (m.contactMessage) {
    const um = cartaoDeContato(m.contactMessage)
    return um ? [um] : null
  }

  const arr = m.contactsArrayMessage
  if (arr && typeof arr === 'object') {
    const brutos = Array.isArray(arr.contacts) ? arr.contacts : []
    const cartoes = brutos
      .map((c: unknown) => cartaoDeContato(c))
      .filter((c: ContactInfo | null): c is ContactInfo => c !== null)
    if (cartoes.length > 0) return cartoes

    const rotulo = typeof arr.displayName === 'string' && arr.displayName.trim()
      ? arr.displayName.trim()
      : 'Contato'
    return [{ name: rotulo, phone: null }]
  }

  return null
}

/**
 * Prévia da citação, com os mesmos rótulos humanos usados no webhook — o front
 * mostra "Voz" para qualquer texto que ele reconheça como rótulo técnico, e sem
 * esta tradução uma FOTO citada apareceria como "Voz".
 */
function textoParaCitacao(bruto: string): string {
  const t = (bruto || '').trim()
  if (!t) return ''
  if (t.startsWith('[Documento:')) return 'Documento'
  if (t.startsWith('[Contato:')) return 'Contato'
  if (t.startsWith('[Lista:')) return 'Lista'
  const mapa: Record<string, string> = {
    '[Imagem]': 'Foto',
    '[Vídeo]': 'Vídeo',
    '[Música]': 'Música',
    '[Figurinha]': 'Figurinha',
    '[Documento]': 'Documento',
    '[Contato]': 'Contato',
    '[Localização]': 'Localização',
    '[Mensagem de mídia]': 'Mídia',
    '[Anexo]': 'Anexo',
  }
  return mapa[t] ?? t
}

/**
 * Citação de uma mensagem importada — SEM consulta ao banco, de propósito.
 *
 * O webhook procura a mensagem citada por `device_id + external_id` para
 * preencher também o `reply_to_id`. Aqui isso seria uma ida ao banco POR
 * MENSAGEM, num caminho que processa dezenas de milhares delas em lote (a
 * Evolution retém 380 mil mensagens só de um aparelho) — e a própria importação
 * já é a principal suspeita de saturar a ingestão ao vivo. Não vale.
 *
 * O snapshot sozinho resolve a tela: o front renderiza a citação sem precisar do
 * `reply_to_id`. Perde-se só o clique para pular até a original.
 *
 * O `contextInfo` é procurado em DOIS lugares porque o payload do histórico não
 * passa pelo mesmo `prepareMessage` que iça o campo para o topo nos webhooks —
 * então aqui ele pode vir aninhado dentro do tipo da mensagem. Não achou, não
 * grava nada: nunca piora o que já existe.
 */
function citacaoDoHistorico(
  record: Record<string, any>,
  msgObj: Record<string, unknown>,
): JsonRecord | null {
  const m = msgObj as Record<string, any>
  const candidatos = [
    record?.contextInfo,
    ...Object.values(m).map((v: any) => (v && typeof v === 'object' ? v.contextInfo : null)),
  ]
  const ctx = candidatos.find((c: any) => c && typeof c === 'object' && (c.stanzaId || c.quotedMessage))
  if (!ctx) return null

  const stanzaId = typeof ctx.stanzaId === 'string' ? ctx.stanzaId : ''
  const quoted = ctx.quotedMessage
  if (!quoted || typeof quoted !== 'object') return null

  let texto = ''
  try {
    texto = textoParaCitacao(extractContent(unwrapMessage(quoted as Record<string, unknown>) || {}))
  } catch {
    return null
  }
  if (!texto) return null

  // `sender_name` vazio: o `participant` é um JID cru, e o front cai para
  // "Mensagem original", que é melhor de ler.
  return { id: stanzaId, content: texto, sender_name: '' } as JsonRecord
}

type ListRow = { rowId: string; title: string; description?: string }
type ListSection = { title?: string; rows: ListRow[] }
type ListInfo = { title: string; description: string; buttonText: string; sections: ListSection[] }

/** Extrai título/descrição/opções de uma mensagem de lista interativa do WhatsApp. */
function getListInfo(msgObj: Record<string, unknown>): ListInfo | null {
  const m = msgObj as Record<string, any>
  const lm = m.listMessage
  if (!lm) return null
  const sections: ListSection[] = Array.isArray(lm.sections)
    ? lm.sections.map((s: any) => ({
        title: s.title || undefined,
        rows: Array.isArray(s.rows)
          ? s.rows.map((r: any) => ({ rowId: r.rowId || '', title: r.title || '', description: r.description || undefined }))
          : [],
      }))
    : []
  return {
    title: lm.title || '',
    description: lm.description || '',
    buttonText: lm.buttonText || 'Ver opções',
    sections,
  }
}

function extractContent(msgObj: Record<string, unknown>): string {
  if (!msgObj) return ''
  const m = msgObj as Record<string, any>
  const mediaInfo = getMediaInfo(m)
  if (m.conversation) return m.conversation
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text
  if (mediaInfo) return mediaInfo.caption || mediaInfo.label
  if (m.reactionMessage) return '[Reação]'
  const contactInfos = getContactInfos(m)
  if (contactInfos && contactInfos.length > 0) {
    // Prefixo "[Contato: " obrigatório nos dois casos: é por ele que o front
    // esconde o rótulo técnico e mostra os balões. Ver a versão do webhook.
    return contactInfos.length === 1
      ? `[Contato: ${contactInfos[0].name}]`
      : `[Contato: ${contactInfos[0].name} e outros ${contactInfos.length - 1}]`
  }
  const listInfo = getListInfo(m)
  if (listInfo) return `[Lista: ${listInfo.title || 'Menu'}]`
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

  // TIMEOUT EXPLÍCITO — o `fetch` do Deno não tem um por padrão.
  //
  // Sem isto, uma chamada que a Evolution nunca responde segura o worker até o
  // runtime matá-lo. E worker morto não roda `catch`: o job fica preso em
  // `running` para sempre, bloqueando novas importações da instância (é o índice
  // de um job ativo por instância). Falhar em 45s é recuperável — o laço tenta a
  // mesma página de novo e o progresso está salvo. Pendurar não é.
  let response: Response
  try {
    response = await fetch(`${apiUrl}${path}`, {
      method,
      headers: { apikey: apiKey, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(EVOLUTION_TIMEOUT_MS),
    })
  } catch (err) {
    const erro = err instanceof Error ? err : new Error(String(err))
    const expirou = erro.name === 'TimeoutError' || erro.name === 'AbortError'
    throw new Error(
      expirou
        ? `Evolution não respondeu em ${EVOLUTION_TIMEOUT_MS / 1000}s (${path})`
        : `Falha de rede com a Evolution (${path}): ${erro.message}`,
    )
  }

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
  const sharedContactInfos = getContactInfos(msgObj)
  const citacao = citacaoDoHistorico(record as Record<string, any>, msgObj)
  const listInfo = getListInfo(msgObj)
  const content = extractContent(msgObj)
  const shouldFetchMedia = job.media_mode === 'hybrid' && mediaInfo && isRecent(createdAt, job.recent_media_days)
  const senderName = stringFrom(record.pushName) || ''
  const isGroup = String(remoteSender).includes('@g.us')
  const participant = String(key.participant || '')
  const groupParticipant = isGroup && participant ? participant : null

  return {
    raw: record,
    mediaInfo,
    shouldFetchMedia,
    contact: { remote_jid: remoteSender, name: (!isFromMe && !isGroup) ? senderName : '' },
    row: {
      content,
      device_id: deviceId,
      remote_sender: remoteSender,
      sender_name: senderName,
      group_participant: groupParticipant,
      direction: isFromMe ? 'outbound' : 'inbound',
      is_read: true,
      origin: 'webhook',
      external_id: externalId,
      created_at: createdAt,
      ...(sharedContactInfos && sharedContactInfos.length > 0
        ? { attachments: sharedContactInfos.map((c) => ({ type: 'contact', name: c.name, phone: c.phone })) }
        : listInfo
        ? { attachments: [{ type: 'list', title: listInfo.title, description: listInfo.description, buttonText: listInfo.buttonText, sections: listInfo.sections }] }
        : {}),
      ...(citacao ? { reply_to_snapshot: citacao } : {}),
    } as JsonRecord,
  }
}

async function existingExternalIds(deviceId: string, externalIds: string[]) {
  if (externalIds.length === 0) return new Map<string, JsonRecord | null>()
  const filter = encodeURIComponent(quotedIn(externalIds))
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/messages?device_id=eq.${encodeURIComponent(deviceId)}&external_id=in.(${filter})&select=external_id,sender_name,group_participant`,
    { headers: serviceHeaders },
  )
  if (!resp.ok) return new Map<string, JsonRecord | null>()
  const rows = await resp.json()
  const map = new Map<string, JsonRecord | null>()
  if (Array.isArray(rows)) {
    for (const r of rows) {
      const extId = String(r.external_id)
      if (extId) map.set(extId, r)
    }
  }
  return map
}

function isWeakSenderName(name: unknown): boolean {
  if (!name || name === '') return true
  const s = String(name)
  return /^\d{10,}$/.test(s) || s.includes('@')
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

    // TETO DE TAMANHO — antes não havia nenhum.
    //
    // `decodeBase64` materializa o arquivo inteiro na memória do isolate, e o
    // base64 que veio já ocupa ~4/3 do tamanho original. Um vídeo de 40 MB vira
    // ~54 MB de string MAIS 40 MB de array, tudo de uma vez. Estourado o limite
    // de memória, o worker é MORTO: nenhum catch roda, o job fica preso em
    // `running` sem mensagem de erro, e o cliente recebe uma resposta sem JSON.
    // É o principal suspeito das importações que morrem entre as páginas 12 e 68.
    //
    // Acima do teto a mensagem entra SEM anexo, como as mídias antigas já entram
    // (o balão mostra o rótulo). Perder o arquivo de uma mensagem é muito melhor
    // que derrubar a importação inteira e bloquear a fila.
    const tamanhoBase64 = parsed.base64.length
    if (tamanhoBase64 > MAX_MEDIA_BASE64) {
      console.warn(
        JSON.stringify({
          scope: 'midia_grande_ignorada',
          messageId: stringFrom(messageData.key?.id),
          tipo: mediaInfo.type,
          base64Chars: tamanhoBase64,
          tetoChars: MAX_MEDIA_BASE64,
        }),
      )
      return null
    }

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
  const instanceName = stringFrom(body.instanceName) || ALLOWED_INSTANCES[0]
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
  const instanceName = stringFrom(body.instanceName) || ALLOWED_INSTANCES[0]
  validateInstance(instanceName)

  /**
   * Job parado não pode bloquear para sempre.
   *
   * Quem empurra a importação é um laço dentro da aba do navegador. Se a aba
   * fecha — ou se o worker morre no meio, como vinha acontecendo —, o job fica
   * em `running` e NUNCA sai de lá: não há quem o finalize. Como só se admite um
   * job ativo por instância, ele passa a barrar toda importação nova. Foi assim
   * que Financeiro PRN ficou travado de 23/07 a 12/08, e Celular teste desde 28/07.
   *
   * Aqui um job sem progresso há mais de `JOB_PARADO_MS` é encerrado como
   * `failed`, com o motivo escrito, e a importação nova segue. O corte é por
   * `updated_at`, que avança a cada página — job de verdade em andamento nunca
   * fica tanto tempo sem se mexer.
   */
  const active = await getActiveJob(instanceName)
  if (active) {
    const paradoDesde = Date.parse(String(active.updated_at ?? active.created_at ?? '')) || 0
    const parado = paradoDesde > 0 && Date.now() - paradoDesde > JOB_PARADO_MS
    if (!parado) {
      return json({ error: 'Já existe importação ativa para esta instância', job: active }, 409)
    }
    const minutos = Math.round((Date.now() - paradoDesde) / 60000)
    console.warn(
      JSON.stringify({ scope: 'job_parado_liberado', jobId: active.id, instanceName, minutosParado: minutos }),
    )
    await updateJob(active.id, {
      status: 'failed',
      error_message: `Encerrado automaticamente: sem progresso por ${minutos} min. Provável queda do worker ou fechamento da aba.`,
      finished_at: new Date().toISOString(),
    })
  }

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
  const instanceName = stringFrom(body.instanceName) || ALLOWED_INSTANCES[0]
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
      const existingMap = await existingExternalIds(job.device_id, ids)
      const missing = normalized.filter((item) => {
        const extId = String(item.row.external_id)
        return !existingMap.has(extId)
      })
      skipped += normalized.length - missing.length

      // Patch existing group messages that have weak sender_name
      for (const item of normalized) {
        const extId = String(item.row.external_id)
        const existingRow = existingMap.get(extId)
        if (!existingRow) continue
        const isGroup = String(item.row.remote_sender).includes('@g.us')
        const isInbound = item.row.direction === 'inbound'
        if (!isGroup || !isInbound) continue
        const patch: Record<string, unknown> = {}
        const hasNewName = item.row.sender_name && !isWeakSenderName(item.row.sender_name)
        if (hasNewName && isWeakSenderName(existingRow.sender_name)) {
          patch.sender_name = item.row.sender_name
        }
        if (item.row.group_participant && !existingRow.group_participant) {
          patch.group_participant = item.row.group_participant
        }
        if (Object.keys(patch).length > 0) {
          await fetch(
            `${SUPABASE_URL}/rest/v1/messages?external_id=eq.${encodeURIComponent(extId)}&device_id=eq.${encodeURIComponent(job.device_id)}`,
            { method: 'PATCH', headers: serviceHeaders, body: JSON.stringify(patch) },
          )
        }
      }

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
  const instanceName = stringFrom(body.instanceName) || ALLOWED_INSTANCES[0]
  validateInstance(instanceName)
  const jobId = stringFrom(body.jobId)
  const job = jobId ? await getJob(jobId) : await getLatestJob(instanceName)
  return json({ job })
}

async function cancelAction(body: JsonRecord) {
  const instanceName = stringFrom(body.instanceName) || ALLOWED_INSTANCES[0]
  validateInstance(instanceName)
  const jobId = stringFrom(body.jobId)
  const job = jobId ? await getJob(jobId) : await getActiveJob(instanceName)
  if (!job) return json({ error: 'Nenhum job ativo encontrado' }, 404)
  const updated = await updateJob(job.id, { status: 'cancelled', finished_at: new Date().toISOString() })
  return json({ job: updated })
}

/**
 * Trocar a cada deploy. Sem isto não há como provar que o isolate do Deno
 * recarregou — conferir o arquivo no container mostra o disco, não o que roda.
 */
const BUILD_MARKER = 'import-erro-falante-2026-08-14'

Deno.serve(async (req: Request) => {
  /**
   * TUDO dentro do try, inclusive o `requireAdmin`.
   *
   * Antes, `requireAdmin` rodava ANTES do try. Os dois `fetch` dele (auth e
   * profiles) podiam lançar numa falha transitória de rede, e aí quem respondia
   * era o runtime: 500 de texto puro, sem corpo JSON.
   *
   * Isso importava mais do que parece. O cliente lê `corpo.error` para montar a
   * mensagem (`evolution_history_import.ts`); sem esse campo ele cai no texto
   * genérico "Edge Function returned a non-2xx status code" — que foi
   * exatamente o que o usuário viu em 14/08, e que não diz nada a ninguém.
   *
   * Agora TODA saída de erro carrega `error`, `etapa` e `build`. Uma falha vira
   * uma frase em vez de um enigma.
   *
   * O que este try NÃO alcança: worker morto por limite de memória ou CPU. Aí
   * não há JavaScript rodando para responder — o sintoma continua sendo resposta
   * sem JSON, e é assim que se distingue um caso do outro.
   */
  let etapa = 'inicio'
  try {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
    if (req.method !== 'POST') return json({ error: 'method not allowed', build: BUILD_MARKER }, 405)
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return json({ error: 'Supabase environment not configured', build: BUILD_MARKER }, 500)
    }

    etapa = 'auth'
    const admin = await requireAdmin(req.headers.get('Authorization') || '')
    if (admin.error) return admin.error

    etapa = 'body'
    const body = await req.json().catch(() => ({})) as JsonRecord
    const action = stringFrom(body.action)
    const userId = stringFrom((admin as any).user?.id)

    etapa = `acao:${action || '(vazia)'}`
    switch (action) {
      case 'preview': return await previewAction(body)
      case 'start': return await startAction(body, userId)
      case 'run': return await runAction(body)
      case 'status': return await statusAction(body)
      case 'cancel': return await cancelAction(body)
      default: return json({ error: `unknown action: ${action}`, build: BUILD_MARKER }, 400)
    }
  } catch (error) {
    const erro = error instanceof Error ? error : new Error(String(error))
    console.error(
      JSON.stringify({
        scope: 'import_falha_nao_tratada',
        build: BUILD_MARKER,
        etapa,
        nome: erro.name,
        mensagem: erro.message,
        pilha: (erro.stack || '').split('\n').slice(0, 4).join(' | '),
      }),
    )
    return json({ error: `[${etapa}] ${erro.name}: ${erro.message}`, etapa, build: BUILD_MARKER }, 500)
  }
})
