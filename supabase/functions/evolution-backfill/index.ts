import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const EVOLUTION_API_URL = (Deno.env.get('EVOLUTION_API_URL') || 'http://apps-evolution-api.srofjl.easypanel.host').replace(/\/+$/, '')
const EVOLUTION_API_KEY = Deno.env.get('EVOLUTION_API_KEY') || ''

function sbHeaders() {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405 })
  }

  const body = await req.json().catch(() => ({}))
  const instanceName = body.instance || ''
  const limit = Math.min(parseInt(body.limit) || 50, 500)

  if (!instanceName) {
    return new Response(JSON.stringify({ error: 'instance name is required' }), { status: 400 })
  }

  const headers = sbHeaders()

  const deviceResp = await fetch(
    `${SUPABASE_URL}/rest/v1/devices?instance_key=eq.${encodeURIComponent(instanceName)}&select=id`,
    { headers }
  )
  const devices = await deviceResp.json()
  const device = Array.isArray(devices) ? devices[0] : null
  if (!device) {
    return new Response(JSON.stringify({ error: 'device not found for instance: ' + instanceName }), { status: 404 })
  }

  let imported = 0
  let skipped = 0
  let errors = 0
  let page = 1
  let hasMore = true
  const batchSize = 100

  while (hasMore && imported + skipped + errors < limit) {
    const resp = await fetch(
      `${EVOLUTION_API_URL}/chat/findMessages/${encodeURIComponent(instanceName)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
        body: JSON.stringify({ where: {}, page, limit: batchSize }),
      }
    )

    if (!resp.ok) break

    const result = await resp.json()
    const messages = result?.messages?.records || result?.records || []

    if (messages.length === 0) {
      hasMore = false
      break
    }

    for (const msg of messages) {
      if (imported + skipped + errors >= limit) {
        hasMore = false
        break
      }

      const key = msg.key || {}
      const externalId = key.id || ''
      const msgObj = msg.message || {}

      let content = msgObj.conversation || ''
      if (!content && msgObj.extendedTextMessage?.text) content = msgObj.extendedTextMessage.text
      if (!content && msgObj.imageMessage) content = msgObj.imageMessage.caption || '[Imagem]'
      if (!content && msgObj.videoMessage) content = msgObj.videoMessage.caption || '[Vídeo]'
      if (!content && msgObj.audioMessage) content = '[Áudio]'
      if (!content && msgObj.documentMessage) {
        content = msgObj.documentMessage.caption || `[Documento: ${msgObj.documentMessage.fileName || 'Documento'}]`
      }
      if (!content && msgObj.stickerMessage) content = '[Figurinha]'
      if (!content) content = '[Mensagem de mídia]'

      const isFromMe = key.fromMe === true
      const pushName = msg.pushName || ''
      const rawJid = key.remoteJidAlt || key.remoteJid || ''
      const isGroup = rawJid.includes('@g.us')
      const remoteSender = isGroup ? rawJid : rawJid.replace(/@s\.whatsapp\.net/g, '').replace(/@lid/g, '').replace(/\D/g, '')

      if (!remoteSender) {
        skipped++
        continue
      }

      if (externalId) {
        const dupResp = await fetch(
          `${SUPABASE_URL}/rest/v1/messages?device_id=eq.${device.id}&external_id=eq.${encodeURIComponent(externalId)}&select=id&limit=1`,
          { headers }
        )
        const dup = await dupResp.json()
        if (Array.isArray(dup) && dup.length > 0) {
          skipped++
          continue
        }
      }

      try {
        await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
          method: 'POST',
          headers: { ...headers, Prefer: 'return=minimal' },
          body: JSON.stringify({
            content,
            device_id: device.id,
            remote_sender: remoteSender,
            sender_name: pushName,
            direction: isFromMe ? 'outbound' : 'inbound',
            is_read: true,
            origin: 'webhook',
            ...(externalId ? { external_id: externalId } : {}),
          }),
        })
        imported++
      } catch {
        errors++
      }
    }

    page++
  }

  return new Response(JSON.stringify({ status: 'completed', instance: instanceName, imported, skipped, errors }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
