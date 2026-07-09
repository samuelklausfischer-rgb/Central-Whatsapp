import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const EVOLUTION_API_URL = (Deno.env.get('EVOLUTION_API_URL') || 'https://apps-evolution-api.srofjl.easypanel.host').replace(/\/+$/, '')
const EVOLUTION_API_KEY = Deno.env.get('EVOLUTION_API_KEY') || ''
const STORAGE_BUCKET = 'chat-attachments'

type MediaType = 'image' | 'video' | 'audio' | 'document' | 'sticker'

type MediaInfo = {
  type: MediaType
  label: string
  caption: string
  mime: string
  name: string
  convertToMp4: boolean
}

type MediaAttachment = {
  url: string
  type: MediaType
  name: string
  mime: string
}

type MediaDownloadAttempt = {
  label: string
  body: Record<string, unknown>
}

function sbHeaders() {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  }
}

async function fetchGroupInfo(instanceName: string, groupJid: string): Promise<Record<string, any> | null> {
  if (!EVOLUTION_API_KEY || !groupJid) return null

  try {
    const resp = await fetch(
      `${EVOLUTION_API_URL}/group/findGroupInfos/${instanceName}?groupJid=${encodeURIComponent(groupJid)}`,
      { headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY } },
    )
    if (!resp.ok) return null
    return await resp.json().catch(() => null)
  } catch {
    return null
  }
}

async function saveContact(
  headers: Record<string, string>,
  remoteJid: string,
  data: { name?: string; avatarUrl?: string },
) {
  const findResp = await fetch(
    `${SUPABASE_URL}/rest/v1/contacts?remote_jid=eq.${encodeURIComponent(remoteJid)}&select=id`,
    { headers },
  )
  const contacts = await findResp.json().catch(() => [])
  const contact = Array.isArray(contacts) ? contacts[0] : null
  const now = new Date().toISOString()

  if (contact) {
    const updateData: Record<string, unknown> = {}
    if (data.name) updateData.name = data.name
    if (data.avatarUrl) {
      updateData.avatar_url = data.avatarUrl
      updateData.avatar_updated_at = now
    }

    if (Object.keys(updateData).length > 0) {
      await fetch(`${SUPABASE_URL}/rest/v1/contacts?id=eq.${contact.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(updateData),
      })
    }
    return
  }

  await fetch(`${SUPABASE_URL}/rest/v1/contacts`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({
      remote_jid: remoteJid,
      name: data.name || undefined,
      avatar_url: data.avatarUrl || undefined,
      avatar_updated_at: data.avatarUrl ? now : undefined,
    }),
  })
}

function mediaLog(stage: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ scope: 'media_pipeline', stage, ...data }))
}

function mediaWarn(stage: string, data: Record<string, unknown>) {
  console.warn(JSON.stringify({ scope: 'media_pipeline', stage, ...data }))
}

function summarizeObject(value: unknown, depth = 0): unknown {
  if (depth > 2 || value == null) return value == null ? value : '[depth_limit]'
  if (typeof value === 'string') {
    const compact = value.replace(/\s/g, '')
    if (compact.length > 120) return `[string:${compact.length}]`
    return value
  }
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) return `[array:${value.length}]`

  const obj = value as Record<string, unknown>
  const summary: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(obj).slice(0, 20)) {
    summary[key] = summarizeObject(item, depth + 1)
  }
  return summary
}

function getMessageTypeKeys(msgObj: Record<string, unknown>): string[] {
  return Object.keys(msgObj || {}).filter((key) => key.endsWith('Message') || key === 'conversation')
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
    return {
      type: 'image',
      label: '[Imagem]',
      caption: msg.caption || '',
      mime,
      name: ensureExtension(msg.fileName || 'image_message', mime),
      convertToMp4: false,
    }
  }

  if (m.videoMessage) {
    const msg = m.videoMessage
    const mime = msg.mimetype || 'video/mp4'
    return {
      type: 'video',
      label: '[Vídeo]',
      caption: msg.caption || '',
      mime,
      name: ensureExtension(msg.fileName || 'video_message', mime),
      convertToMp4: true,
    }
  }

  if (m.audioMessage) {
    const msg = m.audioMessage
    const mime = msg.mimetype || 'audio/ogg'
    return {
      type: 'audio',
      label: msg.ptt ? '[Áudio]' : '[Música]',
      caption: '',
      mime,
      name: ensureExtension(msg.fileName || 'audio_message', mime),
      convertToMp4: false,
    }
  }

  if (m.documentMessage) {
    const msg = m.documentMessage
    const mime = msg.mimetype || 'application/octet-stream'
    const name = msg.fileName || 'document_message'
    return {
      type: 'document',
      label: `[Documento: ${name}]`,
      caption: msg.caption || '',
      mime,
      name: ensureExtension(name, mime),
      convertToMp4: false,
    }
  }

  if (m.stickerMessage) {
    const msg = m.stickerMessage
    const mime = msg.mimetype || 'image/webp'
    return {
      type: 'sticker',
      label: '[Figurinha]',
      caption: '',
      mime,
      name: ensureExtension(msg.fileName || 'sticker_message', mime),
      convertToMp4: false,
    }
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

function getContactInfo(msgObj: Record<string, unknown>): ContactInfo | null {
  const m = msgObj as Record<string, any>
  if (!m.contactMessage) return null
  const cm = m.contactMessage
  const vcard = typeof cm.vcard === 'string' ? cm.vcard : ''
  const parsed = vcard ? parseVcard(vcard) : { name: null, phone: null }
  return {
    name: cm.displayName || parsed.name || 'Contato',
    phone: parsed.phone,
  }
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

function findBase64(value: unknown, depth = 0): string | null {
  if (depth > 5 || value == null) return null
  if (typeof value === 'string') {
    const compact = value.replace(/\s/g, '')
    if (compact.startsWith('data:') || (/^[A-Za-z0-9+/=]+$/.test(compact) && compact.length > 200)) {
      return value
    }
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

function base64Length(raw: string | null): number {
  if (!raw) return 0
  const parsed = parseBase64(raw, 'application/octet-stream')
  return parsed.base64.length
}

function parseBase64(raw: string, fallbackMime: string): { base64: string; mime: string } {
  const match = raw.match(/^data:([^;]+);base64,(.*)$/s)
  if (match) return { mime: match[1] || fallbackMime, base64: match[2].replace(/\s/g, '') }
  return { mime: fallbackMime, base64: raw.replace(/\s/g, '') }
}

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

async function uploadMedia(path: string, bytes: Uint8Array, mime: string): Promise<string | null> {
  mediaLog('storage_upload_start', { path, mime, bytes: bytes.length })

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

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => '')
    mediaWarn('storage_upload_failed', { status: resp.status, path, errorText: errorText.slice(0, 500) })
    return null
  }

  mediaLog('storage_upload_ok', { path, mime, bytes: bytes.length })
  return `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${path}`
}

function buildMediaDownloadAttempts(messageData: Record<string, any>, convertToMp4: boolean): MediaDownloadAttempt[] {
  const key = messageData.key || {}
  const message = messageData.message || {}
  const compactKey = {
    id: key.id,
    fromMe: key.fromMe,
    remoteJid: key.remoteJidAlt || key.remoteJid,
    participant: key.participant,
  }

  return [
    {
      label: 'full_message_data',
      body: { message: messageData, convertToMp4 },
    },
    {
      label: 'key_and_message',
      body: { message: { key, message }, convertToMp4 },
    },
    {
      label: 'compact_key',
      body: { message: { key: compactKey }, convertToMp4 },
    },
    {
      label: 'id_only',
      body: { message: { key: { id: key.id } }, convertToMp4 },
    },
  ]
}

async function fetchMediaAttachment(
  instanceName: string,
  messageData: Record<string, any>,
  mediaInfo: MediaInfo,
): Promise<MediaAttachment | null> {
  try {
    let data: Record<string, any> | null = null
    let rawBase64: string | null = null
    const attempts = buildMediaDownloadAttempts(messageData, mediaInfo.convertToMp4)

    for (const attempt of attempts) {
      mediaLog('download_attempt_start', {
        attempt: attempt.label,
        messageId: messageData.key?.id,
        mediaType: mediaInfo.type,
        mime: mediaInfo.mime,
      })

      const resp = await fetch(`${EVOLUTION_API_URL}/chat/getBase64FromMediaMessage/${instanceName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
        body: JSON.stringify(attempt.body),
      })

      if (!resp.ok) {
        const errorText = await resp.text().catch(() => '')
        mediaWarn('download_attempt_failed', {
          attempt: attempt.label,
          status: resp.status,
          messageId: messageData.key?.id,
          errorText: errorText.slice(0, 700),
        })
        continue
      }

      const responseData = await resp.json().catch(() => null)
      const foundBase64 = findBase64(responseData)
      mediaLog('download_attempt_response', {
        attempt: attempt.label,
        messageId: messageData.key?.id,
        summary: summarizeObject(responseData) as Record<string, unknown>,
        hasBase64: Boolean(foundBase64),
        base64Length: base64Length(foundBase64),
      })

      if (foundBase64) {
        data = responseData || {}
        rawBase64 = foundBase64
        break
      }
    }

    if (!rawBase64) {
      mediaWarn('download_without_base64', { messageId: messageData.key?.id, mediaType: mediaInfo.type })
      return null
    }

    const parsed = parseBase64(rawBase64, data?.mimetype || data?.mimeType || mediaInfo.mime)
    const bytes = decodeBase64(parsed.base64)
    const mime = parsed.mime || mediaInfo.mime
    const name = ensureExtension(safeFileName(data?.fileName || data?.filename || mediaInfo.name), mime)
    const ext = extensionFromMime(mime)
    const messageId = safeSegment(messageData.key?.id || crypto.randomUUID())
    const instance = safeSegment(instanceName)
    const path = `whatsapp/${instance}/${mediaInfo.type}/${messageId}.${ext}`

    mediaLog('decoded_media', {
      messageId: messageData.key?.id,
      mediaType: mediaInfo.type,
      mime,
      bytes: bytes.length,
      path,
    })

    const url = await uploadMedia(path, bytes, mime)
    if (!url) return null

    mediaLog('attachment_ready', { messageId: messageData.key?.id, mediaType: mediaInfo.type, mime, name })
    return { url, type: mediaInfo.type, name, mime }
  } catch (err) {
    mediaWarn('attachment_processing_failed', { messageId: messageData.key?.id, error: String(err) })
    return null
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405 })
  }

  const body = await req.json().catch(() => null)
  if (!body || !body.instance || !body.data) {
    return new Response(JSON.stringify({ status: 'ignored', reason: 'missing instance or data' }), { status: 200 })
  }

  const event = body.event || ''
  const isUpsert = event === 'messages.upsert' || event === 'MESSAGES_UPSERT'
  const isUpdate = event === 'messages.update' || event === 'MESSAGES_UPDATE'

  if (!isUpsert && !isUpdate) {
    return new Response(JSON.stringify({ status: 'ignored', reason: 'unhandled event: ' + event }), { status: 200 })
  }

  // messages.update can arrive as an array of { key, update } objects.
  // Normalize it to the same shape used by messages.upsert.
  let messageData = body.data
  if (Array.isArray(messageData)) {
    messageData = messageData[0]
  }
  if (!messageData) {
    return new Response(JSON.stringify({ status: 'ignored', reason: 'empty data' }), { status: 200 })
  }

  // messages.update brings { key, update }; adapt it to the upsert shape.
  if (isUpdate && messageData.update && !messageData.message) {
    messageData = { ...messageData, message: messageData.update }
  }

  const headers = sbHeaders()

  const deviceResp = await fetch(
    `${SUPABASE_URL}/rest/v1/devices?instance_key=eq.${encodeURIComponent(body.instance)}&select=id`,
    { headers }
  )
  if (!deviceResp.ok) {
    return new Response(JSON.stringify({ status: 'error', message: 'device not found for instance: ' + body.instance }), { status: 200 })
  }
  const devices = await deviceResp.json()
  const device = Array.isArray(devices) ? devices[0] : null
  if (!device) {
    return new Response(JSON.stringify({ status: 'error', message: 'device not found for instance: ' + body.instance }), { status: 200 })
  }

  const key = messageData.key || {}
  const isFromMe = key.fromMe === true
  const pushName = messageData.pushName || ''
  const externalId = key.id || ''
  const participant = key.participant || ''

  const rawJid = key.remoteJidAlt || key.remoteJid || ''
  const isGroup = rawJid.includes('@g.us')
  const remoteSender = isGroup ? rawJid : rawJid.replace(/@s\.whatsapp\.net/g, '').replace(/@lid/g, '').replace(/\D/g, '')
  const groupParticipant = isGroup && participant ? participant : null

  if (!remoteSender) {
    return new Response(JSON.stringify({ status: 'ignored', reason: 'no remote sender' }), { status: 200 })
  }

  const msgObj = unwrapMessage(messageData.message || {})
  const messageTypeKeys = getMessageTypeKeys(msgObj)

  // ---- Revoke handling: contato (ou o próprio usuário, fora do app) apagou a mensagem no WhatsApp ----
  const protocolMsg = msgObj.protocolMessage
  if (protocolMsg && (protocolMsg.type === 'REVOKE' || protocolMsg.type === 0)) {
    const origExternalId = protocolMsg.key?.id || ''
    if (origExternalId) {
      const origResp = await fetch(
        `${SUPABASE_URL}/rest/v1/messages?device_id=eq.${device.id}&external_id=eq.${encodeURIComponent(origExternalId)}&select=id`,
        { headers }
      )
      const origArr = await origResp.json()
      const origMsg = Array.isArray(origArr) && origArr.length > 0 ? origArr[0] : null
      if (origMsg) {
        await fetch(`${SUPABASE_URL}/rest/v1/messages?id=eq.${origMsg.id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ revoked_at: new Date().toISOString() }),
        })
      }
    }
    return new Response(JSON.stringify({ status: 'success', action: 'message_revoked' }), { status: 200 })
  }
  // ---- End revoke handling ----

  // ---- Reaction handling: update original message instead of creating a new one ----
  const reactionMsg = msgObj.reactionMessage
  if (reactionMsg) {
    const origExternalId = reactionMsg.key?.id || ''
    const reactionEmoji = reactionMsg.text || ''
    if (origExternalId) {
      const origResp = await fetch(
        `${SUPABASE_URL}/rest/v1/messages?device_id=eq.${device.id}&external_id=eq.${encodeURIComponent(origExternalId)}&select=id,reactions`,
        { headers }
      )
      const origArr = await origResp.json()
      const origMsg = Array.isArray(origArr) && origArr.length > 0 ? origArr[0] : null
      if (origMsg) {
        const currentReactions = Array.isArray(origMsg.reactions) ? origMsg.reactions : []
        let updatedReactions: any[]

        if (reactionEmoji === '') {
          updatedReactions = currentReactions.filter((r: any) => r.sender !== remoteSender)
        } else {
          const existingIdx = currentReactions.findIndex(
            (r: any) => r.sender === remoteSender && r.emoji === reactionEmoji
          )
          if (existingIdx >= 0) {
            updatedReactions = [...currentReactions.slice(0, existingIdx), ...currentReactions.slice(existingIdx + 1)]
          } else {
            updatedReactions = [
              ...currentReactions,
              {
                emoji: reactionEmoji,
                sender: remoteSender,
                sender_name: pushName || remoteSender,
                timestamp: new Date().toISOString(),
              },
            ]
          }
        }

        await fetch(`${SUPABASE_URL}/rest/v1/messages?id=eq.${origMsg.id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ reactions: updatedReactions }),
        })
        return new Response(JSON.stringify({ status: 'success', action: 'reaction_updated' }), { status: 200 })
      }
    }
  }
  // ---- End reaction handling ----

  const mediaInfo = getMediaInfo(msgObj)
  const sharedContactInfo = getContactInfo(msgObj)
  const listInfo = getListInfo(msgObj)
  const content = extractContent(msgObj)
  const nameToUse = pushName || ''
  let contactName = (!isFromMe && !isGroup) ? nameToUse : ''
  let contactAvatarUrl = messageData.profilePicUrl || ''

  if (isGroup) {
    const groupInfo = await fetchGroupInfo(body.instance, remoteSender)
    contactName = groupInfo?.subject || ''
    contactAvatarUrl = groupInfo?.pictureUrl || contactAvatarUrl
  }

  if (mediaInfo) {
    mediaLog('media_detected', {
      instance: body.instance,
      messageId: externalId,
      event,
      remoteSender,
      fromMe: isFromMe,
      mediaType: mediaInfo.type,
      mime: mediaInfo.mime,
      content,
      messageTypeKeys,
    })
  }

  await saveContact(headers, remoteSender, { name: contactName || undefined, avatarUrl: contactAvatarUrl || undefined })

  if (externalId) {
    const existingResp = await fetch(
      `${SUPABASE_URL}/rest/v1/messages?device_id=eq.${device.id}&external_id=eq.${encodeURIComponent(externalId)}&select=id,content,sender_name,attachments`,
      { headers }
    )
    const existing = await existingResp.json()
    if (Array.isArray(existing) && existing.length > 0) {
      const currentAttachments = Array.isArray(existing[0].attachments) ? existing[0].attachments : []
      if (mediaInfo) {
        mediaLog('existing_message_found', {
          messageId: externalId,
          event,
          currentAttachments: currentAttachments.length,
          contentChanged: existing[0].content !== content,
        })
      }
      const nextAttachments =
        mediaInfo && currentAttachments.length === 0
          ? [await fetchMediaAttachment(body.instance, messageData, mediaInfo)].filter(Boolean)
          : sharedContactInfo && currentAttachments.length === 0
          ? [{ type: 'contact', name: sharedContactInfo.name, phone: sharedContactInfo.phone }]
          : listInfo && currentAttachments.length === 0
          ? [{ type: 'list', title: listInfo.title, description: listInfo.description, buttonText: listInfo.buttonText, sections: listInfo.sections }]
          : []
      const patchData: Record<string, unknown> = {}

      if (!isUpdate && existing[0].content !== content) patchData.content = content
      if (nameToUse && existing[0].sender_name !== nameToUse) patchData.sender_name = nameToUse
      if (groupParticipant && existing[0].group_participant !== groupParticipant) patchData.group_participant = groupParticipant
      if (nextAttachments.length > 0) patchData.attachments = nextAttachments

      if (Object.keys(patchData).length > 0) {
        const patchResp = await fetch(`${SUPABASE_URL}/rest/v1/messages?id=eq.${existing[0].id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ ...patchData, origin: 'webhook' }),
        })
        if (mediaInfo) {
          mediaLog('existing_message_patch', {
            messageId: externalId,
            event,
            status: patchResp.status,
            attachmentsPatched: nextAttachments.length,
          })
        }
      }
      return new Response(JSON.stringify({ status: 'success', action: 'updated' }), { status: 200 })
    }
  }

  // Ignore updates for messages that were not inserted yet.
  if (isUpdate) {
    mediaLog('update_without_existing_message', { messageId: externalId, event })
    return new Response(JSON.stringify({ status: 'ignored', reason: 'update for unknown message' }), { status: 200 })
  }

  const mediaAttachment = mediaInfo ? await fetchMediaAttachment(body.instance, messageData, mediaInfo) : null
  const contactAttachment = sharedContactInfo
    ? { type: 'contact', name: sharedContactInfo.name, phone: sharedContactInfo.phone }
    : null
  const listAttachment = listInfo
    ? { type: 'list', title: listInfo.title, description: listInfo.description, buttonText: listInfo.buttonText, sections: listInfo.sections }
    : null
  const attachments = mediaAttachment
    ? [mediaAttachment]
    : contactAttachment
    ? [contactAttachment]
    : listAttachment
    ? [listAttachment]
    : undefined

  if (mediaInfo && !mediaAttachment) {
    mediaWarn('media_attachment_null_before_insert', { messageId: externalId, mediaType: mediaInfo.type })
  }

  const insertResp = await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({
      content,
      device_id: device.id,
      remote_sender: remoteSender,
      sender_name: nameToUse,
      direction: isFromMe ? 'outbound' : 'inbound',
      is_read: isFromMe ? true : false,
      origin: 'webhook',
      ...(attachments ? { attachments } : {}),
      ...(externalId ? { external_id: externalId } : {}),
      ...(groupParticipant ? { group_participant: groupParticipant } : {}),
    }),
  })

  if (mediaInfo) {
    mediaLog('message_insert_result', {
      messageId: externalId,
      status: insertResp.status,
      attachmentInserted: Boolean(attachments),
    })
    if (!insertResp.ok) {
      const insertError = await insertResp.text().catch(() => '')
      mediaWarn('message_insert_failed', {
        messageId: externalId,
        status: insertResp.status,
        errorText: insertError.slice(0, 700),
      })
    }
  }

  if (!isFromMe) {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_unread`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ p_device_id: device.id }),
    })
  }

  return new Response(JSON.stringify({ status: 'success' }), { status: 200 })
})

function extractContent(msgObj: Record<string, unknown>): string {
  if (!msgObj) return ''
  const m = msgObj as Record<string, any>
  const mediaInfo = getMediaInfo(m)
  if (m.conversation) return m.conversation
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text
  if (mediaInfo) return mediaInfo.caption || mediaInfo.label
  if (m.reactionMessage) return '[Reação]'
  const contactInfo = getContactInfo(m)
  if (contactInfo) return `[Contato: ${contactInfo.name}]`
  const listInfo = getListInfo(m)
  if (listInfo) return `[Lista: ${listInfo.title || 'Menu'}]`
  if (m.locationMessage) return '[Localização]'
  return '[Mensagem de mídia]'
}
